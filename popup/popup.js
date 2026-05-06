// MailZen — Popup Controller
'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  userEmail: null,
  senders: [],
  selectedSenders: new Set(),
  pendingDelete: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  el.classList.add('active');
  el.style.display = 'flex';
}

function msg(action, payload = {}) {
  return new Promise((res, rej) => {
    chrome.runtime.sendMessage({ action, ...payload }, (resp) => {
      if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
      else if (resp?.ok === false) rej(new Error(resp.error));
      else res(resp);
    });
  });
}

const AVATAR_COLORS = ['#f0a500','#ff6b6b','#4ade80','#60a5fa','#c084fc','#f472b6','#34d399','#fb923c'];
function avatarColor(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) & 0xffff; return AVATAR_COLORS[h % AVATAR_COLORS.length]; }
function initials(name) { return (name || '?').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2); }

// ─── Auth ──────────────────────────────────────────────────────────────────────

async function checkAuth() {
  const stored = await chrome.storage.local.get(['userEmail']);
  if (stored.userEmail) {
    state.userEmail = stored.userEmail;
    initDashboard();
  } else {
    showScreen('screen-login');
  }
}

document.getElementById('btn-login').addEventListener('click', async () => {
  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  try {
    const { email } = await msg('LOGIN');
    state.userEmail = email;
    await chrome.storage.local.set({ userEmail: email });
    initDashboard();
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18"><path d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 002.38-5.88c0-.57-.05-.66-.15-1.18z" fill="#4285F4"/><path d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 01-7.18-2.54H1.83v2.07A8 8 0 008.98 17z" fill="#34A853"/><path d="M4.5 10.52a4.8 4.8 0 010-3.04V5.41H1.83a8 8 0 000 7.18l2.67-2.07z" fill="#FBBC05"/><path d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 001.83 5.4L4.5 7.49a4.77 4.77 0 014.48-3.3z" fill="#EA4335"/></svg> Continue with Google`;
    alert('Login failed: ' + e.message);
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await msg('LOGOUT');
  await chrome.storage.local.remove(['userEmail']);
  state.userEmail = null;
  showScreen('screen-login');
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

async function initDashboard() {
  showScreen('screen-dashboard');
  const email = state.userEmail || '';
  document.getElementById('user-email').textContent = email;
  const av = document.getElementById('user-avatar');
  av.textContent = email[0]?.toUpperCase() || '?';
  av.style.background = `linear-gradient(135deg, ${avatarColor(email)}, ${avatarColor(email + '1')})`;

  try {
    const stats = await msg('GET_STATS');
    document.getElementById('stat-inbox').textContent = stats.totalInbox.toLocaleString();
    document.getElementById('stat-unread').textContent = stats.unreadCount.toLocaleString();
    document.getElementById('stat-spam').textContent = stats.spamCount.toLocaleString();
  } catch (e) {
    document.getElementById('stat-inbox').textContent = '—';
  }
}

document.getElementById('btn-analyze').addEventListener('click', openJunkScreen);
document.getElementById('btn-summarize').addEventListener('click', openSummaryScreen);
document.getElementById('btn-priority').addEventListener('click', () => openSummaryScreen('priority'));
document.getElementById('btn-scam').addEventListener('click', () => openSummaryScreen('scam'));
document.getElementById('btn-done-back').addEventListener('click', initDashboard);

// ─── Junk Screen ──────────────────────────────────────────────────────────────

async function openJunkScreen() {
  showScreen('screen-junk');
  state.selectedSenders = new Set();
  document.getElementById('senders-list').classList.add('hidden');
  document.getElementById('junk-empty').classList.add('hidden');
  document.getElementById('junk-footer').classList.add('hidden');
  document.getElementById('analyzing-state').classList.remove('hidden');

  try {
    // Start analysis — result comes via message listener
    await msg('ANALYZE_JUNK');
  } catch (e) {
    document.getElementById('analyzing-state').innerHTML = `<p style="color:#ff6b6b">Error: ${e.message}</p>`;
  }
}

// Listen for async analysis result
chrome.runtime.onMessage.addListener((m) => {
  if (m.action === 'ANALYSIS_DONE') {
    state.senders = m.senders || [];
    renderSenders();
  }
});

function renderSenders() {
  document.getElementById('analyzing-state').classList.add('hidden');
  const list = document.getElementById('senders-list');

  if (!state.senders.length) {
    document.getElementById('junk-empty').classList.remove('hidden');
    return;
  }

  list.innerHTML = '';
  state.senders.forEach((sender, i) => {
    const row = document.createElement('div');
    row.className = 'sender-row';
    row.dataset.index = i;
    const color = avatarColor(sender.domain);
    row.innerHTML = `
      <div class="sender-check"></div>
      <div class="sender-avatar" style="background:${color}">${initials(sender.displayName || sender.domain)}</div>
      <div class="sender-info">
        <div class="sender-name">${escHtml(sender.displayName || sender.domain)}</div>
        <div class="sender-email">${escHtml(sender.email)}</div>
      </div>
      <div class="sender-meta">
        <span class="sender-count">${sender.count}</span>
        ${sender.canUnsubscribe ? '<span class="unsub-tag">📧 unsub available</span>' : ''}
      </div>
    `;
    row.addEventListener('click', () => toggleSender(i, row));
    list.appendChild(row);
  });

  list.classList.remove('hidden');
  document.getElementById('junk-footer').classList.remove('hidden');
  updateFooter();
}

function toggleSender(i, row) {
  if (state.selectedSenders.has(i)) {
    state.selectedSenders.delete(i);
    row.classList.remove('selected');
  } else {
    state.selectedSenders.add(i);
    row.classList.add('selected');
  }
  updateFooter();
}

function updateFooter() {
  const n = state.selectedSenders.size;
  document.getElementById('selected-count').textContent = `${n} sender${n !== 1 ? 's' : ''} selected`;
  document.getElementById('btn-delete-selected').disabled = n === 0;
}

document.getElementById('btn-select-all').addEventListener('click', () => {
  const rows = document.querySelectorAll('.sender-row');
  const allSelected = state.selectedSenders.size === state.senders.length;
  state.selectedSenders.clear();
  rows.forEach((row, i) => {
    row.classList.remove('selected');
    if (!allSelected) { state.selectedSenders.add(i); row.classList.add('selected'); }
  });
  updateFooter();
});

document.getElementById('back-from-junk').addEventListener('click', initDashboard);

document.getElementById('btn-delete-selected').addEventListener('click', () => {
  if (!state.selectedSenders.size) return;
  const senders = [...state.selectedSenders].map(i => state.senders[i]);
  const canUnsub = senders.some(s => s.canUnsubscribe);
  const totalMsgs = senders.reduce((s, r) => s + r.count, 0);

  state.pendingDelete = senders;
  document.getElementById('confirm-title').textContent = `Delete emails from ${senders.length} sender${senders.length > 1 ? 's' : ''}?`;
  document.getElementById('confirm-desc').textContent = `This will permanently delete ${totalMsgs} emails. This cannot be undone.`;
  document.getElementById('unsub-option').style.display = canUnsub ? '' : 'none';
  document.getElementById('chk-delete-all').checked = false;
  showScreen('screen-confirm');
});

document.getElementById('btn-cancel-delete').addEventListener('click', () => showScreen('screen-junk'));

document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
  const btn = document.getElementById('btn-confirm-delete');
  btn.disabled = true;
  btn.textContent = 'Deleting…';

  const deleteAll = document.getElementById('chk-delete-all').checked;
  const doUnsub = document.getElementById('chk-unsub').checked;
  let totalDeleted = 0;

  try {
    for (const sender of state.pendingDelete) {
      const resp = await msg('DELETE_SENDER', {
        email: sender.email,
        messageIds: sender.messageIds,
        deleteAll,
      });
      totalDeleted += resp.deleted || 0;

      // Handle unsubscribe — open link in new tab
      if (doUnsub && sender.canUnsubscribe && sender.unsubscribeLink) {
        const link = sender.unsubscribeLink.match(/https?:\/\/[^\s>]+/)?.[0];
        if (link) chrome.tabs.create({ url: link, active: false });
      }
    }

    document.getElementById('done-title').textContent = 'Inbox Cleaned!';
    document.getElementById('done-desc').textContent = `Successfully deleted ${totalDeleted} emails from ${state.pendingDelete.length} sender${state.pendingDelete.length > 1 ? 's' : ''}.`;
    showScreen('screen-done');
    // Refresh stats
    setTimeout(async () => {
      try {
        const stats = await msg('GET_STATS');
        document.getElementById('stat-inbox').textContent = stats.totalInbox.toLocaleString();
        document.getElementById('stat-unread').textContent = stats.unreadCount.toLocaleString();
      } catch (e) {}
    }, 2000);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Try Again';
    alert('Error: ' + e.message);
  }
});

// ─── Summary / Priority / Scam Screen ─────────────────────────────────────────

async function openSummaryScreen(mode = 'summary') {
  showScreen('screen-summary');
  document.getElementById('summary-loading').classList.remove('hidden');
  document.getElementById('summary-content').classList.add('hidden');

  try {
    // Fetch recent message metadata (subjects/senders only — no body)
    const token = await new Promise((res, rej) => {
      chrome.identity.getAuthToken({ interactive: false }, (t) => {
        if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
        else res(t);
      });
    });

    const query = mode === 'scam' ? 'is:unread' : 'is:unread is:inbox';
    const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=30`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const listData = await listRes.json();
    const messages = listData.messages || [];

    // Fetch metadata (subject + from only, never body)
    const details = await Promise.all(messages.slice(0, 20).map(async (m) => {
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const d = await r.json();
      const getH = name => d.payload?.headers?.find(h => h.name === name)?.value || '';
      return { subject: getH('Subject'), from: getH('From'), date: getH('Date') };
    }));

    // Call AI with just subject lines — never email bodies
    const emailList = details.map((d, i) => `${i + 1}. From: ${d.from} | Subject: ${d.subject}`).join('\n');
    const prompts = {
      summary: `You are a helpful email assistant. Based ONLY on these email subjects and senders (no body content), provide a brief digest. Group by importance. Be concise.

Emails:
${emailList}

Respond in this JSON format:
{"urgent":["..."],"important":["..."],"newsletters":["..."]}`,

      priority: `Based on these email subjects, identify the top 5 most urgent/important ones and explain why briefly.

Emails:
${emailList}

JSON format: {"priority":[{"subject":"...","from":"...","reason":"..."}]}`,

      scam: `Analyze these email subjects for scam/phishing indicators. Flag any suspicious ones.

Emails:
${emailList}

JSON format: {"flagged":[{"subject":"...","from":"...","risk":"high|medium","reason":"..."}],"safe_count":N}`,
    };

    // ── PROXY URL ── Replace with your deployed proxy URL after running: vercel deploy
    // See README.md Step 4 for full deployment instructions.
    const PROXY_URL = 'https://proxy-rose-kappa-75.vercel.app/api/ai';

    // Call via secure proxy (keeps API key off client — subjects only, never email bodies)
    const aiRes = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: 'You analyze email metadata (subjects/senders) only. Never ask for email body content. Respond only with valid JSON.',
        messages: [{ role: 'user', content: prompts[mode] }],
      }),
    });

    const aiData = await aiRes.json();
    let parsed = {};
    try {
      const text = aiData.content?.[0]?.text || '{}';
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch (e) { parsed = { error: 'Could not parse AI response' }; }

    renderSummary(mode, parsed);
  } catch (e) {
    document.getElementById('summary-loading').innerHTML = `<p style="color:#ff6b6b">Error: ${e.message}</p>`;
  }
}

function renderSummary(mode, data) {
  document.getElementById('summary-loading').classList.add('hidden');
  const content = document.getElementById('summary-content');
  content.classList.remove('hidden');
  content.innerHTML = '';

  if (mode === 'summary') {
    if (data.urgent?.length) {
      content.innerHTML += section('🔴 Urgent', data.urgent.map(s => item(s, 'urgent')));
    }
    if (data.important?.length) {
      content.innerHTML += section('⭐ Important', data.important.map(s => item(s)));
    }
    if (data.newsletters?.length) {
      content.innerHTML += section('📰 Newsletters', data.newsletters.map(s => item(s)));
    }
  } else if (mode === 'priority') {
    const items = (data.priority || []).map(p => item(`<strong>${escHtml(p.subject)}</strong><br/><small>${escHtml(p.reason)}</small>`, 'urgent'));
    content.innerHTML = section('🎯 Top Priority', items);
  } else if (mode === 'scam') {
    if (data.flagged?.length) {
      const items = data.flagged.map(f => item(`<strong>${escHtml(f.subject)}</strong><br/><small>Risk: ${f.risk} — ${escHtml(f.reason)}</small>`, 'scam'));
      content.innerHTML = section('⚠️ Suspicious Emails', items);
    }
    const safe = data.safe_count || 0;
    content.innerHTML += `<div style="padding:16px;text-align:center;color:var(--text-2);font-size:12px">${safe} emails appear safe</div>`;
  }

  if (!content.innerHTML.trim()) {
    content.innerHTML = '<div class="empty-state" style="height:200px"><div class="empty-icon">📭</div><p>Nothing to show</p></div>';
  }
}

function section(title, itemsHtml) {
  return `<div class="digest-section"><div class="digest-title">${title}</div>${itemsHtml.join('')}</div>`;
}
function item(text, cls = '') {
  return `<div class="digest-item ${cls}">${text}</div>`;
}

document.getElementById('back-from-summary').addEventListener('click', initDashboard);

// ─── Utils ────────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
checkAuth();
