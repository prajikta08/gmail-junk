// MailZen — Background Service Worker
// All Gmail data is processed via Google's official OAuth API.
// No email content is ever sent to third-party servers.

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Auth ────────────────────────────────────────────────────────────────────

async function getAuthToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

async function gmailFetch(endpoint, options = {}) {
  const token = await getAuthToken(false);
  const res = await fetch(`${GMAIL_API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
  return res.json();
}

// ─── Core Analysis ───────────────────────────────────────────────────────────

async function getUnopenedOlderThanMonth() {
  const cutoff = Math.floor((Date.now() - ONE_MONTH_MS) / 1000);
  const query = `is:unread before:${cutoff} -in:sent -in:drafts`;
  let messages = [];
  let pageToken = null;

  do {
    const url = `/messages?q=${encodeURIComponent(query)}&maxResults=500${pageToken ? '&pageToken=' + pageToken : ''}`;
    const data = await gmailFetch(url);
    if (data.messages) messages = messages.concat(data.messages);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return messages;
}

async function getSenderCounts() {
  const messages = await getUnopenedOlderThanMonth();
  const senderMap = {};

  // Batch fetch headers only (no body — privacy first)
  const batchSize = 100;
  for (let i = 0; i < Math.min(messages.length, 500); i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    await Promise.all(batch.map(async (msg) => {
      try {
        const detail = await gmailFetch(`/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=List-Unsubscribe`);
        const fromHeader = detail.payload?.headers?.find(h => h.name === 'From');
        const unsubHeader = detail.payload?.headers?.find(h => h.name === 'List-Unsubscribe');
        const from = fromHeader?.value || 'Unknown';
        const emailMatch = from.match(/<(.+?)>/) || [null, from];
        const email = emailMatch[1].toLowerCase().trim();
        const domain = email.split('@')[1] || email;

        if (!senderMap[domain]) {
          senderMap[domain] = {
            domain,
            displayName: from.replace(/<.*>/, '').trim() || domain,
            email,
            count: 0,
            messageIds: [],
            canUnsubscribe: false,
            unsubscribeLink: null,
          };
        }
        senderMap[domain].count++;
        senderMap[domain].messageIds.push(msg.id);
        if (unsubHeader?.value) {
          senderMap[domain].canUnsubscribe = true;
          senderMap[domain].unsubscribeLink = unsubHeader.value;
        }
      } catch (e) { /* skip individual failures */ }
    }));
  }

  return Object.values(senderMap).sort((a, b) => b.count - a.count);
}

async function deleteSenderMessages(messageIds) {
  // Batch delete in groups of 1000 (API limit)
  const batchSize = 1000;
  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize);
    await gmailFetch('/messages/batchDelete', {
      method: 'POST',
      body: JSON.stringify({ ids: batch }),
    });
  }
  return { deleted: messageIds.length };
}

async function getAllMessagesFromSender(email) {
  const query = `from:${email}`;
  let messages = [];
  let pageToken = null;
  do {
    const url = `/messages?q=${encodeURIComponent(query)}&maxResults=500${pageToken ? '&pageToken=' + pageToken : ''}`;
    const data = await gmailFetch(url);
    if (data.messages) messages = messages.concat(data.messages);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return messages.map(m => m.id);
}

async function getInboxStats() {
  const [inbox, unread, spam] = await Promise.all([
    gmailFetch('/labels/INBOX'),
    gmailFetch('/labels/UNREAD'),
    gmailFetch('/labels/SPAM'),
  ]);
  return {
    totalInbox: inbox.messagesTotal || 0,
    unreadCount: unread.messagesTotal || 0,
    spamCount: spam.messagesTotal || 0,
  };
}

// ─── Scam Detection (local heuristics, no external API) ──────────────────────

function detectScamIndicators(subject, from) {
  const scamPatterns = [
    /urgent.*action/i, /verify.*account/i, /suspended.*account/i,
    /winner|won.*prize/i, /nigerian|prince.*money/i, /bitcoin.*profit/i,
    /click.*here.*immediately/i, /confirm.*password/i, /unusual.*activity/i,
    /\$\d+.*free/i, /congratulations.*selected/i, /limited.*time.*offer/i,
  ];
  const text = `${subject} ${from}`;
  const hits = scamPatterns.filter(p => p.test(text));
  return { isLikelyScam: hits.length >= 2, confidence: Math.min(hits.length * 25, 100) };
}

// ─── Message Handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.action) {
        case 'LOGIN':
          await getAuthToken(true);
          const profile = await gmailFetch('/profile');
          sendResponse({ ok: true, email: profile.emailAddress });
          break;

        case 'LOGOUT':
          chrome.identity.clearAllCachedAuthTokens(() => {});
          sendResponse({ ok: true });
          break;

        case 'GET_STATS':
          const stats = await getInboxStats();
          sendResponse({ ok: true, ...stats });
          break;

        case 'ANALYZE_JUNK':
          sendResponse({ ok: true, status: 'started' });
          const senders = await getSenderCounts();
          chrome.runtime.sendMessage({ action: 'ANALYSIS_DONE', senders });
          break;

        case 'DELETE_SENDER':
          const { email, deleteAll } = msg;
          let ids = msg.messageIds || [];
          if (deleteAll) {
            ids = await getAllMessagesFromSender(email);
          }
          const result = await deleteSenderMessages(ids);
          sendResponse({ ok: true, ...result });
          break;

        case 'CHECK_SCAM':
          const scam = detectScamIndicators(msg.subject, msg.from);
          sendResponse({ ok: true, ...scam });
          break;

        default:
          sendResponse({ ok: false, error: 'Unknown action' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true; // keep channel open for async
});

// ─── Alarm: weekly background analysis ──────────────────────────────────────
chrome.alarms.create('weeklyAnalysis', { periodInMinutes: 10080 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'weeklyAnalysis') {
    try {
      const senders = await getSenderCounts();
      const junkCount = senders.reduce((s, r) => s + r.count, 0);
      if (junkCount > 0) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: '../icons/icon48.png',
          title: 'MailZen — Inbox Noise Detected',
          message: `${junkCount} unopened emails from ${senders.length} senders found. Tap to review.`,
        });
      }
    } catch (e) { /* user may not be logged in */ }
  }
});
