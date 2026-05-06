# MailZen — Gmail Cleaner & AI Summarizer
### A privacy-first Chrome Extension

> Remove junk. Summarize what matters. Detect scams. Zero data leakage.

---

## Features

| Feature | Description |
|---|---|
| 🧹 **Junk Cleaner** | Finds emails unread for 30+ days, grouped by sender. Batch delete with one tap. |
| 📧 **Unsubscribe** | Detects `List-Unsubscribe` headers and opens unsubscribe links automatically. |
| ✨ **AI Digest** | Summarizes recent inbox using subject lines only — never email bodies. |
| 🎯 **Priority Detection** | Surfaces your most urgent unread emails using AI. |
| 🔍 **Scam Detection** | Flags phishing and fraud using local heuristics + AI subject analysis. |
| 🛡️ **Privacy First** | OAuth only. No email bodies ever read. No data stored server-side. |

---

## Project Structure

```
gmail-cleaner/
├── manifest.json              # Chrome Extension v3 manifest
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── popup/
│   ├── popup.html             # Extension UI (all screens)
│   ├── popup.css              # Dark luxury styling
│   └── popup.js               # UI logic & Gmail API calls
├── background/
│   └── service-worker.js      # Gmail API, delete, analysis logic
├── proxy/
│   ├── server.js              # Anthropic API proxy (Node/Express)
│   ├── package.json
│   └── vercel.json            # One-click Vercel deploy config
└── privacy-policy.html        # Hosted privacy policy page
```

---

## Setup Guide

### Step 1 — Google Cloud Console (OAuth)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project → name it **MailZen**
3. Go to **APIs & Services → Library** → enable **Gmail API**
4. Go to **APIs & Services → OAuth consent screen**
   - User type: **External**
   - App name: `MailZen`
   - Add scopes:
     - `https://www.googleapis.com/auth/gmail.modify`
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/userinfo.email`
   - Add your Gmail as a **test user**
5. Go to **APIs & Services → Credentials → Create Credentials → OAuth Client ID**
   - Application type: **Chrome Extension**
   - Extension ID: (get this after loading unpacked — see Step 3)
6. Copy the **Client ID** (looks like `xxxx.apps.googleusercontent.com`)

### Step 2 — Add Client ID to Manifest

Open `manifest.json` and replace:
```json
"client_id": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
```
with your actual client ID.

### Step 3 — Load Extension in Chrome

1. Open Chrome → navigate to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `gmail-cleaner/` folder
5. Note the **Extension ID** shown (e.g., `abcdefghijklmnopqrstuvwxyzabcdef`)
6. Go back to Google Cloud Console and add this Extension ID to your OAuth credential

### Step 4 — Deploy the Proxy Server (for AI features)

The proxy keeps your Anthropic API key off the client.

**Option A: Vercel (recommended, free)**
```bash
cd proxy/
npm install
npm i -g vercel
vercel login
vercel env add ANTHROPIC_API_KEY   # paste your sk-ant-... key
vercel deploy --prod
```
Copy the deployment URL (e.g. `https://mailzen-proxy.vercel.app`)

**Option B: Railway / Render**
- Connect your GitHub repo
- Set env var: `ANTHROPIC_API_KEY=sk-ant-...`
- Deploy

**Option C: Run locally (for development)**
```bash
cd proxy/
npm install
ANTHROPIC_API_KEY=sk-ant-... node server.js
# Proxy runs at http://localhost:3000
```

### Step 5 — Point Extension to Your Proxy

In `popup/popup.js`, find and update the proxy URL:
```js
// Around line 130 — replace with your deployed proxy URL
const aiRes = await fetch('https://YOUR-PROXY-URL.vercel.app/api/ai', {
```

### Step 6 — Update Privacy Policy URL

In `popup/popup.html`, update the privacy policy link:
```html
<a href="https://your-domain.com/privacy-policy.html" id="privacy-link">Privacy Policy</a>
```
Host `privacy-policy.html` on GitHub Pages, Vercel, or any static host.

---

## Publishing to Chrome Web Store

1. Zip the extension folder (NOT the proxy folder):
   ```bash
   cd gmail-cleaner/
   zip -r ../mailzen-extension.zip . --exclude "proxy/*" --exclude "*.md"
   ```
2. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Pay one-time $5 developer fee
4. Upload the zip, fill in:
   - Description (use the feature table above)
   - Screenshots (at least 1280×800)
   - Privacy practices (link your privacy policy)
5. Submit for review (typically 1–3 business days)

---

## Privacy Architecture

```
User's Browser
    │
    ├── Gmail API (OAuth) ──────► Google Servers
    │   Headers/metadata only         (official API)
    │   No email bodies ever
    │
    └── AI Features ────────────► Your Proxy Server ──► Anthropic API
        Subject lines only              (your Vercel)     (claude-sonnet)
        Session only, not stored
```

**What never leaves the browser:**
- Email body content
- Full email metadata
- OAuth tokens
- User's email address

---

## Development

```bash
# After making changes to popup/ or background/
# Go to chrome://extensions and click the refresh icon on MailZen

# To debug the popup:
# Right-click the extension icon → Inspect popup

# To debug the service worker:
# chrome://extensions → MailZen → "Service Worker" link
```

---

## Tech Stack

- **Extension:** Chrome Extension Manifest V3, vanilla JS
- **Gmail:** Google OAuth 2.0 + Gmail REST API
- **AI:** Anthropic Claude (via secure proxy)
- **Proxy:** Node.js + Express, deployable to Vercel
- **Fonts:** DM Serif Display + DM Sans (Google Fonts)

---

## License

MIT — use freely, but don't sell user data. Ever.
