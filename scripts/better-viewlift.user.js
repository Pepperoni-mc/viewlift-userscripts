// ==UserScript==
// @name         Better Viewlift
// @namespace    https://github.com/Pepperoni-mc/viewlift-userscripts
// @version      3.31.1
// @author       Happy, Potato
// @description  Unified ViewLift toolkit for Freshdesk and CMS: case actions, CMS email search, Set Agent, refund capture, reply cleanup, screenshots, session autofill, and workflow improvements.
// @match        https://viewlift.freshdesk.com/*
// @match        https://cms.viewlift.com/*
// @match        https://cms-gcp.viewlift.com/*
// @match        https://cms-qcp.viewlift.com/*
// @match        https://cms.monumentalsportsnetwork.com/*
// @updateURL    https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-viewlift.user.js
// @downloadURL  https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-viewlift.user.js
// @run-at       document-idle
// @require      https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      cms.viewlift.com
// @connect      cms-gcp.viewlift.com
// @connect      cms-qcp.viewlift.com
// @connect      cms.monumentalsportsnetwork.com
// @connect      viewlift.freshdesk.com
// ==/UserScript==

(function () {
  'use strict';

  const installMarker = document.documentElement;
  if (!installMarker || installMarker.hasAttribute('data-better-viewlift-installed')) return;
  installMarker.setAttribute('data-better-viewlift-installed', '3.26.0');

  function isCMSHost(hostname = location.hostname) {
    return /^(?:cms(?:-gcp|-qcp)?\.viewlift\.com|cms\.monumentalsportsnetwork\.com)$/i.test(hostname);
  }

  function waitFor(predicateFn, { timeout = 5000, pollMs = 50 } = {}) {
    return new Promise(resolve => {
      const startedAt = Date.now();

      function check() {
        let value = null;

        try {
          value = predicateFn();
        } catch (error) {
          value = null;
        }

        if (value) {
          resolve(value);
          return;
        }

        if (Date.now() - startedAt >= timeout) {
          resolve(null);
          return;
        }

        setTimeout(check, pollMs);
      }

      check();
    });
  }

  const ROUTE_CHANGE_EVENT = 'better-viewlift-routechange';
  let routeChangeEngineStarted = false;
  let routeChangeObserver = null;

  function dispatchRouteChange() {
    document.dispatchEvent(new CustomEvent(ROUTE_CHANGE_EVENT));
  }

  function startRouteChangeEngine() {
    if (routeChangeEngineStarted) return;
    routeChangeEngineStarted = true;

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function () {
      const result = originalPushState.apply(this, arguments);
      dispatchRouteChange();
      return result;
    };

    history.replaceState = function () {
      const result = originalReplaceState.apply(this, arguments);
      dispatchRouteChange();
      return result;
    };

    window.addEventListener('popstate', dispatchRouteChange);
    window.addEventListener('hashchange', dispatchRouteChange);
    window.setInterval(dispatchRouteChange, 5000);

    function observeBody() {
      if (routeChangeObserver || !document.body) return;

      let timer = null;
      routeChangeObserver = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(dispatchRouteChange, 100);
      });

      routeChangeObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    observeBody();
  }

  function onRouteChange(callback) {
    startRouteChangeEngine();
    document.addEventListener(ROUTE_CHANGE_EVENT, callback);
    queueMicrotask(callback);

    return function removeRouteChangeListener() {
      document.removeEventListener(ROUTE_CHANGE_EVENT, callback);
    };
  }

  // Shared GM storage key names for producer/consumer pairs that used to
  // each declare their own local copy of the same string literal - a typo
  // or rename on one side would silently break the pairing with no error.
  const BV_SNAPSHOT_KEY = 'betterFreshdeskPendingSnapshot';
  const BV_CANNED_RESPONSE_GLOBAL_KEY = '__betterFreshdeskCannedResponseProtectionUntil';
  const BV_CANNED_RESPONSE_LOCK_ATTR = 'data-better-freshdesk-canned-response-lock';
  const BV_CMS_KEEP_ALIVE_STATUS_KEY = 'betterViewliftCmsSessionStatus';

  // Shared visible-notification system. Several real bugs today were
  // "silent failures" - things that only ever logged to a console.warn
  // nobody reads (CMS session dying, a lookup silently falling back to a
  // worse method). Anything worth an agent actually knowing about should
  // go through here instead of console.* alone, so it shows up on-screen
  // wherever they are (Freshdesk or CMS) instead of requiring someone to
  // dig through DevTools after the fact.
  const BV_NOTIFY_CONTAINER_ID = 'better-viewlift-notify-stack';
  const BV_NOTIFY_STYLE_ID = 'better-viewlift-notify-style';

  function bvEnsureNotifyStyles() {
    if (document.getElementById(BV_NOTIFY_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = BV_NOTIFY_STYLE_ID;
    style.textContent = `
      #${BV_NOTIFY_CONTAINER_ID} {
        position: fixed !important;
        top: 16px !important;
        right: 16px !important;
        z-index: 2147483600 !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 8px !important;
        max-width: 340px !important;
        pointer-events: none !important;
      }

      .bv-notify-item {
        pointer-events: auto !important;
        padding: 10px 13px !important;
        border-radius: 10px !important;
        font: 600 12.5px Arial, sans-serif !important;
        line-height: 1.4 !important;
        box-shadow: 0 10px 24px rgba(15, 23, 42, .22) !important;
        cursor: pointer !important;
        animation: bv-notify-in 160ms ease !important;
      }

      .bv-notify-item[data-level="warn"] {
        background: linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%) !important;
        color: #92400e !important;
        border: 1px solid #fcd34d !important;
      }

      .bv-notify-item[data-level="error"] {
        background: linear-gradient(180deg, #fef2f2 0%, #fee2e2 100%) !important;
        color: #991b1b !important;
        border: 1px solid #fca5a5 !important;
      }

      .bv-notify-item[data-level="info"] {
        background: linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%) !important;
        color: #1e40af !important;
        border: 1px solid #93c5fd !important;
      }

      @keyframes bv-notify-in {
        from { opacity: 0; transform: translateY(-6px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  function bvGetNotifyContainer() {
    let container = document.getElementById(BV_NOTIFY_CONTAINER_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = BV_NOTIFY_CONTAINER_ID;
      (document.body || document.documentElement).appendChild(container);
    }
    return container;
  }

  function bvNotify(message, options = {}) {
    if (!document.body && !document.documentElement) return null;

    const level = options.level || 'warn';
    const ttl = options.ttl || 7000;

    bvEnsureNotifyStyles();

    const item = document.createElement('div');
    item.className = 'bv-notify-item';
    item.dataset.level = level;
    item.textContent = message;
    item.title = 'Click to dismiss';
    item.addEventListener('click', () => item.remove());

    bvGetNotifyContainer().appendChild(item);
    window.setTimeout(() => item.remove(), ttl);

    return item;
  }

  // Freshdesk API key - entered by each user themselves via the menu command
  // below (GM storage, per-install), never read, logged, or transmitted by
  // anything else in this script. Used only for the same-origin Freshdesk
  // v2 REST API (Basic Auth: apiKey as username, "X" as password, per
  // Freshdesk's documented convention).
  const BV_FRESHDESK_API_KEY_KEY = 'betterFreshdeskApiKey';

  function getFreshdeskApiKey() {
    try {
      return String(GM_getValue(BV_FRESHDESK_API_KEY_KEY, '') || '').trim();
    } catch (error) {
      return '';
    }
  }

  function promptForFreshdeskApiKey() {
    const hasKey = !!getFreshdeskApiKey();
    const input = window.prompt(
      'Freshdesk API Key.\n\nProfile picture (top right) > Profile settings > "View API Key" ' +
      '(confirms with your password) > copy the key and paste it below.\n\n' +
      (hasKey ? 'A key is already saved - leave this blank and press OK to clear it.' : ''),
      ''
    );
    if (input === null) return;

    const trimmed = input.trim();
    try {
      if (!trimmed) {
        GM_deleteValue(BV_FRESHDESK_API_KEY_KEY);
        bvNotify('Freshdesk API key cleared.', { level: 'info', ttl: 4000 });
      } else {
        GM_setValue(BV_FRESHDESK_API_KEY_KEY, trimmed);
        bvNotify('Freshdesk API key saved.', { level: 'info', ttl: 4000 });
      }
    } catch (error) {
      console.warn('[Freshdesk API] Could not save the API key.', error);
    }
  }

  try {
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('Freshdesk: Set API Key', promptForFreshdeskApiKey);
    }
  } catch (error) {
    console.warn('[Freshdesk API] Could not register the menu command.', error);
  }

  function freshdeskApiRequest({ method = 'GET', path, body, onDone }) {
    const apiKey = getFreshdeskApiKey();
    if (!apiKey) {
      onDone(new Error('no-api-key'), null);
      return;
    }

    GM_xmlhttpRequest({
      method,
      url: `https://${location.hostname}${path}`,
      headers: Object.assign(
        { Authorization: 'Basic ' + btoa(apiKey + ':X') },
        body ? { 'Content-Type': 'application/json' } : {}
      ),
      data: body ? JSON.stringify(body) : undefined,
      timeout: 15000,
      onload: function (response) {
        if (response.status === 401 || response.status === 403) {
          onDone(new Error('unauthorized'), null);
          return;
        }
        if (response.status < 200 || response.status >= 300) {
          const httpError = new Error('http-' + response.status);
          // Freshdesk's v2 API returns a JSON body describing exactly which
          // field/value it rejected (e.g. a custom field validation error) -
          // surfacing it is the difference between "http-400" (useless) and
          // an actionable reason.
          httpError.responseBody = response.responseText || '';
          onDone(httpError, null);
          return;
        }
        try {
          onDone(null, response.responseText ? JSON.parse(response.responseText) : {});
        } catch (error) {
          onDone(error, null);
        }
      },
      onerror: function () { onDone(new Error('network-error'), null); },
      ontimeout: function () { onDone(new Error('timeout'), null); }
    });
  }

  (function () {
/* ============================================================
 * Feature 1: Refund Capture Tool Enhanced
 * Source: Refund Capture Tool Enhanced 2.8
 * ============================================================ */

(function () {
  'use strict';

  if (window.__refundCaptureToolEnhancedInstalled) {
    return;
  }

  window.__refundCaptureToolEnhancedInstalled = true;

  const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const STORAGE_KEYS = {
    email: 'Refund Email',
    freshdesk: 'Freshdesk ID',
    cms: 'CMS URL for User',
    cmsUserId: 'CMS User ID',
    payment: 'Payment Handler',
    amount: 'Amount Refunded',
    client: 'Refund Client',
    activeTicket: 'Refund Active Ticket',
    activeEmail: 'Refund Active Email',
    lastSource: 'Refund Last Capture Source',
    lastCaptureAt: 'Refund Last Capture At',
    syncPing: 'Refund Cross Tab Sync Ping'
  };

  const REFUND_SHEET_URLS = {
    tbl: 'https://docs.google.com/spreadsheets/d/1f6uuak92FiHwq3GFUJ98IKbN9lI6BmWRfC_qcLLrcrM/edit?gid=469886271#gid=469886271',
    schn: 'https://docs.google.com/spreadsheets/d/1f6uuak92FiHwq3GFUJ98IKbN9lI6BmWRfC_qcLLrcrM/edit?gid=273386395#gid=273386395',
    altitude: 'https://docs.google.com/spreadsheets/d/1f6uuak92FiHwq3GFUJ98IKbN9lI6BmWRfC_qcLLrcrM/edit?gid=716064238#gid=716064238',
    msn: 'https://docs.google.com/spreadsheets/d/1f6uuak92FiHwq3GFUJ98IKbN9lI6BmWRfC_qcLLrcrM/edit?gid=291960457#gid=291960457',
    vgk: 'https://docs.google.com/spreadsheets/d/1f6uuak92FiHwq3GFUJ98IKbN9lI6BmWRfC_qcLLrcrM/edit?gid=1160085053#gid=1160085053',
    chsn: 'https://docs.google.com/spreadsheets/d/1f6uuak92FiHwq3GFUJ98IKbN9lI6BmWRfC_qcLLrcrM/edit?gid=1893212316#gid=1893212316',
    fox: 'https://docs.google.com/spreadsheets/d/1f6uuak92FiHwq3GFUJ98IKbN9lI6BmWRfC_qcLLrcrM/edit?gid=1677210455#gid=1677210455',
    rootsport: 'https://docs.google.com/spreadsheets/d/1f6uuak92FiHwq3GFUJ98IKbN9lI6BmWRfC_qcLLrcrM/edit?gid=285382536#gid=285382536',
    livgolf: 'https://docs.google.com/spreadsheets/d/1f6uuak92FiHwq3GFUJ98IKbN9lI6BmWRfC_qcLLrcrM/edit?gid=133679065#gid=133679065',
    dirt: 'https://docs.google.com/spreadsheets/d/1f6uuak92FiHwq3GFUJ98IKbN9lI6BmWRfC_qcLLrcrM/edit?gid=735614001#gid=735614001',
    lnp: 'https://docs.google.com/spreadsheets/d/1f6uuak92FiHwq3GFUJ98IKbN9lI6BmWRfC_qcLLrcrM/edit?gid=0#gid=0'
  };

  const REFUND_SHEET_DATE_FIRST = new Set(['msn', 'vgk', 'chsn', 'fox']);

  const BLOCKED_EMAILS = [
    'sc-appsupport@spacecityhn.com',
    'support@livgolfplus.com',
    'customersupport@altitudeplus.com',
    'customer.support@altitudeplus.com',
    'support@altitudeplus.com'
  ];

  const BAD_PAYMENT_LABELS = [
    'payment handler',
    'payment gateway',
    'payment processor',
    'gateway',
    'processor'
  ];

  const CMS_USER_ID_RE = /\/users\/(?:search\/)?([0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const CMS_USER_URL_RE = /https:\/\/(?:cms(?:-gcp|-qcp)?\.viewlift\.com|cms\.monumentalsportsnetwork\.com)\/users\/(?:search\/)?(?:[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[^\s"'<>]*)?/ig;
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;

  const PAYMENT_PATTERNS = [
    { re: /\bSTRIPE\b/i, value: 'Stripe' },
    { re: /\bANDROID\b|\bGOOGLE\b|\bGOOGLE\s*PLAY\b|\bPLAY\s*STORE\b/i, value: 'Google' },
    { re: /\bAPPLE\b|\bAPP\s*STORE\b|\bIOS\b|\bITUNES\b/i, value: 'Apple' },
    { re: /\bROKU\b/i, value: 'Roku' },
    { re: /\bPAYPAL\b/i, value: 'PayPal' },
    { re: /\bAMAZON\b/i, value: 'Amazon' },
    { re: /\bSAMSUNG\b/i, value: 'Samsung' },
    { re: /\bVIZIO\b/i, value: 'Vizio' }
  ];

  const CURRENCY_CODE_RE_SOURCE = '(?:USD|ZAR|EUR|GBP|CAD|AUD|NZD|BRL|MXN|ARS|CLP|COP|PEN|INR|JPY|KRW|SGD|HKD|CHF|SEK|NOK|DKK|PLN)';
  const CURRENCY_CODE_RE = new RegExp('\\b' + CURRENCY_CODE_RE_SOURCE + '\\b', 'i');
  const AMOUNT_RE = new RegExp('(?:' + CURRENCY_CODE_RE_SOURCE + '|US\\$|\\$|€|£|R)\\s*\\d{1,5}(?:,\\d{3})*(?:\\.\\d{2})?|\\d{1,5}(?:,\\d{3})*(?:\\.\\d{2})\\s*' + CURRENCY_CODE_RE_SOURCE, 'i');
  const AMOUNT_RE_GLOBAL = new RegExp('(?:' + CURRENCY_CODE_RE_SOURCE + '|US\\$|\\$|€|£|R)\\s*\\d{1,5}(?:,\\d{3})*(?:\\.\\d{2})?|\\d{1,5}(?:,\\d{3})*(?:\\.\\d{2})\\s*' + CURRENCY_CODE_RE_SOURCE, 'ig');
  const BARE_AMOUNT_RE = /^\d{1,5}(?:,\d{3})*(?:\.\d{2})$/;

  let lastRefundToolUrl = location.href;
  let refundToolRouteTimer = null;
  let lastCaptureRunAt = 0;
  const CAPTURE_COOLDOWN_MS = 2500;
  let cachedPageLines = [];
  let cachedPageLinesAt = 0;
  const PAGE_SCAN_CACHE_MS = 4000;

  function isFreshdeskHost() {
    return location.hostname === 'viewlift.freshdesk.com';
  }

  function isRefundToolBlockedRoute() {
    if (!isFreshdeskHost()) return false;

    const pathname = location.pathname.replace(/\/+$/, '') || '/';

    return (
      pathname === '/a/tickets' ||
      pathname === '/a/tickets/filters/781604'
    );
  }

  function isCMSUserPage() {
    return isCMSHost() && /^\/users(?:\/|$)/i.test(location.pathname);
  }

  function isSupportedPage() {
    return (isFreshdeskHost() && !isRefundToolBlockedRoute()) || isCMSUserPage();
  }

  function removeUI() {
    const panel = document.getElementById('refund-capture-panel');
    if (panel) panel.remove();
  }

  function cleanText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function safeGet(key, fallback = '') {
    try {
      return GM_getValue(key, fallback);
    } catch (error) {
      return fallback;
    }
  }

  function safeSet(key, value) {
    const next = cleanText(value);
    if (!next) return false;

    const previous = safeGet(key, '');
    if (previous === next) return false;

    GM_setValue(key, next);
    return true;
  }

  function forceSet(key, value) {
    const next = cleanText(value);
    if (!next) return false;

    GM_setValue(key, next);
    return true;
  }

  function safeDelete(key) {
    try {
      GM_deleteValue(key);
    } catch (error) {
      // Ignore delete errors.
    }
  }

  function recordSync(source, reason) {
    forceSet(STORAGE_KEYS.lastSource, source);
    forceSet(STORAGE_KEYS.lastCaptureAt, new Date().toISOString());

    GM_setValue(STORAGE_KEYS.syncPing, JSON.stringify({
      source,
      reason,
      tabId: TAB_ID,
      href: location.href,
      at: new Date().toISOString()
    }));
  }

  function isBlockedEmail(email) {
    const lower = cleanText(email).toLowerCase();

    if (!lower) return true;
    if (/@viewlift\.com$/i.test(lower)) return true;
    if (BLOCKED_EMAILS.includes(lower)) return true;
    if (lower.includes('customersupport@altitudeplus.com')) return true;
    if (lower.includes('sc-appsupport@spacecityhn.com')) return true;
    if (lower.includes('support@livgolfplus.com')) return true;

    return false;
  }

  function isBadPaymentValue(value) {
    const lower = cleanText(value).toLowerCase();
    return BAD_PAYMENT_LABELS.includes(lower);
  }

  function cleanStoredBadValues() {
    const storedEmail = safeGet(STORAGE_KEYS.email, '');
    const storedPayment = safeGet(STORAGE_KEYS.payment, '');

    if (isBlockedEmail(storedEmail)) safeDelete(STORAGE_KEYS.email);
    if (isBadPaymentValue(storedPayment)) safeDelete(STORAGE_KEYS.payment);
  }

  function stripPaymentLabel(value) {
    return cleanText(value)
      .replace(/^payment\s*handler\s*:?\s*/i, '')
      .replace(/^payment\s*gateway\s*:?\s*/i, '')
      .replace(/^payment\s*processor\s*:?\s*/i, '')
      .replace(/^gateway\s*:?\s*/i, '')
      .replace(/^processor\s*:?\s*/i, '')
      .trim();
  }

  function findPaymentHandlerInText(text) {
    const stripped = stripPaymentLabel(text);

    if (!stripped) return '';
    if (isBadPaymentValue(stripped)) return '';

    for (const pattern of PAYMENT_PATTERNS) {
      if (pattern.re.test(stripped)) return pattern.value;
    }

    return '';
  }

  function getTodayShortDate() {
    const today = new Date();
    return `${today.getMonth() + 1}-${today.getDate()}`;
  }

  function getFreshdeskTicketURL() {
    const match = location.href.match(/\/tickets\/(\d+)/i);
    return match ? `https://viewlift.freshdesk.com/a/tickets/${match[1]}` : '';
  }

  function getCMSUserIdFromURL(url) {
    const match = String(url || '').match(CMS_USER_ID_RE);
    return match ? match[1] : '';
  }

  function normalizeCMSUrl(url) {
    const id = getCMSUserIdFromURL(url);
    if (!id) return cleanText(url);

    const hostMatch = String(url || '').match(/^https:\/\/((?:cms(?:-gcp|-qcp)?\.viewlift\.com|cms\.monumentalsportsnetwork\.com))/i);
    const host = hostMatch ? hostMatch[1].toLowerCase() : location.hostname.toLowerCase();

    return `https://${host}/users/${id}`;
  }

  function isIgnoredElement(element) {
    if (!element || element.nodeType !== 1) return false;
    return Boolean(element.closest('#refund-capture-panel, script, style, noscript'));
  }

  function isVisibleElement(element) {
    if (!element || element.nodeType !== 1) return false;
    if (isIgnoredElement(element)) return false;

    const style = window.getComputedStyle(element);

    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;

    return true;
  }

  function getPageLinesOutsidePanel() {
    const now = Date.now();
    if (cachedPageLines.length && now - cachedPageLinesAt < PAGE_SCAN_CACHE_MS) {
      return cachedPageLines;
    }

    const lines = [];

    const add = value => {
      const text = cleanText(value);
      if (text) lines.push(text);
    };

    document.querySelectorAll('body *').forEach(element => {
      if (!isVisibleElement(element)) return;

      if (element.matches('input, textarea, select')) {
        add(element.value);
        return;
      }

      const visibleChildren = Array.from(element.children || []).filter(child => isVisibleElement(child));

      if (!visibleChildren.length) {
        add(element.innerText || element.textContent);
      }
    });

    cachedPageLines = lines;
    cachedPageLinesAt = now;
    return cachedPageLines;
  }

  function queryOutsidePanel(selector) {
    return Array.from(document.querySelectorAll(selector)).filter(element => !isIgnoredElement(element));
  }

  function extractEmailFromText(text) {
    const matches = String(text || '').match(EMAIL_RE) || [];

    for (const match of matches) {
      const email = cleanText(match).replace(/\u00a0/g, '').trim();

      if (!email) continue;
      if (isBlockedEmail(email)) continue;

      return email;
    }

    return '';
  }

  function findFreshdeskRequesterEmail() {
    const directEmailNodes = queryOutsidePanel(
      'p.break-all, [class~="break-all"], [class*="break-all"]'
    );

    for (const node of directEmailNodes) {
      const email = extractEmailFromText(node.innerText || node.textContent || '');
      if (email && !isBlockedEmail(email)) return email;
    }

    const lines = getPageLinesOutsidePanel();

    for (let i = 0; i < lines.length; i++) {
      if (!/^contact info$/i.test(lines[i])) continue;

      const block = lines.slice(i, i + 100);

      for (let j = 0; j < block.length; j++) {
        if (!/^email$/i.test(block[j])) continue;

        for (let k = j + 1; k < Math.min(block.length, j + 10); k++) {
          const email = extractEmailFromText(block[k]);
          if (email && !isBlockedEmail(email)) return email;
        }
      }

      const fallbackEmail = extractEmailFromText(block.join('\n'));
      if (fallbackEmail && !isBlockedEmail(fallbackEmail)) return fallbackEmail;
    }

    for (const line of lines) {
      const email = extractEmailFromText(line);
      if (email && !isBlockedEmail(email)) return email;
    }

    return '';
  }

  function findCMSPageEmail() {
    const lines = getPageLinesOutsidePanel();

    for (const line of lines.slice(0, 50)) {
      const email = extractEmailFromText(line);
      if (email && !isBlockedEmail(email)) return email;
    }

    return extractEmailFromText(lines.join('\n'));
  }

  function findEmailOnPage() {
    if (isFreshdeskHost()) return findFreshdeskRequesterEmail();
    if (isCMSHost()) return findCMSPageEmail();

    return extractEmailFromText(getPageLinesOutsidePanel().join('\n'));
  }

  function findCMSUrlOnPage() {
    if (isCMSHost()) {
      const id = getCMSUserIdFromURL(location.href);
      if (id) return normalizeCMSUrl(location.href);

      if (/^\/users(?:\/|$)/i.test(location.pathname)) {
        return normalizeCMSUrl(location.href);
      }
    }

    const links = queryOutsidePanel('a[href]');

    for (const link of links) {
      const href = link.href || '';
      if (getCMSUserIdFromURL(href)) return normalizeCMSUrl(href);
    }

    const text = getPageLinesOutsidePanel().join('\n');
    const matches = text.match(CMS_USER_URL_RE) || [];

    if (matches.length) return normalizeCMSUrl(matches[0]);

    return '';
  }

  function cleanAmount(value) {
    return cleanText(value)
      .replace(/^amount\s*:?\s*/i, '')
      .replace(/^amount refunded\s*:?\s*/i, '')
      .replace(/^refunded amount\s*:?\s*/i, '')
      .replace(/^refund amount\s*:?\s*/i, '')
      .replace(/^price\s*:?\s*/i, '')
      .replace(/^total\s*:?\s*/i, '')
      .replace(/^charge\s*:?\s*/i, '')
      .trim();
  }

  function normalizeCurrencyCode(value, context = '') {
    const combined = `${value || ''} ${context || ''}`;
    const codeMatch = combined.match(CURRENCY_CODE_RE);

    if (codeMatch) return codeMatch[0].toUpperCase();

    if (/US\$/i.test(combined)) return 'USD';
    if (/\$/.test(combined)) return 'USD';
    if (/€/.test(combined)) return 'EUR';
    if (/£/.test(combined)) return 'GBP';
    if (/(^|\s)R\s*\d/i.test(combined)) return 'ZAR';

    return '';
  }

  function normalizeRefundAmountDisplay(value, context = '') {
    const raw = cleanAmount(value);
    const numberMatch = raw.match(/\d{1,5}(?:,\d{3})*(?:\.\d{2})?/);

    if (!numberMatch) return raw;

    const currencyCode = normalizeCurrencyCode(raw, context);

    if (!currencyCode) return raw;

    return `${currencyCode} ${numberMatch[0]}`;
  }

  function findAmountInText(text) {
    const cleaned = cleanText(text);
    const match = cleaned.match(AMOUNT_RE);
    return match ? normalizeRefundAmountDisplay(match[0], cleaned) : '';
  }

  function findAllAmountsInText(text) {
    const cleaned = cleanText(text);
    const matches = cleaned.match(AMOUNT_RE_GLOBAL) || [];
    const seen = new Set();
    const amounts = [];

    for (const match of matches) {
      const normalized = normalizeRefundAmountDisplay(match, cleaned);
      const key = normalized.toLowerCase();

      if (!normalized || seen.has(key)) continue;

      seen.add(key);
      amounts.push(normalized);
    }

    return amounts;
  }

  function isBareAmount(text) {
    const value = cleanAmount(text);

    if (!BARE_AMOUNT_RE.test(value)) return false;
    if (/[/:]/.test(value)) return false;

    return true;
  }

  function findValueAfterLabel(lines, labelRegexes, valueExtractor) {
    for (let i = 0; i < lines.length; i++) {
      const line = cleanText(lines[i]);
      if (!labelRegexes.some(regex => regex.test(line))) continue;

      const sameLineValue = valueExtractor(line);
      if (sameLineValue) return sameLineValue;

      for (let j = i + 1; j < Math.min(lines.length, i + 14); j++) {
        const candidate = cleanText(lines[j]);
        const value = valueExtractor(candidate);

        if (value) return value;
      }
    }

    return '';
  }

  function findAmountAfterLabel(lines, labelRegexes) {
    for (let i = 0; i < lines.length; i++) {
      const line = cleanText(lines[i]);
      if (!labelRegexes.some(regex => regex.test(line))) continue;

      const block = lines
        .slice(i, Math.min(lines.length, i + 10))
        .map(cleanText)
        .filter(Boolean);

      const joinedBlock = block.join(' ');
      const amountFromBlock = findAmountInText(joinedBlock);

      if (amountFromBlock) return amountFromBlock;

      for (let j = i + 1; j < Math.min(lines.length, i + 10); j++) {
        const candidate = cleanText(lines[j]);
        const amount = findAmountInText(candidate);

        if (amount) return amount;

        if (isBareAmount(candidate)) {
          return normalizeRefundAmountDisplay(candidate, joinedBlock);
        }
      }
    }

    return '';
  }

  function scoreRefundAmountContext(text) {
    const context = cleanText(text).toLowerCase();
    let score = 0;

    if (/\b(?:amount\s+refunded|refunded\s+amount|refund\s+amount|refund\s+total|total\s+refunded)\b/i.test(context)) score += 180;
    if (/\brefund(?:ed|s|ing)?\b/i.test(context)) score += 70;
    if (/\b(?:amount|total)\b/i.test(context)) score += 25;
    if (/\b(?:completed|processed|successful|success)\b/i.test(context)) score += 15;
    if (/\b(?:subscription|plan\s+price|original\s+charge|charged|amount\s+paid|billing\s+cycle)\b/i.test(context)) score -= 80;
    if (/\b(?:percentage|reason|policy|request|button)\b/i.test(context)) score -= 70;

    return score;
  }

  function getScoredAmountsFromRefundText(text, baseScore = 0) {
    const cleaned = cleanText(text);
    const refundIndexes = [];
    const refundPattern = /\brefund(?:ed|s|ing)?\b/ig;
    let refundMatch;

    while ((refundMatch = refundPattern.exec(cleaned))) {
      refundIndexes.push(refundMatch.index);
    }

    const matches = Array.from(cleaned.matchAll(new RegExp(AMOUNT_RE_GLOBAL.source, 'ig')));

    return matches.map(match => {
      const amountIndex = Number(match.index || 0);
      const distance = refundIndexes.length
        ? Math.min(...refundIndexes.map(index => Math.abs(index - amountIndex)))
        : 500;
      const proximityScore = Math.max(0, 70 - Math.floor(distance / 3));
      const nearbyPrefix = cleaned.slice(Math.max(0, amountIndex - 4), amountIndex);
      const negativeOrParenthesized = /[-(]\s*$/.test(nearbyPrefix) ? 10 : 0;

      return {
        amount: normalizeRefundAmountDisplay(match[0], cleaned),
        score: baseScore + scoreRefundAmountContext(cleaned) + proximityScore + negativeOrParenthesized
      };
    }).filter(candidate => candidate.amount);
  }

  function findRefundAmountFromDOM() {
    const selectors = [
      '[data-testid*="refund" i]',
      '[data-test-id*="refund" i]',
      '[aria-label*="refund" i]',
      '[class*="refund" i]',
      'label',
      'p',
      'span',
      'td',
      'th',
      '[role="cell"]',
      '[role="row"]'
    ].join(',');
    const sourceElements = queryOutsidePanel(selectors).slice(0, 1800);
    const contexts = new Set();
    const candidates = [];

    for (const source of sourceElements) {
      const sourceText = cleanText(source.innerText || source.textContent || '');
      const sourceAttributes = cleanText([
        source.getAttribute('data-testid'),
        source.getAttribute('data-test-id'),
        source.getAttribute('aria-label'),
        source.getAttribute('class')
      ].filter(Boolean).join(' '));

      if (!/refund/i.test(`${sourceText} ${sourceAttributes}`)) continue;

      let context = source;

      for (let depth = 0; context && depth < 5; depth += 1) {
        if (isIgnoredElement(context)) break;

        const contextText = cleanText(context.innerText || context.textContent || '');

        if (
          contextText &&
          contextText.length <= 1200 &&
          /refund/i.test(contextText) &&
          !contexts.has(contextText)
        ) {
          contexts.add(contextText);
          candidates.push(...getScoredAmountsFromRefundText(contextText, 30 - depth * 5));

          if (/\b(?:amount\s+refunded|refunded\s+amount|refund\s+amount|refund\s+total|total\s+refunded)\b/i.test(contextText)) {
            const bareValues = Array.from(context.querySelectorAll('input, output, strong, b, span, p, td, [role="cell"]'))
              .map(element => cleanText(element.value || element.textContent || ''))
              .filter(value => isBareAmount(value));
            const refundIndex = contextText.toLowerCase().search(/refund/);

            for (const value of bareValues) {
              const valueIndex = contextText.indexOf(value);
              const proximity = refundIndex >= 0 && valueIndex >= 0
                ? Math.max(0, 50 - Math.floor(Math.abs(valueIndex - refundIndex) / 3))
                : 0;

              candidates.push({
                amount: normalizeRefundAmountDisplay(value, contextText),
                score: 185 - depth * 5 + proximity
              });
            }
          }
        }

        context = context.parentElement;
      }
    }

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0] ? candidates[0].amount : '';
  }

  function findRefundAmountInBillingLines(lines) {
    const refundLabelRegexes = [
      /^amount refunded\b/i,
      /^refunded amount\b/i,
      /^refund amount\b/i,
      /^total refunded\b/i,
      /^refund total\b/i
    ];

    const exactLabelAmount = findAmountAfterLabel(lines, refundLabelRegexes);

    if (exactLabelAmount) return exactLabelAmount;

    for (let i = 0; i < lines.length; i++) {
      const line = cleanText(lines[i]);

      if (!/\brefund(?:ed|s|ing)?\b/i.test(line)) continue;
      if (/\b(reason|policy|status|button|action|request)\b/i.test(line) && !AMOUNT_RE.test(line)) continue;

      const nearbyBlock = lines
        .slice(i, Math.min(lines.length, i + 8))
        .map(cleanText)
        .filter(Boolean)
        .join(' ');

      const amounts = findAllAmountsInText(nearbyBlock);

      if (amounts.length) return amounts[0];
    }

    return '';
  }

  function getRefundDataFromCMS() {
    const data = {
      amount: '',
      payment: ''
    };

    const lines = getPageLinesOutsidePanel();

    data.payment = findValueAfterLabel(
      lines,
      [
        /^payment\s*handler\b/i,
        /^payment\s*gateway\b/i,
        /^payment\s*processor\b/i,
        /^gateway\b/i,
        /^processor\b/i
      ],
      value => findPaymentHandlerInText(value)
    );

    data.amount = findRefundAmountFromDOM() || findRefundAmountInBillingLines(lines);

    if (!data.payment) {
      for (const line of lines) {
        const payment = findPaymentHandlerInText(line);
        if (payment) {
          data.payment = payment;
          break;
        }
      }
    }

    if (isBadPaymentValue(data.payment)) {
      data.payment = '';
    }

    return data;
  }

  function clearCaseSpecificFields() {
    [
      STORAGE_KEYS.cms,
      STORAGE_KEYS.cmsUserId,
      STORAGE_KEYS.payment,
      STORAGE_KEYS.amount
    ].forEach(safeDelete);

    recordSync('Freshdesk', 'cleared stale CMS fields');
    showDuplicateRefundWarning(null);
  }

  // Local, approximate duplicate-refund detector: not a record of confirmed
  // completed refunds (the tool never auto-clicks the final CMS confirmation,
  // by design), just "we captured refund info for this email before" - a
  // gentle heads-up, not a hard guarantee.
  const REFUND_HISTORY_KEY = 'betterViewliftRefundHistory';
  const REFUND_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
  const REFUND_HISTORY_MAX = 30;

  function getRefundHistory() {
    try {
      let value = GM_getValue(REFUND_HISTORY_KEY, null);
      if (typeof value === 'string') value = JSON.parse(value);
      return Array.isArray(value) ? value : [];
    } catch (error) {
      return [];
    }
  }

  function findRecentDuplicateRefund(email, ticketUrl) {
    const normalizedEmail = cleanText(email).toLowerCase();
    if (!normalizedEmail) return null;

    const now = Date.now();

    return getRefundHistory().find(entry =>
      entry &&
      entry.email === normalizedEmail &&
      entry.ticketUrl !== ticketUrl &&
      (now - Number(entry.capturedAt || 0)) < REFUND_HISTORY_WINDOW_MS
    ) || null;
  }

  function recordRefundHistory(email, amount, ticketUrl) {
    const normalizedEmail = cleanText(email).toLowerCase();
    if (!normalizedEmail || !ticketUrl) return;

    const history = getRefundHistory();
    const recentSameCapture = history.find(entry =>
      entry &&
      entry.email === normalizedEmail &&
      entry.ticketUrl === ticketUrl &&
      (Date.now() - Number(entry.capturedAt || 0)) < 5 * 60 * 1000
    );

    if (recentSameCapture) {
      recentSameCapture.amount = amount;
      recentSameCapture.capturedAt = Date.now();
    } else {
      history.push({ email: normalizedEmail, amount, ticketUrl, capturedAt: Date.now() });
    }

    try {
      GM_setValue(REFUND_HISTORY_KEY, history.slice(-REFUND_HISTORY_MAX));
    } catch (error) { /* storage unavailable, skip */ }
  }

  function showDuplicateRefundWarning(entry) {
    const banner = document.getElementById('refund-duplicate-warning');
    if (!banner) return;

    if (!entry) {
      banner.hidden = true;
      return;
    }

    const when = new Date(entry.capturedAt);
    const timeText = Number.isNaN(when.getTime())
      ? ''
      : when.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const ticketMatch = String(entry.ticketUrl || '').match(/\/tickets\/(\d+)/i);
    const ticketText = ticketMatch ? `ticket #${ticketMatch[1]}` : 'another ticket';
    const amountText = entry.amount ? ` (${entry.amount})` : '';

    banner.textContent = `⚠ This email already had a refund captured${amountText}${timeText ? ` on ${timeText}` : ''} in ${ticketText}. Double-check before issuing another one.`;
    banner.hidden = false;
  }

  function checkDuplicateRefund(email, amount, ticketUrl) {
    if (!email || !ticketUrl) return;

    const duplicate = findRecentDuplicateRefund(email, ticketUrl);
    showDuplicateRefundWarning(duplicate);

    if (!duplicate) recordRefundHistory(email, amount, ticketUrl);
  }

  function maybeResetForFreshdeskContext(ticketURL, email) {
    if (!isFreshdeskHost()) return;

    const oldTicket = safeGet(STORAGE_KEYS.activeTicket, '');
    const oldEmail = safeGet(STORAGE_KEYS.activeEmail, '');

    const ticketChanged = ticketURL && oldTicket && oldTicket !== ticketURL;
    const emailChanged = email && oldEmail && oldEmail.toLowerCase() !== email.toLowerCase();

    if (ticketChanged || emailChanged) {
      clearCaseSpecificFields();
    }

    if (ticketURL) forceSet(STORAGE_KEYS.activeTicket, ticketURL);
    if (email) forceSet(STORAGE_KEYS.activeEmail, email);
  }

  function savePageData() {
    if (!isSupportedPage()) return;

    cleanStoredBadValues();

    const ticketURL = isFreshdeskHost() ? getFreshdeskTicketURL() : '';
    const email = findEmailOnPage();
    const cmsURL = findCMSUrlOnPage();
    const clientKey = captureRefundClientKey();

    maybeResetForFreshdeskContext(ticketURL, email);

    let changed = false;

    if (clientKey) {
      changed = safeSet(STORAGE_KEYS.client, clientKey) || changed;
    }

    if (isFreshdeskHost()) {
      if (ticketURL) changed = safeSet(STORAGE_KEYS.freshdesk, ticketURL) || changed;
      if (email && !isBlockedEmail(email)) changed = safeSet(STORAGE_KEYS.email, email) || changed;

      if (cmsURL) {
        changed = safeSet(STORAGE_KEYS.cms, cmsURL) || changed;

        const cmsUserId = getCMSUserIdFromURL(cmsURL);
        if (cmsUserId) changed = safeSet(STORAGE_KEYS.cmsUserId, cmsUserId) || changed;
      }

      if (changed) recordSync('Freshdesk', 'freshdesk capture');
      return;
    }

    if (isCMSHost()) {
      if (document.visibilityState !== 'visible') return;

      if (cmsURL) {
        forceSet(STORAGE_KEYS.cms, cmsURL);

        const cmsUserId = getCMSUserIdFromURL(cmsURL);
        if (cmsUserId) forceSet(STORAGE_KEYS.cmsUserId, cmsUserId);

        changed = true;
      }

      if (email && !isBlockedEmail(email)) {
        changed = safeSet(STORAGE_KEYS.email, email) || changed;
        changed = safeSet(STORAGE_KEYS.activeEmail, email) || changed;
      }

      const refundData = getRefundDataFromCMS();

      if (refundData.amount) {
        forceSet(STORAGE_KEYS.amount, refundData.amount);
        changed = true;

        const ticketRef = safeGet(STORAGE_KEYS.activeTicket, '') || safeGet(STORAGE_KEYS.freshdesk, '');
        checkDuplicateRefund(email || safeGet(STORAGE_KEYS.activeEmail, ''), refundData.amount, ticketRef);
      }

      if (refundData.payment && !isBadPaymentValue(refundData.payment)) {
        forceSet(STORAGE_KEYS.payment, refundData.payment);
        changed = true;
      } else if (isBadPaymentValue(safeGet(STORAGE_KEYS.payment, ''))) {
        safeDelete(STORAGE_KEYS.payment);
        changed = true;
      }

      if (changed) recordSync('CMS', 'active cms tab capture');
    }
  }

  function setFieldValue(id, value, forceOverwrite = false) {
    const field = document.getElementById(id);
    if (!field) return;

    const next = cleanText(value);
    const current = cleanText(field.value);
    const previousAutoValue = cleanText(field.dataset.refundAutoValue || '');
    const isStillAutoFilled = Boolean(previousAutoValue && current === previousAutoValue);

    if (forceOverwrite || !current || isStillAutoFilled || isBlockedEmail(current) || isBadPaymentValue(current)) {
      field.value = next;
      field.dataset.refundAutoValue = next;
      markFieldState(field);
    }
  }

  function refreshAutoFields(forceOverwrite = false) {
    cleanStoredBadValues();

    const storedEmail = safeGet(STORAGE_KEYS.email, '');
    const storedPayment = safeGet(STORAGE_KEYS.payment, '');

    setFieldValue('refund-email', isBlockedEmail(storedEmail) ? '' : storedEmail, forceOverwrite);
    setFieldValue('refund-freshdesk', safeGet(STORAGE_KEYS.freshdesk, ''), forceOverwrite);
    setFieldValue('refund-cms', safeGet(STORAGE_KEYS.cms, ''), forceOverwrite);
    setFieldValue('refund-payment', isBadPaymentValue(storedPayment) ? '' : storedPayment, forceOverwrite);
    setFieldValue('refund-amount', safeGet(STORAGE_KEYS.amount, ''), forceOverwrite);

    markAllFieldStates();
  }

  function detectRefundClientKeyFromText(text) {
    const context = String(text || '').toLowerCase();

    if (
      /(^|[^a-z0-9])liv\s*golf([^a-z0-9]|$)/i.test(context) ||
      context.includes('livgolf') ||
      context.includes('liv golf plus') ||
      context.includes('livgolfplus') ||
      context.includes('livgolfplus.com') ||
      context.includes('support@livgolfplus.com')
    ) {
      return 'livgolf';
    }

    if (
      /(^|[^a-z0-9])schn([^a-z0-9]|$)/i.test(context) ||
      context.includes('spacecityhn.com') ||
      context.includes('space city home network') ||
      context.includes('sc-appsupport@spacecityhn.com')
    ) {
      return 'schn';
    }

    if (/tampa|tampa bay|tbl|lightning/i.test(context)) return 'tbl';
    if (/altitude/i.test(context)) return 'altitude';
    if (/monumental|\bmsn\b/i.test(context)) return 'msn';
    if (/golden knights|\bvgk\b/i.test(context)) return 'vgk';
    if (/chsn|cubs|blackhawks|\bchicago\b/i.test(context)) return 'chsn';
    if (/foxone|fox sports|\bfox\b/i.test(context)) return 'fox';
    if (/rootsport|root sports/i.test(context)) return 'rootsport';
    if (/dirtvision|dirt vision/i.test(context)) return 'dirt';
    if (/\blnp\b|league network/i.test(context)) return 'lnp';

    return '';
  }

  function getRefundClientContextText() {
    const targetedContext = Array.from(document.querySelectorAll([
      '#better-freshdesk-case-brand',
      '.ember-power-select-selected-item',
      'a[href^="mailto:" i]',
      '[data-test-id*="client" i]',
      '[data-testid*="client" i]',
      '[aria-label*="client" i]'
    ].join(','))).slice(0, 60).map(element => {
      return [
        element.textContent || '',
        element.getAttribute('href') || '',
        element.getAttribute('aria-label') || ''
      ].join(' ');
    }).join('\n');

    const values = [
      location.href,
      document.title,
      safeGet(STORAGE_KEYS.client, ''),
      safeGet(STORAGE_KEYS.email, ''),
      safeGet(STORAGE_KEYS.activeEmail, ''),
      safeGet(STORAGE_KEYS.cms, ''),
      document.getElementById('refund-email')?.value || '',
      document.getElementById('refund-cms')?.value || '',
      targetedContext
    ];

    return values
      .map(value => String(value || '').toLowerCase())
      .join('\n');
  }

  function captureRefundClientKey() {
    const clientKey = detectRefundClientKeyFromText(getRefundClientContextText());

    if (clientKey) {
      forceSet(STORAGE_KEYS.client, clientKey);
    }

    return clientKey;
  }

  function getRefundClientKey() {
    const liveClient = captureRefundClientKey();

    if (liveClient === 'schn' || liveClient === 'livgolf') {
      return liveClient;
    }

    const storedClient = safeGet(STORAGE_KEYS.client, '');

    if (storedClient === 'schn' || storedClient === 'livgolf') {
      return storedClient;
    }

    return '';
  }

  function shouldAddBlankColumnBetweenRefunderAndDate() {
    const clientKey = getRefundClientKey();

    return clientKey === 'schn' || clientKey === 'livgolf';
  }

  function getRefundSheetKey() {
    const detected = detectRefundClientKeyFromText(getRefundClientContextText());
    if (detected && REFUND_SHEET_URLS[detected]) {
      forceSet(STORAGE_KEYS.client, detected);
      return detected;
    }

    const stored = safeGet(STORAGE_KEYS.client, '').toLowerCase();
    return REFUND_SHEET_URLS[stored] ? stored : 'tbl';
  }

  function getRefundSheetRow() {
    runCapture(false);

    const paymentField = document.getElementById('refund-payment');
    if (paymentField && isBadPaymentValue(paymentField.value)) {
      paymentField.value = '';
      safeDelete(STORAGE_KEYS.payment);
    }

    const base = [
      document.getElementById('refund-email')?.value || '',
      document.getElementById('refund-freshdesk')?.value || '',
      document.getElementById('refund-cms')?.value || '',
      document.getElementById('refund-payment')?.value || '',
      document.getElementById('refund-reason')?.value || '',
      document.getElementById('refund-tag')?.value || 'yes',
      document.getElementById('refund-amount')?.value || '',
      document.getElementById('refund-refunder')?.value || 'Sebastian'
    ];
    const date = document.getElementById('refund-date')?.value || getTodayShortDate();
    const sheetKey = getRefundSheetKey();

    return {
      sheetKey,
      row: REFUND_SHEET_DATE_FIRST.has(sheetKey)
        ? base.concat(date, '')
        : base.concat('', date)
    };
  }

  function copyForRefundSheet() {
    const result = getRefundSheetRow();
    const sheetUrl = REFUND_SHEET_URLS[result.sheetKey] || REFUND_SHEET_URLS.tbl;

    GM_setClipboard(result.row.join('\t'));
    // Open at the bottom of the stable Freshdesk ID column. From there,
    // Ctrl+Up reaches the last non-empty record even when rows are blank.
    const opened = window.open(`${sheetUrl}&range=B1048576`, '_blank', 'noopener');
    setStatus(
      opened
        ? `Copied for ${result.sheetKey.toUpperCase()} sheet. In column B, press Ctrl+Up, ArrowDown, then Ctrl+V.`
        : 'Copied. In column B, press Ctrl+Up, ArrowDown, then Ctrl+V.'
    );
    markAllFieldStates();
  }

  function markFieldState(field) {
    const importantFields = [
      'refund-email',
      'refund-freshdesk',
      'refund-cms',
      'refund-payment',
      'refund-amount'
    ];

    if (!importantFields.includes(field.id)) return;

    const hasValue = Boolean(cleanText(field.value));
    field.classList.toggle('refund-missing', !hasValue);
    field.classList.toggle('refund-ready', hasValue);
  }

  function updateHeaderStatusDot() {
    const dot = document.getElementById('refund-sync-dot');
    if (!dot) return;

    const email = cleanText(document.getElementById('refund-email')?.value || '');
    const freshdesk = cleanText(document.getElementById('refund-freshdesk')?.value || '');
    const cms = cleanText(document.getElementById('refund-cms')?.value || '');
    const payment = cleanText(document.getElementById('refund-payment')?.value || '');
    const amount = cleanText(document.getElementById('refund-amount')?.value || '');

    if (!email && !freshdesk && !cms && !payment && !amount) {
      dot.dataset.state = 'empty';
      dot.title = 'No data captured yet';
      return;
    }

    if (email && freshdesk && cms && payment && amount) {
      dot.dataset.state = 'ready';
      dot.title = 'All required fields captured';
      return;
    }

    dot.dataset.state = 'missing';
    dot.title = 'Some required fields are missing';
  }

  function markAllFieldStates() {
    document.querySelectorAll('#refund-capture-panel input').forEach(markFieldState);
    updateHeaderStatusDot();
  }

  function setStatus(message, type = 'ok') {
    const status = document.getElementById('refund-status');
    if (!status) return;

    status.textContent = message;
    status.dataset.type = type;
    updateHeaderStatusDot();
  }

  function updateSyncStatusFromStorage() {
    const source = safeGet(STORAGE_KEYS.lastSource, '');
    const capturedAt = safeGet(STORAGE_KEYS.lastCaptureAt, '');
    const cms = safeGet(STORAGE_KEYS.cms, '');
    const payment = safeGet(STORAGE_KEYS.payment, '');
    const amount = safeGet(STORAGE_KEYS.amount, '');

    if (!source || !capturedAt) return;

    const time = new Date(capturedAt);
    const timeText = Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    if (source === 'CMS') {
      if (cms && payment && amount) {
        setStatus(`Synced from CMS tab${timeText ? ` at ${timeText}` : ''}.`);
      } else {
        setStatus('CMS tab synced, but one or more CMS values are still missing.', 'warn');
      }

      return;
    }

    setStatus(`Synced from ${source}${timeText ? ` at ${timeText}` : ''}.`);
  }

  function runCapture(forceOverwrite = false, statusMessage = '') {
    if (!isSupportedPage()) return;

    const now = Date.now();
    if (!forceOverwrite && now - lastCaptureRunAt < CAPTURE_COOLDOWN_MS) return;
    lastCaptureRunAt = now;

    savePageData();
    refreshAutoFields(forceOverwrite);

    if (statusMessage) setStatus(statusMessage);
  }

  function retryCapture() {
    [1000, 2500, 5000, 9000].forEach(function (delay) {
      setTimeout(function () {
        runCapture(false);
      }, delay);
    });
  }

  function observeDynamicChanges() {
    let timer = null;

    onRouteChange(function () {
      if (document.visibilityState === 'hidden') return;
      clearTimeout(timer);

      timer = setTimeout(function () {
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(function () {
            runCapture(false);
          }, { timeout: 1200 });
        } else {
          runCapture(false);
        }
      }, 1200);
    });
  }

  function installCrossTabSync() {
    if (typeof GM_addValueChangeListener !== 'function') return;

    [
      STORAGE_KEYS.syncPing,
      STORAGE_KEYS.email,
      STORAGE_KEYS.freshdesk,
      STORAGE_KEYS.cms,
      STORAGE_KEYS.payment,
      STORAGE_KEYS.amount
    ].forEach(key => {
      GM_addValueChangeListener(key, function (_name, _oldValue, _newValue, remote) {
        if (!remote) return;

        window.setTimeout(function () {
          refreshAutoFields(true);
          updateSyncStatusFromStorage();
        }, 100);
      });
    });
  }

  function anchorPanelBottomRight(panel) {
    panel.style.position = 'fixed';
    panel.style.right = '20px';
    panel.style.bottom = '20px';
    panel.style.left = 'auto';
    panel.style.top = 'auto';
  }

  function applyPanelState(panel, minimized) {
    panel.classList.toggle('is-minimized', minimized);
    anchorPanelBottomRight(panel);
  }

  function clearStoredData() {
    Object.values(STORAGE_KEYS).forEach(safeDelete);

    [
      'refund-email',
      'refund-freshdesk',
      'refund-cms',
      'refund-payment',
      'refund-amount'
    ].forEach(id => {
      const field = document.getElementById(id);
      if (field) field.value = '';
    });

    markAllFieldStates();
    setStatus('Stored data cleared.');
    showDuplicateRefundWarning(null);
  }

  function copyCurrentRow() {
    runCapture(false);

    const paymentField = document.getElementById('refund-payment');

    if (paymentField && isBadPaymentValue(paymentField.value)) {
      paymentField.value = '';
      safeDelete(STORAGE_KEYS.payment);
    }

    const row = [
      document.getElementById('refund-email').value,
      document.getElementById('refund-freshdesk').value,
      document.getElementById('refund-cms').value,
      document.getElementById('refund-payment').value,
      document.getElementById('refund-reason').value,
      document.getElementById('refund-tag').value,
      document.getElementById('refund-amount').value,
      document.getElementById('refund-refunder').value
    ];

    if (shouldAddBlankColumnBetweenRefunderAndDate()) {
      row.push('');
    }

    row.push(document.getElementById('refund-date').value);

    GM_setClipboard(row.join('\t'));
    setStatus('Copied to clipboard.');
    markAllFieldStates();

    window.setTimeout(function () {
      const panel = document.getElementById('refund-capture-panel');
      if (panel) applyPanelState(panel, true);
    }, 700);
  }

  // A human-readable block for a note or Slack message - "Copy Row" above
  // is tab-separated for pasting into the refund sheet, not for reading.
  function copyCurrentSummary() {
    runCapture(false);

    const fields = [
      ['Email', 'refund-email'],
      ['Freshdesk', 'refund-freshdesk'],
      ['CMS', 'refund-cms'],
      ['Payment handler', 'refund-payment'],
      ['Amount', 'refund-amount'],
      ['Refunder', 'refund-refunder']
    ];

    const lines = fields
      .map(([label, id]) => {
        const value = cleanText(document.getElementById(id)?.value);
        return value ? `${label}: ${value}` : '';
      })
      .filter(Boolean);

    if (!lines.length) {
      setStatus('Nothing captured yet to summarize.', 'warn');
      return;
    }

    GM_setClipboard(lines.join('\n'));
    setStatus('Summary copied to clipboard.');
  }

  function addStyles() {
    GM_addStyle(`
      #refund-capture-panel {
        position: fixed;
        right: 20px;
        bottom: 20px;
        left: auto;
        top: auto;
        width: 372px;
        max-width: calc(100vw - 24px);
        max-height: calc(100vh - 40px);
        background: #ffffff;
        border: 1px solid rgba(15, 23, 42, 0.14);
        border-radius: 18px;
        box-shadow: 0 22px 55px rgba(15, 23, 42, 0.28);
        z-index: 999999;
        font-family: Arial, sans-serif;
        font-size: 12px;
        color: #17324d;
        overflow: hidden;
        transform-origin: bottom right;
        transition:
          width 180ms ease,
          height 180ms ease,
          border-radius 180ms ease,
          box-shadow 180ms ease,
          transform 180ms ease,
          opacity 180ms ease;
      }

      #refund-capture-panel.is-minimized {
        width: 52px;
        height: 52px;
        border-radius: 999px;
        box-shadow: 0 12px 28px rgba(11, 92, 171, 0.34);
        transform: scale(1);
      }

      #refund-capture-panel.is-minimized:hover {
        transform: translateY(-2px) scale(1.03);
        box-shadow: 0 16px 34px rgba(11, 92, 171, 0.42);
      }

      #refund-capture-panel.is-minimized:active {
        transform: translateY(0) scale(0.97);
        box-shadow: 0 6px 16px rgba(11, 92, 171, 0.3), inset 0 2px 5px rgba(0, 0, 0, 0.16);
      }

      #refund-header {
        min-height: 46px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 12px;
        background: linear-gradient(180deg, #f8fbff 0%, #edf6ff 100%);
        cursor: default;
        border-bottom: 1px solid rgba(15, 23, 42, 0.08);
      }

      #refund-capture-panel.is-minimized #refund-header {
        padding: 6px;
        justify-content: center;
        border-bottom: none;
        background: linear-gradient(180deg, #2f7fe0 0%, #0b5cab 100%);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
        min-height: 40px;
        height: 40px;
        transition: background 140ms ease;
      }

      #refund-title-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        font-weight: 700;
      }

      #refund-title {
        display: flex;
        align-items: center;
        gap: 7px;
        white-space: nowrap;
      }

      #refund-sync-dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #9ca3af;
        box-shadow: 0 0 0 3px rgba(156, 163, 175, 0.14);
        flex: 0 0 auto;
      }

      #refund-sync-dot[data-state="ready"] {
        background: #067a18;
        box-shadow: 0 0 0 3px rgba(6, 122, 24, 0.14);
      }

      #refund-sync-dot[data-state="missing"] {
        background: #d68b00;
        box-shadow: 0 0 0 3px rgba(214, 139, 0, 0.14);
      }

      #refund-sync-dot[data-state="empty"] {
        background: #9ca3af;
        box-shadow: 0 0 0 3px rgba(156, 163, 175, 0.14);
      }

      #refund-icon {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(180deg, #2f7fe0 0%, #0b5cab 100%);
        box-shadow: 0 2px 6px rgba(11, 92, 171, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.22);
        color: #ffffff;
        font-weight: 800;
        flex: 0 0 auto;
        border: none;
        cursor: pointer;
        transition: box-shadow 140ms ease, transform 140ms ease;
      }

      #refund-icon:hover {
        box-shadow: 0 3px 9px rgba(11, 92, 171, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2);
        transform: translateY(-1px);
      }

      #refund-icon:active {
        transform: translateY(0);
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.18);
      }

      #refund-capture-panel.is-minimized #refund-icon {
        width: 40px;
        height: 40px;
        background: transparent;
        color: #ffffff;
        font-size: 16px;
      }

      #refund-capture-panel.is-minimized #refund-title,
      #refund-capture-panel.is-minimized #refund-actions,
      #refund-capture-panel.is-minimized #refund-body {
        display: none;
      }

      #refund-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .refund-header-button {
        border: 1px solid rgba(15, 23, 42, 0.16);
        background: #ffffff;
        color: #17324d;
        border-radius: 10px;
        width: 28px;
        height: 28px;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        transition: background 140ms ease, transform 140ms ease, box-shadow 140ms ease;
      }

      .refund-header-button:hover {
        background: #f4f8fc;
        transform: translateY(-1px);
      }

      #refund-body {
        padding: 12px;
        max-height: calc(100vh - 110px);
        overflow-y: auto;
        scrollbar-width: thin;
      }

      #refund-body::-webkit-scrollbar {
        width: 8px;
      }

      #refund-body::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 999px;
      }

      #refund-capture-panel label {
        display: block;
        font-weight: 700;
        color: #17324d;
        margin: 0 0 4px;
      }

      #refund-capture-panel input,
      #refund-capture-panel select {
        box-sizing: border-box;
        width: 100%;
        margin: 0 0 9px;
        padding: 8px 9px;
        border: 1px solid #b9c5d4;
        border-radius: 9px;
        background: #ffffff;
        color: #0f172a;
        font-size: 12px;
        outline: none;
        transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
      }

      #refund-capture-panel input:focus,
      #refund-capture-panel select:focus {
        border-color: #0b5cab;
        box-shadow: 0 0 0 3px rgba(11, 92, 171, 0.14);
      }

      #refund-capture-panel input.refund-missing {
        border-color: #d68b00;
        background: #fffaf0;
      }

      #refund-capture-panel input.refund-ready {
        border-color: rgba(6, 122, 24, 0.45);
        background: #fbfffc;
      }

      .refund-grid-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .refund-action-button {
        box-sizing: border-box;
        width: 100%;
        padding: 8px;
        border: 1px solid #b9c5d4;
        border-radius: 10px;
        background: #ffffff;
        color: #17324d;
        cursor: pointer;
        font-size: 12px;
        transition: background 140ms ease, transform 140ms ease, box-shadow 140ms ease;
      }

      .refund-action-button:hover {
        background: #f7fafc;
        transform: translateY(-1px);
      }

      #refund-clear {
        border-color: transparent;
        background: transparent;
        color: #64748b;
      }

      #refund-clear:hover {
        background: #f8fafc;
        color: #334155;
      }

      #refund-copy {
        background: #0b5cab;
        border-color: #0b5cab;
        color: #ffffff;
        font-weight: 700;
        box-shadow: 0 8px 18px rgba(11, 92, 171, 0.22);
      }

      #refund-copy:hover {
        background: #084f95;
        box-shadow: 0 10px 22px rgba(11, 92, 171, 0.28);
      }

      #refund-duplicate-warning {
        margin-bottom: 10px;
        padding: 8px 10px;
        border: 1px solid #fde68a;
        border-radius: 8px;
        background: #fffbeb;
        color: #92400e;
        font-size: 11.5px;
        font-weight: 600;
        line-height: 1.4;
      }

      #refund-status {
        margin-top: 9px;
        min-height: 16px;
        color: #067a18;
        font-size: 12px;
        line-height: 1.35;
      }

      #refund-status[data-type="warn"] {
        color: #9a5b00;
      }

      @media (max-width: 560px) {
        #refund-capture-panel {
          right: 12px;
          bottom: 12px;
          width: calc(100vw - 24px);
        }

        #refund-capture-panel.is-minimized {
          width: 52px;
        }

        .refund-grid-2 {
          grid-template-columns: 1fr;
          gap: 0;
        }
      }

      /* CMS classic dark theme */
      #refund-capture-panel.cms-theme {
        width: 332px;
        max-height: calc(100vh - 32px);
        background: #0f1728;
        border: 1px solid #27344a;
        border-radius: 12px;
        box-shadow: 0 22px 60px rgba(0, 0, 0, 0.48);
        color: #e7edf7;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #refund-capture-panel.cms-theme.is-minimized {
        width: 52px;
        height: 52px;
        border-color: rgba(139, 92, 246, 0.6);
        box-shadow: 0 12px 30px rgba(91, 33, 182, 0.4);
      }

      #refund-capture-panel.cms-theme.is-minimized:hover {
        box-shadow: 0 16px 36px rgba(124, 58, 237, 0.5);
      }

      #refund-capture-panel.cms-theme #refund-header {
        min-height: 44px;
        padding: 8px 10px;
        background: #121c30;
        border-bottom: 1px solid #27344a;
      }

      #refund-capture-panel.cms-theme.is-minimized #refund-header {
        background: linear-gradient(135deg, #7c3aed, #9333ea);
        border-bottom: none;
      }

      #refund-capture-panel.cms-theme #refund-icon {
        width: 30px;
        height: 30px;
        background: linear-gradient(135deg, #7c3aed, #9333ea);
        box-shadow: 0 5px 14px rgba(124, 58, 237, 0.35);
      }

      #refund-capture-panel.cms-theme.is-minimized #refund-icon {
        width: 40px;
        height: 40px;
        background: transparent;
        box-shadow: none;
      }

      #refund-capture-panel.cms-theme #refund-title {
        color: #f5f3ff;
        font-weight: 700;
      }

      #refund-capture-panel.cms-theme #refund-sync-dot[data-state="ready"] {
        background: #22c55e;
        box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.14);
      }

      #refund-capture-panel.cms-theme #refund-sync-dot[data-state="missing"] {
        background: #f59e0b;
        box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.14);
      }

      #refund-capture-panel.cms-theme .refund-header-button {
        border-color: #34425a;
        background: #172238;
        color: #cdd6e5;
      }

      #refund-capture-panel.cms-theme .refund-header-button:hover {
        background: #202d45;
        color: #ffffff;
      }

      #refund-capture-panel.cms-theme #refund-body {
        padding: 12px;
        max-height: calc(100vh - 92px);
        background: #0f1728;
      }

      #refund-capture-panel.cms-theme #refund-body::-webkit-scrollbar-thumb {
        background: #34425a;
      }

      #refund-capture-panel.cms-theme label {
        color: #aebbd0;
        font-size: 11px;
        font-weight: 600;
        margin-bottom: 5px;
      }

      #refund-capture-panel.cms-theme input,
      #refund-capture-panel.cms-theme select {
        margin-bottom: 10px;
        padding: 8px 9px;
        border: 1px solid #34425a;
        border-radius: 7px;
        background: #111b2e;
        color: #f1f5f9;
        font-size: 12px;
        color-scheme: dark;
      }

      #refund-capture-panel.cms-theme input:focus,
      #refund-capture-panel.cms-theme select:focus {
        border-color: #8b5cf6;
        box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.18);
      }

      #refund-capture-panel.cms-theme input.refund-missing {
        border-color: rgba(245, 158, 11, 0.75);
        background: rgba(120, 53, 15, 0.2);
      }

      #refund-capture-panel.cms-theme input.refund-ready {
        border-color: rgba(34, 197, 94, 0.45);
        background: rgba(20, 83, 45, 0.16);
      }

      #refund-capture-panel.cms-theme .refund-action-button {
        border-color: #34425a;
        border-radius: 7px;
        background: #172238;
        color: #dbe4f1;
      }

      #refund-capture-panel.cms-theme .refund-action-button:hover {
        background: #202d45;
      }

      #refund-capture-panel.cms-theme #refund-clear {
        color: #94a3b8;
      }

      #refund-capture-panel.cms-theme #refund-clear:hover {
        background: #172238;
        color: #dbe4f1;
      }

      #refund-capture-panel.cms-theme #refund-copy {
        background: linear-gradient(90deg, #7c3aed, #9333ea);
        border-color: #8b5cf6;
        color: #ffffff;
        box-shadow: 0 8px 20px rgba(124, 58, 237, 0.28);
      }

      #refund-capture-panel.cms-theme #refund-copy:hover {
        background: linear-gradient(90deg, #6d28d9, #7e22ce);
        box-shadow: 0 10px 24px rgba(124, 58, 237, 0.38);
      }

      #refund-capture-panel.cms-theme #refund-status {
        color: #86efac;
      }

      #refund-capture-panel.cms-theme #refund-status[data-type="warn"] {
        color: #fbbf24;
      }
    `);
  }

  function createUI() {
    if (!isSupportedPage()) {
      removeUI();
      return;
    }

    if (document.getElementById('refund-capture-panel')) return;

    addStyles();

    const panel = document.createElement('div');
    panel.id = 'refund-capture-panel';
    panel.classList.toggle('cms-theme', isCMSHost());

    anchorPanelBottomRight(panel);

    panel.innerHTML = `
      <div id="refund-header">
        <div id="refund-title-wrap">
          <button id="refund-icon" class="refund-header-button" type="button" title="Open refund capture">$</button>
          <div id="refund-title">
            <span id="refund-sync-dot" data-state="empty"></span>
            <span>Refund Capture</span>
          </div>
        </div>
        <div id="refund-actions">
          <button id="refund-minimize" class="refund-header-button" type="button" title="Minimize">-</button>
        </div>
      </div>

      <div id="refund-body">
        <div id="refund-duplicate-warning" hidden></div>

        <label for="refund-email">Email</label>
        <input id="refund-email" autocomplete="off">

        <label for="refund-freshdesk">Freshdesk ID</label>
        <input id="refund-freshdesk" autocomplete="off">

        <div hidden>
          <label for="refund-cms">CMS URL for User</label>
          <input id="refund-cms" autocomplete="off">
        </div>

        <div class="refund-grid-2">
          <div>
            <label for="refund-payment">Payment Handler</label>
            <input id="refund-payment" autocomplete="off">
          </div>
          <div>
            <label for="refund-amount">Amount Refunded</label>
            <input id="refund-amount" autocomplete="off">
          </div>
        </div>

        <div hidden>
          <label for="refund-reason">Reason</label>
          <input id="refund-reason" autocomplete="off" value="User's request">
        </div>

        <div hidden>
          <label for="refund-tag">Tag Refunded!</label>
          <select id="refund-tag">
            <option selected>yes</option>
            <option>no</option>
          </select>
        </div>

        <label for="refund-refunder">Refunder</label>
        <select id="refund-refunder">
          <option selected>Sebastian</option>
          <option>Eric</option>
          <option>Esteban</option>
        </select>

        <label for="refund-date">Date/Week of</label>
        <input id="refund-date" autocomplete="off" value="${getTodayShortDate()}">

        <div class="refund-grid-2">
          <button id="refund-clear" class="refund-action-button" type="button">Clear Stored Data</button>
          <button id="refund-refresh" class="refund-action-button" type="button">Refresh</button>
        </div>

        <button id="refund-copy" class="refund-action-button" type="button" style="margin-top:8px;">Copy Row</button>
        <button id="refund-copy-summary" class="refund-action-button" type="button" style="margin-top:8px;" title="Copies a readable text block - for a note or Slack message, not the sheet">Copy Summary</button>
        <button id="refund-copy-sheet" class="refund-action-button" type="button" style="margin-top:8px;">Open Refund Sheet</button>

        <div id="refund-status"></div>
      </div>
    `;

    document.body.appendChild(panel);

    const iconButton = document.getElementById('refund-icon');
    const minimizeButton = document.getElementById('refund-minimize');

    applyPanelState(panel, true);

    iconButton.addEventListener('click', function (event) {
      event.stopPropagation();
      applyPanelState(panel, false);
    });

    minimizeButton.addEventListener('click', function (event) {
      event.stopPropagation();
      applyPanelState(panel, true);
    });

    document.getElementById('refund-clear').addEventListener('click', clearStoredData);

    document.getElementById('refund-refresh').addEventListener('click', function () {
      runCapture(true, isCMSHost() ? 'Captured from this CMS tab.' : 'Refreshed from stored data.');
      anchorPanelBottomRight(panel);
    });

    document.getElementById('refund-copy').addEventListener('click', function () {
      copyCurrentRow();
      anchorPanelBottomRight(panel);
    });

    document.getElementById('refund-copy-summary').addEventListener('click', function () {
      copyCurrentSummary();
      anchorPanelBottomRight(panel);
    });

    document.getElementById('refund-copy-sheet').addEventListener('click', function () {
      copyForRefundSheet();
      anchorPanelBottomRight(panel);
    });

    document.querySelectorAll('#refund-capture-panel input').forEach(input => {
      input.addEventListener('input', function () {
        markFieldState(input);
        updateHeaderStatusDot();
      });
    });

    runCapture(true);
    updateSyncStatusFromStorage();
    anchorPanelBottomRight(panel);
  }

  function installVisibilityCapture() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        runCapture(true);
        updateSyncStatusFromStorage();

        const panel = document.getElementById('refund-capture-panel');
        if (panel) anchorPanelBottomRight(panel);
      }
    });

    window.addEventListener('focus', function () {
      runCapture(true);
      updateSyncStatusFromStorage();

      const panel = document.getElementById('refund-capture-panel');
      if (panel) anchorPanelBottomRight(panel);
    });

    window.addEventListener('resize', function () {
      const panel = document.getElementById('refund-capture-panel');
      if (panel) anchorPanelBottomRight(panel);
    });
  }

  function handleRefundToolRouteChange() {
    if (location.href === lastRefundToolUrl) return;

    lastRefundToolUrl = location.href;
    lastCaptureRunAt = 0;
    cachedPageLines = [];
    cachedPageLinesAt = 0;

    clearTimeout(refundToolRouteTimer);

    refundToolRouteTimer = setTimeout(function () {
      if (!isSupportedPage()) {
        removeUI();
        return;
      }

      runRefundToolStartupPasses();
    }, 250);
  }

  function installRefundToolRouteWatcher() {
    onRouteChange(handleRefundToolRouteChange);
  }

  async function runRefundToolStartupPasses() {
    cleanStoredBadValues();

    await waitFor(() => {
      if (!isSupportedPage()) {
        removeUI();
        return true;
      }

      createUI();
      return document.getElementById('refund-capture-panel');
    }, { timeout: 6200, pollMs: 50 });

    if (isSupportedPage()) {
      runCapture(true);
      updateSyncStatusFromStorage();
    }
  }

  function initRefundCaptureTool() {
    if (!document.body) {
      setTimeout(initRefundCaptureTool, 300);
      return;
    }

    installRefundToolRouteWatcher();
    installCrossTabSync();
    installVisibilityCapture();
    // observeDynamicChanges() was written to re-capture as soon as the page
    // settles after a DOM mutation (Contact Info panel finishing its own
    // render, etc.) but was never actually wired up here - the panel was
    // relying only on the fixed-delay retryCapture() cascade below to catch
    // data that wasn't there yet on the first pass, which is both slower
    // (up to 9s) and less reliable (a real render could still land between
    // two fixed checkpoints). Reactive path first, fixed cascade stays as a
    // backstop for whatever it doesn't catch.
    observeDynamicChanges();
    retryCapture();

    runRefundToolStartupPasses();

    setInterval(function () {
      if (document.visibilityState === 'hidden') return;
      handleRefundToolRouteChange();

      if (isSupportedPage()) {
        createUI();
        runCapture(false);
        updateSyncStatusFromStorage();
      } else {
        removeUI();
      }
    }, 8000);
  }

  initRefundCaptureTool();
})();


/* ============================================================
 * Feature 1b: Persistent Refunder Preference
 * ============================================================ */


/*
 * Better CMS preference patch:
 * Remembers the selected Refunder value in the Refund Capture panel.
 * This keeps Sebastian/Eric/Esteban persistent across page refreshes and new CMS users.
 */
(function () {
  'use strict';

  const REFUNDER_PREF_KEY = 'Better CMS Preferred Refunder';
  const REFUNDER_SELECT_ID = 'refund-refunder';
  const VALID_REFUNDERS = ['Sebastian', 'Eric', 'Esteban'];

  function safeGetPreferredRefunder() {
    try {
      return GM_getValue(REFUNDER_PREF_KEY, '');
    } catch (error) {
      return '';
    }
  }

  function safeSetPreferredRefunder(value) {
    if (!VALID_REFUNDERS.includes(value)) return;

    try {
      GM_setValue(REFUNDER_PREF_KEY, value);
      console.log('[Better CMS] Preferred refunder saved:', value);
    } catch (error) {
      console.warn('[Better CMS] Could not save preferred refunder:', error);
    }
  }

  function hasOption(select, value) {
    return Array.from(select.options || []).some(option => option.value === value || option.textContent.trim() === value);
  }

  function setSelectValue(select, value) {
    if (!select || !value || !hasOption(select, value)) return;

    if (select.value === value) return;

    select.value = value;

    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function installRefunderPreference() {
    const select = document.getElementById(REFUNDER_SELECT_ID);

    if (!select) return;

    if (!select.dataset.betterCmsRefunderPreferenceInstalled) {
      select.dataset.betterCmsRefunderPreferenceInstalled = 'true';

      select.addEventListener('change', function () {
        const value = select.value || select.options[select.selectedIndex]?.textContent?.trim() || '';

        if (VALID_REFUNDERS.includes(value)) {
          safeSetPreferredRefunder(value);
        }
      });
    }

    const preferred = safeGetPreferredRefunder();

    if (preferred) {
      setSelectValue(select, preferred);
    }
  }

  function initRefunderPreference() {
    if (!document.body) {
      setTimeout(initRefunderPreference, 300);
      return;
    }

    installRefunderPreference();

    onRouteChange(function () {
      const select = document.getElementById(REFUNDER_SELECT_ID);
      if (select && select.dataset.betterCmsRefunderPreferenceInstalled) return;
      installRefunderPreference();
    });
  }

  initRefunderPreference();
})();



/* ============================================================
 * Feature 1b: CMS Session Keep-Alive
 * Keeps the current CMS session warm while the tab remains open.
 * This does not bypass OTP or store authentication data.
 * ============================================================ */

(function () {
    'use strict';

    const KEEP_ALIVE_INTERVAL = 8 * 60 * 1000;
    const REQUEST_TIMEOUT = 15000;

    if (!isCMSHost() || /^\/login(?:\/|$)/i.test(location.pathname)) return;

    let requestInFlight = false;
    let lastNotifiedNeedsLogin = false;

    async function checkSession() {
        if (requestInFlight || /^\/login(?:\/|$)/i.test(location.pathname)) return;
        requestInFlight = true;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

        try {
            // Hitting the page route itself does nothing useful here - CMS
            // is a CloudFront-served SPA shell, so re-requesting e.g.
            // /users/search just gets the same static index.html back
            // (always 200, whether the session is alive or not) without ever
            // touching the backend's actual session/auth logic. api/auth/verify
            // is the real endpoint the app itself calls to check the session.
            const response = await fetch(`${location.origin}/api/auth/verify`, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                redirect: 'follow',
                signal: controller.signal
            });
            const finalPath = (() => {
                try { return new URL(response.url).pathname; } catch (error) { return ''; }
            })();
            if (response.status === 401 || /^\/login(?:\/|$)/i.test(finalPath)) {
                console.warn('[Better ViewLift] CMS session requires OTP/login again.');
                if (!lastNotifiedNeedsLogin) {
                    lastNotifiedNeedsLogin = true;
                    bvNotify('CMS session needs login/OTP again on this tab.', { level: 'warn', ttl: 12000 });
                }
            } else {
                lastNotifiedNeedsLogin = false;
            }
        } catch (error) {
            if (error?.name !== 'AbortError') {
                console.debug('[Better ViewLift] CMS keep-alive check failed.', error);
            }
        } finally {
            window.clearTimeout(timeout);
            requestInFlight = false;
        }
    }

    // Run once after the page settles, then periodically. A focus check helps
    // recover quickly when returning to a tab that has been backgrounded.
    window.setTimeout(checkSession, 15000);
    window.setInterval(checkSession, KEEP_ALIVE_INTERVAL);
    window.addEventListener('focus', () => window.setTimeout(checkSession, 250));
})();


/* ============================================================
 * Feature 1b2: CMS Session Keep-Alive (driven from Freshdesk)
 * Chrome freezes a backgrounded tab's own timers, so the keep-alive above
 * stops firing as soon as you tab away from CMS to work in Freshdesk. This
 * pings the same CMS hosts from the Freshdesk tab instead, since that's the
 * tab you're actually using and Chrome won't freeze it.
 * This does not bypass OTP or store authentication data.
 * ============================================================ */

(function () {
    'use strict';

    if (location.hostname !== 'viewlift.freshdesk.com') return;
    if (typeof GM_xmlhttpRequest !== 'function') return;

    // Requesting the bare page route does nothing useful - CMS is a
    // CloudFront-served SPA shell, so it returns the same static
    // index.html (always 200) whether the session is alive or not,
    // without ever touching the backend's real session/auth logic.
    // api/auth/verify is the actual endpoint the app itself calls to
    // check the session - confirmed live on cms.viewlift.com and
    // cms-gcp.viewlift.com via the browser's own network requests.
    const CMS_KEEP_ALIVE_HOSTS = [
        'https://cms.viewlift.com/api/auth/verify',
        'https://cms-gcp.viewlift.com/api/auth/verify',
        'https://cms-qcp.viewlift.com/api/auth/verify',
        'https://cms.monumentalsportsnetwork.com/api/auth/verify'
    ];
    const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000;

    function pingCMSHost(url, onDone) {
        GM_xmlhttpRequest({
            method: 'GET',
            url,
            timeout: 15000,
            anonymous: false,
            onload: response => {
                const needsLogin = response.status === 401 || /\/login(?:\/|$)/i.test(response.finalUrl || '');
                if (needsLogin) {
                    console.debug('[Better ViewLift] CMS session (' + url + ') requires OTP/login again.');
                }
                onDone(needsLogin ? 'needs-login' : 'alive');
            },
            onerror: () => onDone('error'),
            ontimeout: () => onDone('error')
        });
    }

    function recordKeepAliveStatus(hostResults) {
        const values = Object.values(hostResults);
        let overall = 'alive';

        if (values.some(status => status === 'needs-login')) {
            overall = 'needs-login';
        } else if (values.every(status => status === 'error')) {
            overall = 'error';
        }

        let previous = null;
        try {
            previous = GM_getValue(BV_CMS_KEEP_ALIVE_STATUS_KEY, null);
        } catch (error) { /* storage unavailable */ }

        if (overall === 'needs-login' && previous?.overall !== 'needs-login') {
            bvNotify('CMS session needs login/OTP - the keep-alive from Freshdesk can\'t fix that for you.', { level: 'warn', ttl: 12000 });
        }

        try {
            GM_setValue(BV_CMS_KEEP_ALIVE_STATUS_KEY, {
                overall,
                hosts: hostResults,
                checkedAt: Date.now()
            });
        } catch (error) { /* storage unavailable, skip */ }
    }

    function pingAllCMSHosts(onComplete) {
        // Only bother while Freshdesk is actually the tab being looked at -
        // if neither tab is active there is nothing useful to keep alive.
        if (document.visibilityState !== 'visible') {
            onComplete?.();
            return;
        }

        const hostResults = {};
        let remaining = CMS_KEEP_ALIVE_HOSTS.length;

        CMS_KEEP_ALIVE_HOSTS.forEach(url => {
            pingCMSHost(url, status => {
                hostResults[url] = status;
                remaining -= 1;
                if (remaining === 0) {
                    recordKeepAliveStatus(hostResults);
                    onComplete?.();
                }
            });
        });
    }

    window.setTimeout(pingAllCMSHosts, 20000);
    window.setInterval(pingAllCMSHosts, KEEP_ALIVE_INTERVAL);
    window.addEventListener('focus', () => window.setTimeout(pingAllCMSHosts, 250));

    // Lets the toolbar's session dot trigger an immediate check on click,
    // instead of waiting up to 5 minutes for the next scheduled ping.
    window.__bvPingCMSHostsNow = pingAllCMSHosts;
})();


/* ============================================================
 * Feature 1c: Classic CMS Account Switcher
 * The classic CMS does not expose the v5 organization picker. This helper
 * offers the same control and automates the short v5 handoff in the background.
 * ============================================================ */

(function () {
    'use strict';

    const BUTTON_ID = 'better-cms-account-switcher';
    const MENU_ID = 'better-cms-account-switcher-menu';
    const STYLE_ID = 'better-cms-account-switcher-style';
    const PENDING_KEY = 'betterCmsPendingAccountSwitch';
    const ORGANIZATIONS = [
        { key: 'lightning', label: 'Lightning' },
        { key: 'liv-golf', label: 'LIV Golf' },
        { key: 'schn', label: 'SCHN' }
    ];
    let switchRunning = false;

    if (!isCMSHost()) return;

    function clean(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function safeGetPending() {
        try {
            const value = GM_getValue(PENDING_KEY, '');
            return typeof value === 'string' ? JSON.parse(value) : value;
        } catch (error) {
            return null;
        }
    }

    function safeSetPending(value) {
        try {
            GM_setValue(PENDING_KEY, JSON.stringify(value));
        } catch (error) {
            console.warn('[CMS Account Switcher] Could not save pending switch.', error);
        }
    }

    function clearPending() {
        try {
            GM_deleteValue(PENDING_KEY);
        } catch (error) {
            safeSetPending(null);
        }
    }

    function isClassicCMSPage() {
        return /^\/users(?:\/|$)/i.test(location.pathname);
    }

    function isV5Page() {
        return /^\/v5(?:\/|$)/i.test(location.pathname);
    }

    function isLogoutPage() {
        return /^\/logout(?:\/|$)/i.test(location.pathname);
    }

    function captureQuerySwitchRequest() {
        try {
            const params = new URLSearchParams(location.search);
            const key = clean(params.get('betterSwitch')).toLowerCase();
            if (!ORGANIZATIONS.some(item => item.key === key)) return;

            // CMS's own /users/search page reads "keyword"/"filter" itself and
            // runs the real search on load - carrying the email through as
            // these native params means no DOM fill/click simulation is
            // needed once we land back there after the account switch.
            const email = clean(params.get('keyword'));
            const returnUrl = `${location.origin}/users/search${email ? `?keyword=${encodeURIComponent(email)}&filter=all` : ''}`;
            safeSetPending({ key, returnUrl, startedAt: Date.now() });
        } catch (error) {
            console.warn('[CMS Account Switcher] Could not read the requested account.', error);
        }
    }

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${BUTTON_ID} {
                position: fixed !important;
                top: 16px !important;
                right: 88px !important;
                z-index: 2147483000 !important;
                min-height: 34px !important;
                padding: 0 13px !important;
                border: 1px solid #c4b5fd !important;
                border-radius: 8px !important;
                background: linear-gradient(180deg, #f5f3ff 0%, #ede9fe 100%) !important;
                color: #5b21b6 !important;
                font: 700 12px/32px Arial, sans-serif !important;
                letter-spacing: .02em !important;
                cursor: pointer !important;
                box-shadow: 0 4px 12px rgba(91, 33, 182, .18), inset 0 1px 0 rgba(255, 255, 255, .6) !important;
                transition: background 140ms ease, box-shadow 140ms ease, transform 140ms ease !important;
            }
            #${BUTTON_ID}:hover {
                background: linear-gradient(180deg, #ede9fe 0%, #ddd6fe 100%) !important;
                box-shadow: 0 6px 16px rgba(91, 33, 182, .24), inset 0 1px 0 rgba(255, 255, 255, .5) !important;
                transform: translateY(-1px) !important;
            }
            #${BUTTON_ID}:active {
                transform: translateY(0) !important;
                box-shadow: 0 2px 6px rgba(91, 33, 182, .18), inset 0 2px 4px rgba(0, 0, 0, .08) !important;
            }
            #${BUTTON_ID}[data-busy="yes"] { opacity: .65 !important; cursor: wait !important; transform: none !important; }
            #${MENU_ID} {
                position: fixed !important;
                z-index: 2147483001 !important;
                display: none;
                min-width: 170px;
                padding: 6px;
                border: 1px solid #d8d4fe;
                border-radius: 10px;
                background: #fff;
                box-shadow: 0 12px 30px rgba(15, 23, 42, .22);
            }
            #${MENU_ID}[data-open="yes"] { display: grid; gap: 3px; }
            #${MENU_ID} button {
                width: 100%;
                padding: 9px 11px;
                border: 0;
                border-radius: 7px;
                background: transparent;
                color: #1f2937;
                font: 600 13px/18px Arial, sans-serif;
                text-align: left;
                cursor: pointer;
            }
            #${MENU_ID} button:hover { background: #ede9fe; color: #5b21b6; }
        `;
        document.head.appendChild(style);
    }

    function findLogoControl() {
        const candidates = Array.from(document.querySelectorAll('img, a, button, [role="button"]'));
        return candidates.find(element => {
            if (!element.getBoundingClientRect().width) return false;
            const image = element.tagName.toLowerCase() === 'img' ? element : element.querySelector('img');
            const text = clean([
                element.getAttribute('aria-label'),
                element.getAttribute('title'),
                image?.getAttribute('alt'),
                image?.getAttribute('src')
            ].join(' ')).toLowerCase();
            return /schn|viewlift|liv.?golf|altitude|monumental|logo/.test(text);
        }) || null;
    }

    function getOrganizationButton() {
        const knownKeys = ORGANIZATIONS.map(item => item.key);
        return Array.from(document.querySelectorAll('button')).find(button => {
            if (!button.getBoundingClientRect().width) return false;
            const imgAlt = button.querySelector('img')?.getAttribute('alt') || '';
            const text = clean([button.textContent, button.getAttribute('aria-label'), imgAlt].join(' ')).toLowerCase();
            return knownKeys.some(key => text === key || text.includes(` ${key}`));
        }) || null;
    }

    function getOrganizationOption(key) {
        const byValue = document.querySelector(`[role="option"][data-value="${CSS.escape(key)}"]`) ||
            document.querySelector(`[role="option"][data-value="${key}"]`);

        if (byValue) return byValue;

        return Array.from(document.querySelectorAll('[role="option"]')).find(option => {
            const text = clean(option.textContent).toLowerCase();
            return text === key || text.startsWith(`${key} `) || text.includes(` ${key}`);
        }) || null;
    }

    function getOrganizationKeyFromButton(button) {
        const text = clean([
            button?.textContent,
            button?.getAttribute('aria-label'),
            button?.querySelector('img')?.getAttribute('alt')
        ].join(' ')).toLowerCase();
        return ORGANIZATIONS.find(item => text === item.key || text.includes(item.key))?.key || '';
    }

    function showStatus(message, error = false) {
        const button = document.getElementById(BUTTON_ID);
        if (!button) return;
        button.title = message;
        button.dataset.busy = error ? 'no' : 'yes';
        button.textContent = error ? 'Switch Account' : message;
        window.setTimeout(() => {
            if (button.isConnected) {
                button.textContent = 'Switch Account';
                button.dataset.busy = 'no';
            }
        }, 2600);
    }

    function closeAccountMenu() {
        const menu = document.getElementById(MENU_ID);
        if (menu) menu.dataset.open = 'no';
    }

    function openAccountMenu(anchor) {
        let menu = document.getElementById(MENU_ID);
        if (!menu) {
            menu = document.createElement('div');
            menu.id = MENU_ID;
            menu.setAttribute('role', 'menu');
            ORGANIZATIONS.forEach(item => {
                const option = document.createElement('button');
                option.type = 'button';
                option.textContent = item.label;
                option.dataset.account = item.key;
                option.setAttribute('role', 'menuitem');
                option.addEventListener('click', event => {
                    event.stopPropagation();
                    const key = option.dataset.account;
                    safeSetPending({ key, returnUrl: location.href, startedAt: Date.now() });
                    closeAccountMenu();
                    showStatus('Switching...');
                    location.href = `${location.origin}/v5/overview?betterSwitch=${encodeURIComponent(key)}`;
                });
                menu.appendChild(option);
            });
            document.body.appendChild(menu);
        }

        const rect = anchor.getBoundingClientRect();
        menu.style.left = `${Math.max(8, rect.left)}px`;
        menu.style.top = `${Math.min(window.innerHeight - 12, rect.bottom + 6)}px`;
        menu.dataset.open = menu.dataset.open === 'yes' ? 'no' : 'yes';
    }

    function continueFromLogout() {
        if (!isLogoutPage()) return;
        let hasPendingRequest = Boolean(safeGetPending());
        if (!hasPendingRequest) {
            try { hasPendingRequest = Boolean(GM_getValue('betterFreshdeskPendingCmsEmail', '')); } catch (error) { /* no-op */ }
        }
        if (!hasPendingRequest) return;
        const loginControl = Array.from(document.querySelectorAll('a, button, [role="button"]'))
            .find(element => /go\s+to\s+login|login|sign\s+in/i.test(clean(element.textContent)) && element.getBoundingClientRect().width);
        if (loginControl) {
            loginControl.click();
        } else {
            window.setTimeout(continueFromLogout, 500);
        }
    }

    function installClassicButton() {
        if (!isClassicCMSPage()) return;
        addStyles();
        const logo = findLogoControl();
        if (logo && !logo.dataset.betterAccountSwitcherBound) {
            logo.dataset.betterAccountSwitcherBound = 'yes';
            logo.style.cursor = 'pointer';
            logo.title = 'Switch CMS account';
            logo.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                openAccountMenu(logo);
            }, true);
            return;
        }

        // Fallback for themes that render the logo after the page loads.
        if (logo || document.getElementById(BUTTON_ID)) return;
        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.textContent = 'Switch Account';
        button.title = 'Switch CMS account';
        button.addEventListener('click', () => openAccountMenu(button));
        document.body.appendChild(button);
    }

    function runV5Switch() {
        if (!isV5Page()) return;
        if (switchRunning) return;
        const pending = safeGetPending();
        if (!pending || !pending.key) return;
        if (Date.now() - Number(pending.startedAt || 0) > 30000) {
            clearPending();
            return;
        }

        const accountButton = getOrganizationButton();
        if (!accountButton) {
            window.setTimeout(runV5Switch, 250);
            return;
        }

        const currentKey = getOrganizationKeyFromButton(accountButton);
        const returnUrl = pending.returnUrl || `${location.origin}/users/search`;
        if (currentKey === pending.key) {
            clearPending();
            window.setTimeout(() => location.replace(returnUrl), 400);
            return;
        }

        switchRunning = true;
        // A real account switch is genuinely slower than a same-org search
        // (this v5 dashboard has to load, then the org dropdown, before the
        // actual search can even start) - visible so the delay reads as
        // expected instead of a mystery slowdown, unlike hosts that never
        // need this step (MSN, standard) and go straight to the search.
        bvNotify(
            `Switching CMS account to ${pending.key.toUpperCase()} before searching - this takes a bit longer than brands that don't need an account switch.`,
            { level: 'info', ttl: 8000 }
        );
        const existingOption = getOrganizationOption(pending.key);
        if (!existingOption) accountButton.click();
        window.setTimeout(() => {
            const option = getOrganizationOption(pending.key);
            if (!option || option.getAttribute('aria-disabled') === 'true' || option.getAttribute('data-disabled') === 'true') {
                console.warn('[CMS Account Switcher] Account is unavailable:', pending.key);
                clearPending();
                switchRunning = false;
                return;
            }

            option.click();
            clearPending();
            // Give the v5 app time to persist the selected organization before
            // returning to the classic route.
            window.setTimeout(() => location.replace(returnUrl), 1200);
        }, 500);
    }

    captureQuerySwitchRequest();
    installClassicButton();
    continueFromLogout();
    runV5Switch();
    onRouteChange(() => {
        installClassicButton();
        continueFromLogout();
        runV5Switch();
    });
    document.addEventListener('click', event => {
        const menu = document.getElementById(MENU_ID);
        if (menu && menu.dataset.open === 'yes' && !menu.contains(event.target)) closeAccountMenu();
    });
})();


/* ============================================================
 * Feature 2: CMS Auto Fill Cancellation Reason
 * Source: ViewLift CMS auto fill cancellation reason 1.0
 * ============================================================ */


if (isCMSHost()) {

(function () {
    'use strict';

    const LEGACY_CANCELLATION_REASON = 'User did not use the service and requested a refund and a cancellation';

    let shouldFillReason = false;
    let fillAttempts = 0;
    const maxFillAttempts = 20;

    function isVisible(element) {
        if (!element) return false;

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
        );
    }

    function isCancelButton(element) {
        const button = element?.closest?.('button');

        if (!button || !isVisible(button)) return false;

        const text = (button.innerText || button.textContent || '').trim().toLowerCase();

        const isLegacyCancelButton = (
            text === 'cancel' &&
            button.className.includes('MuiButton') &&
            button.className.includes('Error')
        );

        return isLegacyCancelButton || text === 'initiate cancellation';
    }

    function getFreshdeskTicketURL() {
        const liveValue = String(
            document.getElementById('refund-freshdesk')?.value || ''
        ).trim();

        if (/^https:\/\/viewlift\.freshdesk\.com\/a\/tickets\/\d+$/i.test(liveValue)) {
            return liveValue;
        }

        try {
            const storedValue = String(GM_getValue('Freshdesk ID', '') || '').trim();

            return /^https:\/\/viewlift\.freshdesk\.com\/a\/tickets\/\d+$/i.test(storedValue)
                ? storedValue
                : '';
        } catch (error) {
            return '';
        }
    }

    function getCancellationReasonValue() {
        return getFreshdeskTicketURL();
    }

    function setNativeValue(element, value) {
        const tagName = element.tagName.toLowerCase();
        const prototype = tagName === 'textarea'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;

        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

        const previousValue = element.value;

        if (descriptor && descriptor.set) {
            descriptor.set.call(element, value);
        } else {
            element.value = value;
        }

        if (element._valueTracker) {
            element._valueTracker.setValue(previousValue);
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    }

    function getBestReasonField() {
        const fields = Array.from(document.querySelectorAll('textarea, input, [contenteditable="true"]'))
            .filter(field => {
                if (!isVisible(field)) return false;

                const tagName = field.tagName.toLowerCase();
                const type = (field.getAttribute('type') || '').toLowerCase();

                if (field.disabled || field.readOnly) return false;
                if (['hidden', 'submit', 'button', 'checkbox', 'radio'].includes(type)) return false;

                const ariaLabel = field.getAttribute('aria-label') || '';
                const placeholder = field.getAttribute('placeholder') || '';
                const name = field.getAttribute('name') || '';
                const id = field.getAttribute('id') || '';

                const combined = `${ariaLabel} ${placeholder} ${name} ${id}`.toLowerCase();

                if (
                    combined.includes('search') ||
                    combined.includes('email') ||
                    combined.includes('phone') ||
                    combined.includes('date')
                ) {
                    return false;
                }

                return tagName === 'textarea' || tagName === 'input' || field.isContentEditable;
            });

        if (!fields.length) return null;

        const priorityWords = [
            'reason',
            'cancel',
            'cancellation',
            'refund',
            'note',
            'notes',
            'comment',
            'comments',
            'description',
            'message'
        ];

        const scored = fields.map(field => {
            const labelText = getNearbyText(field).toLowerCase();
            const attributes = [
                field.getAttribute('aria-label'),
                field.getAttribute('placeholder'),
                field.getAttribute('name'),
                field.getAttribute('id')
            ].filter(Boolean).join(' ').toLowerCase();

            const searchableText = `${labelText} ${attributes}`;

            let score = 0;

            if (field.tagName.toLowerCase() === 'textarea') score += 10;
            if (field.isContentEditable) score += 8;

            for (const word of priorityWords) {
                if (searchableText.includes(word)) {
                    score += 20;
                }
            }

            return { field, score };
        });

        scored.sort((a, b) => b.score - a.score);

        return scored[0].field;
    }

    function getNearbyText(field) {
        const parent = field.closest('.MuiFormControl-root, .MuiDialog-root, .MuiBox-root, form, div');

        if (!parent) return '';

        return parent.innerText || parent.textContent || '';
    }

    function fillReasonField() {
        if (!shouldFillReason) return false;

        fillAttempts += 1;

        let reasonValue = getCancellationReasonValue();

        if (!reasonValue) {
            if (fillAttempts < maxFillAttempts) return false;

            // Waited the full window for the real ticket link (cross-tab GM
            // value may still be propagating) and it never showed up - fall
            // back to the generic reason instead of leaving the field blank.
            reasonValue = LEGACY_CANCELLATION_REASON;
            console.warn('[ViewLift Cancel Reason] Freshdesk ticket was not available, used the generic reason instead.');
        }

        const field = getBestReasonField();

        if (!field) {
            if (fillAttempts >= maxFillAttempts) {
                shouldFillReason = false;
                fillAttempts = 0;
                console.log('[ViewLift Cancel Reason] No reason field found');
            }

            return false;
        }

        if (field.isContentEditable) {
            field.focus();
            field.innerText = reasonValue;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
            field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        } else {
            field.focus();
            setNativeValue(field, reasonValue);
        }

        shouldFillReason = false;
        fillAttempts = 0;

        console.log('[ViewLift Cancel Reason] Cancellation reason filled:', reasonValue);
        return true;
    }

    async function scheduleFillReason() {
        fillAttempts = 0;
        await waitFor(fillReasonField, { timeout: 3000, pollMs: 50 });
    }

    document.addEventListener('click', function (event) {
        if (!isCancelButton(event.target)) return;

        shouldFillReason = true;
        scheduleFillReason();

        console.log('[ViewLift Cancel Reason] Cancel button clicked');
    }, true);

    onRouteChange(function () {
        if (shouldFillReason) {
            fillReasonField();
        }
    });

})();

}

/* ============================================================
 * Feature 9: Freshdesk Set Agent
 * Source: Better Freshdesk My Agent 1.1
 * ============================================================ */

(function () {
    'use strict';

    if (location.hostname !== 'viewlift.freshdesk.com') return;

    const BUTTON_ID = 'better-freshdesk-my-agent-button';
    const MENU_ID = 'better-freshdesk-my-agent-menu';
    const STYLE_ID = 'better-freshdesk-my-agent-style';
    const TOAST_ID = 'better-freshdesk-my-agent-toast';
    const STORAGE_KEY = 'betterFreshdeskMyAgentName';
    const CMS_BUTTON_ID = 'viewlift-open-cms-header-button';
    const OWNER_VALUE = 'better-cms-set-agent-1.1';
    const AGENT_TRIGGER_SELECTOR = [
        '.ember-power-select-trigger',
        '[id^="ember-power-select-trigger-"]',
        '[role="button"][aria-owns*="ember-basic-dropdown-content"]',
        '[role="combobox"]',
        '[aria-haspopup="listbox"]',
        'select'
    ].join(',');
    const FALLBACK_AGENT_NAMES = [
        'Adrian Fernandez',
        'Ankur Prabhakar',
        'Erick Ramirez',
        'Esteban Ramirez',
        'Fan Assist',
        'Gerald Eduardo Calero Valverde',
        'rajnish kumar',
        'Sebastian Rojas Grant',
        'Vernon Steven Maithand Raude'
    ];

    let actionInProgress = false;
    let installTimer = null;

    function isTicketPage() {
        return /^\/a\/tickets\/\d+(?:\/|$)/i.test(location.pathname);
    }

    function cleanAgentText(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeAgentName(value) {
        return cleanAgentText(value).toLowerCase();
    }

    function isUsableAgentElement(element) {
        if (!element || !element.isConnected) return false;

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
        );
    }

    function getSavedAgentName() {
        try {
            return cleanAgentText(GM_getValue(STORAGE_KEY, ''));
        } catch (error) {
            try {
                return cleanAgentText(localStorage.getItem(STORAGE_KEY) || '');
            } catch (storageError) {
                return '';
            }
        }
    }

    function saveAgentName(agentName) {
        const cleanedName = cleanAgentText(agentName);

        if (!cleanedName) return false;

        try {
            GM_setValue(STORAGE_KEY, cleanedName);
        } catch (error) {
            try {
                localStorage.setItem(STORAGE_KEY, cleanedName);
            } catch (storageError) {
                console.error('[Set Agent] Could not save the agent name.', storageError);
                return false;
            }
        }

        updateSetAgentButton();
        return true;
    }

    function addSetAgentStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${BUTTON_ID} {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                height: 32px !important;
                margin-right: 6px !important;
                padding: 0 12px !important;
                border: 1px solid #334155 !important;
                border-radius: 8px !important;
                background: linear-gradient(180deg, #64748b 0%, #475569 100%) !important;
                color: #fff !important;
                font-size: 12px !important;
                font-weight: 700 !important;
                letter-spacing: .02em !important;
                line-height: 30px !important;
                white-space: nowrap !important;
                cursor: pointer !important;
                box-shadow: 0 4px 12px rgba(71, 85, 105, .3), inset 0 1px 0 rgba(255, 255, 255, .16) !important;
                transition: background 140ms ease, box-shadow 140ms ease, transform 140ms ease !important;
            }

            #${BUTTON_ID}:hover {
                border-color: #1e293b !important;
                background: linear-gradient(180deg, #475569 0%, #334155 100%) !important;
                box-shadow: 0 6px 16px rgba(71, 85, 105, .38), inset 0 1px 0 rgba(255, 255, 255, .14) !important;
                transform: translateY(-1px) !important;
            }

            #${BUTTON_ID}:active {
                transform: translateY(0) !important;
                box-shadow: 0 2px 6px rgba(71, 85, 105, .28), inset 0 2px 4px rgba(0, 0, 0, .16) !important;
            }

            #${BUTTON_ID}[data-configured="no"] {
                border-color: #92400e !important;
                background: linear-gradient(180deg, #d97706 0%, #b45309 100%) !important;
                box-shadow: 0 4px 12px rgba(180, 83, 9, .32), inset 0 1px 0 rgba(255, 255, 255, .18) !important;
            }

            #${BUTTON_ID}[data-configured="no"]:hover {
                background: linear-gradient(180deg, #b45309 0%, #92400e 100%) !important;
            }

            #${BUTTON_ID}[data-busy="yes"] {
                opacity: .72 !important;
                cursor: wait !important;
                transform: none !important;
            }

            #${MENU_ID} {
                position: fixed !important;
                z-index: 2147483646 !important;
                width: 280px !important;
                max-height: min(470px, calc(100vh - 24px)) !important;
                overflow: hidden !important;
                border: 1px solid #cbd5e1 !important;
                border-radius: 10px !important;
                background: #fff !important;
                color: #0f172a !important;
                box-shadow: 0 16px 38px rgba(15, 23, 42, .24) !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
            }

            #${MENU_ID} .set-agent-header {
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                padding: 12px 14px 9px !important;
                border-bottom: 1px solid #e2e8f0 !important;
            }

            #${MENU_ID} .set-agent-title {
                font-size: 13px !important;
                font-weight: 700 !important;
            }

            #${MENU_ID} .set-agent-close {
                width: 26px !important;
                height: 26px !important;
                padding: 0 !important;
                border: 0 !important;
                border-radius: 5px !important;
                background: transparent !important;
                color: #64748b !important;
                cursor: pointer !important;
            }

            #${MENU_ID} .set-agent-help {
                margin: 0 !important;
                padding: 9px 14px !important;
                color: #64748b !important;
                font-size: 11px !important;
                line-height: 1.4 !important;
            }

            #${MENU_ID} .set-agent-options {
                max-height: 310px !important;
                overflow-y: auto !important;
                padding: 4px 8px 8px !important;
            }

            #${MENU_ID} .set-agent-option {
                display: block !important;
                width: 100% !important;
                padding: 9px 10px !important;
                border: 0 !important;
                border-radius: 6px !important;
                background: transparent !important;
                color: #1e293b !important;
                font-size: 12px !important;
                line-height: 1.35 !important;
                text-align: left !important;
                cursor: pointer !important;
            }

            #${MENU_ID} .set-agent-option:hover,
            #${MENU_ID} .set-agent-option[data-selected="yes"] {
                background: #e8f1ff !important;
                color: #0b5cab !important;
            }

            #${MENU_ID} .set-agent-custom {
                display: flex !important;
                gap: 6px !important;
                padding: 10px !important;
                border-top: 1px solid #e2e8f0 !important;
            }

            #${MENU_ID} .set-agent-custom input {
                min-width: 0 !important;
                flex: 1 1 auto !important;
                height: 32px !important;
                padding: 0 9px !important;
                border: 1px solid #cbd5e1 !important;
                border-radius: 6px !important;
                color: #0f172a !important;
                font-size: 12px !important;
            }

            #${MENU_ID} .set-agent-custom button {
                height: 32px !important;
                padding: 0 10px !important;
                border: 1px solid #0b5cab !important;
                border-radius: 6px !important;
                background: #0b5cab !important;
                color: #fff !important;
                font-size: 12px !important;
                font-weight: 600 !important;
                cursor: pointer !important;
            }

            #${TOAST_ID} {
                position: fixed !important;
                z-index: 2147483647 !important;
                right: 22px !important;
                bottom: 22px !important;
                max-width: 380px !important;
                padding: 11px 14px !important;
                border-radius: 8px !important;
                background: #0f172a !important;
                color: #fff !important;
                box-shadow: 0 10px 28px rgba(15, 23, 42, .28) !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                font-size: 12px !important;
                font-weight: 600 !important;
                line-height: 1.4 !important;
            }

            #${TOAST_ID}[data-type="success"] { background: #166534 !important; }
            #${TOAST_ID}[data-type="warning"] { background: #92400e !important; }
            #${TOAST_ID}[data-type="error"] { background: #991b1b !important; }
        `;

        document.head.appendChild(style);
    }

    function showSetAgentToast(message, type = 'success', duration = 2800) {
        const oldToast = document.getElementById(TOAST_ID);

        if (oldToast) oldToast.remove();

        const toast = document.createElement('div');
        toast.id = TOAST_ID;
        toast.textContent = message;
        toast.setAttribute('data-type', type);
        toast.setAttribute('role', 'status');
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), duration);
    }

    function updateSetAgentButton() {
        const button = document.getElementById(BUTTON_ID);

        if (!button || button.getAttribute('data-busy') === 'yes') return;

        const savedAgentName = getSavedAgentName();
        button.textContent = 'Set Agent';
        button.setAttribute('data-configured', savedAgentName ? 'yes' : 'no');
        button.setAttribute(
            'title',
            savedAgentName
                ? `Click to set Agent Name to ${savedAgentName}. Right-click or Shift-click to change it.`
                : 'Click to choose your Agent Name.'
        );
        button.setAttribute(
            'aria-label',
            savedAgentName
                ? `Set Agent Name to ${savedAgentName}`
                : 'Configure Set Agent'
        );
    }

    function setSetAgentBusy(isBusy, label) {
        const button = document.getElementById(BUTTON_ID);

        if (!button) return;

        if (isBusy) {
            button.setAttribute('data-busy', 'yes');
            button.disabled = true;
            button.textContent = label || 'Working...';
            return;
        }

        button.removeAttribute('data-busy');
        button.disabled = false;
        updateSetAgentButton();
    }

    function clickAgentElement(element) {
        if (!element || !element.isConnected) return false;

        try {
            element.scrollIntoView({
                block: 'center',
                inline: 'nearest'
            });
        } catch (error) {
            // Continue when the element cannot be scrolled.
        }

        try {
            element.dispatchEvent(new MouseEvent('mouseover', {
                bubbles: true,
                cancelable: true
            }));
            element.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true
            }));
            element.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true
            }));
        } catch (error) {
            console.warn('[Set Agent] Synthetic mouse events were not available.', error);
        }

        try {
            element.click();
            return true;
        } catch (error) {
            console.error('[Set Agent] Native click failed.', error);
            return false;
        }
    }

    function getAgentLabels() {
        return Array.from(document.querySelectorAll([
            'label',
            '[data-test-id*="label" i]',
            '[class*="label" i]',
            'span',
            'p'
        ].join(','))).filter(element => {
            if (element.closest(`#${MENU_ID}, #${BUTTON_ID}`)) return false;
            if (!isUsableAgentElement(element)) return false;

            const text = cleanAgentText(element.textContent).replace(/\s*\*+\s*$/, '');

            return /^agent(?:\s+name)?$/i.test(text);
        });
    }

    function getAgentTriggers(root) {
        if (!root || !root.querySelectorAll) return [];

        return Array.from(root.querySelectorAll(AGENT_TRIGGER_SELECTOR)).filter(element => {
            return (
                !element.closest(`#${MENU_ID}, #${BUTTON_ID}, section#mainactionbar`) &&
                isUsableAgentElement(element)
            );
        });
    }

    function distanceFromAgentLabel(label, trigger) {
        const labelRect = label.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();

        return (
            Math.abs(triggerRect.top - labelRect.bottom) +
            Math.abs(triggerRect.left - labelRect.left) * .2
        );
    }

    function findTriggerNearAgentLabel(label) {
        const labelFor = cleanAgentText(label.getAttribute('for') || '');

        if (labelFor) {
            const associated = document.getElementById(labelFor);

            if (associated) {
                const trigger =
                    (associated.matches(AGENT_TRIGGER_SELECTOR) && associated) ||
                    associated.closest(AGENT_TRIGGER_SELECTOR) ||
                    associated.querySelector(AGENT_TRIGGER_SELECTOR);

                if (trigger) return trigger;
            }
        }

        let ancestor = label.parentElement;

        for (let depth = 0; ancestor && depth < 7; depth += 1) {
            const triggers = getAgentTriggers(ancestor);

            if (triggers.length === 1) return triggers[0];

            if (triggers.length > 1) {
                return triggers
                    .slice()
                    .sort((first, second) => {
                        return (
                            distanceFromAgentLabel(label, first) -
                            distanceFromAgentLabel(label, second)
                        );
                    })[0];
            }

            ancestor = ancestor.parentElement;
        }

        return getAgentTriggers(document)
            .slice()
            .sort((first, second) => {
                return (
                    distanceFromAgentLabel(label, first) -
                    distanceFromAgentLabel(label, second)
                );
            })[0] || null;
    }

    function findAgentNameTrigger() {
        for (const label of getAgentLabels()) {
            const trigger = findTriggerNearAgentLabel(label);

            if (trigger) return trigger;
        }

        const knownNames = new Set(FALLBACK_AGENT_NAMES.map(normalizeAgentName));
        const selectedItems = Array.from(
            document.querySelectorAll('.ember-power-select-selected-item')
        );

        const emptyTriggers = [];

        for (const selectedItem of selectedItems) {
            const trigger =
                selectedItem.closest('.ember-power-select-trigger') ||
                selectedItem.parentElement;

            if (!trigger) continue;

            const selectedName = normalizeAgentName(selectedItem.textContent);

            if (knownNames.has(selectedName)) return trigger;

            if (cleanAgentText(selectedItem.textContent) === '--') {
                let context = trigger;
                let score = 0;

                for (let depth = 0; context && depth < 6; depth += 1) {
                    const contextText = cleanAgentText(context.textContent);
                    const attributes = cleanAgentText([
                        context.id,
                        context.getAttribute && context.getAttribute('aria-label'),
                        context.getAttribute && context.getAttribute('data-test-id'),
                        context.getAttribute && context.getAttribute('name')
                    ].filter(Boolean).join(' '));

                    if (/\bagent(?:\s+name)?\b/i.test(contextText)) score += 20 - depth;
                    if (/agent/i.test(attributes)) score += 12 - depth;

                    context = context.parentElement;
                }

                emptyTriggers.push({ trigger, score });
            }
        }

        emptyTriggers.sort((first, second) => second.score - first.score);

        if (emptyTriggers[0] && emptyTriggers[0].score > 0) {
            return emptyTriggers[0].trigger;
        }

        if (emptyTriggers.length === 1) return emptyTriggers[0].trigger;

        return null;
    }

    function getAgentOptions(trigger) {
        if (!trigger) return [];

        if (trigger.matches && trigger.matches('select')) {
            return Array.from(trigger.options || []).filter(option => !option.disabled);
        }

        const triggerId = cleanAgentText(trigger.id || '');
        const ownedContentId = cleanAgentText(
            trigger.getAttribute('aria-owns') ||
            trigger.getAttribute('aria-controls') ||
            ''
        );

        if (triggerId) {
            const lists = Array.from(
                document.querySelectorAll('.ember-power-select-options[aria-controls]')
            ).filter(list => list.getAttribute('aria-controls') === triggerId);

            for (const list of lists) {
                const options = Array.from(
                    list.querySelectorAll('.ember-power-select-option, [role="option"]')
                );

                if (options.length) return options;
            }
        }

        if (ownedContentId) {
            const ownedContent = document.getElementById(ownedContentId);

            if (ownedContent) {
                const options = Array.from(
                    ownedContent.querySelectorAll('.ember-power-select-option, [role="option"]')
                );

                if (options.length) return options;
            }
        }

        const dropdowns = Array.from(document.querySelectorAll([
            '.ember-power-select-dropdown',
            '[role="listbox"]',
            '[role="menu"]'
        ].join(','))).filter(element => {
            return (
                isUsableAgentElement(element) &&
                element.querySelector('.ember-power-select-option, [role="option"]')
            );
        });

        if (!dropdowns.length) return [];

        const triggerRect = trigger.getBoundingClientRect();
        const closestDropdown = dropdowns
            .slice()
            .sort((first, second) => {
                const firstRect = first.getBoundingClientRect();
                const secondRect = second.getBoundingClientRect();
                const firstDistance =
                    Math.abs(firstRect.left - triggerRect.left) +
                    Math.abs(firstRect.top - triggerRect.bottom);
                const secondDistance =
                    Math.abs(secondRect.left - triggerRect.left) +
                    Math.abs(secondRect.top - triggerRect.bottom);

                return firstDistance - secondDistance;
            })[0];

        return Array.from(
            closestDropdown.querySelectorAll('.ember-power-select-option, [role="option"]')
        );
    }

    function waitForAgentOptions(trigger, timeout = 1800) {
        let lastOptions = [];

        return waitFor(() => {
            lastOptions = getAgentOptions(trigger);
            return lastOptions.length ? lastOptions : null;
        }, { timeout, pollMs: 60 }).then(() => lastOptions);
    }

    async function openAgentOptions() {
        const trigger = findAgentNameTrigger();

        if (!trigger) {
            return {
                trigger: null,
                options: []
            };
        }

        let options = getAgentOptions(trigger);

        if (!options.length) {
            clickAgentElement(trigger);
            options = await waitForAgentOptions(trigger);
        }

        return {
            trigger: trigger,
            options: options
        };
    }

    function getAgentOptionNames(options) {
        const names = [];
        const seen = new Set();

        options.forEach(option => {
            const name = cleanAgentText(option.textContent);
            const normalized = normalizeAgentName(name);

            if (!name || name === '--' || !normalized || seen.has(normalized)) return;

            seen.add(normalized);
            names.push(name);
        });

        return names;
    }

    function getSelectedAgentText(trigger) {
        if (!trigger) return '';

        if (trigger.matches && trigger.matches('select')) {
            const selectedOption = trigger.selectedOptions && trigger.selectedOptions[0];
            return cleanAgentText(selectedOption ? selectedOption.textContent : '');
        }

        const selectedItem = trigger.querySelector
            ? trigger.querySelector('.ember-power-select-selected-item, [aria-selected="true"]')
            : null;

        return cleanAgentText(
            selectedItem ? selectedItem.textContent : trigger.textContent
        );
    }

    function selectAgentOption(trigger, option) {
        if (
            trigger &&
            trigger.matches &&
            trigger.matches('select') &&
            option &&
            option.matches &&
            option.matches('option')
        ) {
            trigger.value = option.value;
            trigger.dispatchEvent(new Event('input', { bubbles: true }));
            trigger.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        return clickAgentElement(option);
    }

    function closeFreshdeskAgentDropdown(trigger) {
        if (!trigger) return;

        if (
            trigger.getAttribute('aria-expanded') === 'true' ||
            getAgentOptions(trigger).length
        ) {
            document.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape',
                code: 'Escape',
                keyCode: 27,
                which: 27,
                bubbles: true,
                cancelable: true
            }));
        }
    }

    function closeSetAgentMenu() {
        const menu = document.getElementById(MENU_ID);

        if (menu) menu.remove();
    }

    function positionSetAgentMenu(menu) {
        const button = document.getElementById(BUTTON_ID);

        if (!button || !menu) return;

        const buttonRect = button.getBoundingClientRect();
        const width = 280;
        const padding = 10;
        let left = buttonRect.left;

        if (left + width > window.innerWidth - padding) {
            left = window.innerWidth - width - padding;
        }

        menu.style.left = `${Math.max(padding, left)}px`;
        menu.style.top = `${Math.min(
            buttonRect.bottom + 7,
            window.innerHeight - menu.offsetHeight - padding
        )}px`;
    }

    function showSetAgentMenu(agentNames, message) {
        closeSetAgentMenu();

        const savedAgentName = getSavedAgentName();
        const sourceNames = agentNames.length ? agentNames : FALLBACK_AGENT_NAMES;
        const uniqueNames = [];
        const seen = new Set();

        sourceNames.forEach(agentName => {
            const cleanedName = cleanAgentText(agentName);
            const normalized = normalizeAgentName(cleanedName);

            if (!cleanedName || cleanedName === '--' || seen.has(normalized)) return;

            seen.add(normalized);
            uniqueNames.push(cleanedName);
        });

        const menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.setAttribute('role', 'dialog');
        menu.setAttribute('aria-label', 'Configure Set Agent');

        const header = document.createElement('div');
        header.className = 'set-agent-header';

        const title = document.createElement('div');
        title.className = 'set-agent-title';
        title.textContent = 'Choose your Agent Name';

        const closeButton = document.createElement('button');
        closeButton.className = 'set-agent-close';
        closeButton.type = 'button';
        closeButton.textContent = 'X';
        closeButton.setAttribute('aria-label', 'Close');
        closeButton.addEventListener('click', closeSetAgentMenu);

        header.appendChild(title);
        header.appendChild(closeButton);
        menu.appendChild(header);

        const help = document.createElement('p');
        help.className = 'set-agent-help';
        help.textContent = message ||
            'This selection is saved in Better CMS. Right-click Set Agent to change it later.';
        menu.appendChild(help);

        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'set-agent-options';

        uniqueNames.forEach(agentName => {
            const optionButton = document.createElement('button');
            optionButton.type = 'button';
            optionButton.className = 'set-agent-option';
            optionButton.textContent = agentName;
            optionButton.setAttribute(
                'data-selected',
                normalizeAgentName(agentName) === normalizeAgentName(savedAgentName)
                    ? 'yes'
                    : 'no'
            );

            optionButton.addEventListener('click', () => {
                if (!saveAgentName(agentName)) {
                    showSetAgentToast('Could not save the agent name.', 'error');
                    return;
                }

                closeSetAgentMenu();
                showSetAgentToast(`Saved agent: ${agentName}`);
            });

            optionsContainer.appendChild(optionButton);
        });

        menu.appendChild(optionsContainer);

        const customRow = document.createElement('div');
        customRow.className = 'set-agent-custom';

        const customInput = document.createElement('input');
        customInput.type = 'text';
        customInput.placeholder = 'Other exact agent name';
        customInput.value = savedAgentName;

        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.textContent = 'Save';

        function saveCustomAgentName() {
            const customName = cleanAgentText(customInput.value);

            if (!customName) {
                showSetAgentToast('Enter an agent name first.', 'warning');
                customInput.focus();
                return;
            }

            if (!saveAgentName(customName)) {
                showSetAgentToast('Could not save the agent name.', 'error');
                return;
            }

            closeSetAgentMenu();
            showSetAgentToast(`Saved agent: ${customName}`);
        }

        saveButton.addEventListener('click', saveCustomAgentName);
        customInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                saveCustomAgentName();
            }
        });

        customRow.appendChild(customInput);
        customRow.appendChild(saveButton);
        menu.appendChild(customRow);

        document.body.appendChild(menu);
        positionSetAgentMenu(menu);
    }

    async function configureSetAgent() {
        if (actionInProgress || !isTicketPage()) return;

        actionInProgress = true;
        setSetAgentBusy(true, 'Loading...');
        closeSetAgentMenu();

        try {
            const fastTrigger = findAgentNameTrigger();
            const fastCurrentName = getSelectedAgentText(fastTrigger);

            if (
                fastTrigger &&
                normalizeAgentName(fastCurrentName) === normalizeAgentName(savedAgentName)
            ) {
                closeFreshdeskAgentDropdown(fastTrigger);
                const fastUpdateButton = await waitForAgentUpdateButton(fastTrigger, 800);

                if (fastUpdateButton) {
                    clickAgentElement(fastUpdateButton);
                    showSetAgentToast(`Agent updated: ${savedAgentName}`);
                    return;
                }
            }

            const result = await openAgentOptions();
            const liveNames = getAgentOptionNames(result.options);

            closeFreshdeskAgentDropdown(result.trigger);

            if (liveNames.length) {
                showSetAgentMenu(liveNames);
            } else {
                showSetAgentMenu(
                    FALLBACK_AGENT_NAMES,
                    'Freshdesk did not expose the live list. Choose a known agent or enter the exact name below.'
                );
            }
        } catch (error) {
            console.error('[Set Agent] Configuration failed.', error);
            showSetAgentMenu(
                FALLBACK_AGENT_NAMES,
                'Freshdesk did not expose the live list. Choose a known agent or enter the exact name below.'
            );
        } finally {
            actionInProgress = false;
            setSetAgentBusy(false);
        }
    }

    function waitForSelectedAgent(trigger, agentName, timeout = 1200) {
        const expectedName = normalizeAgentName(agentName);

        return waitFor(
            () => normalizeAgentName(getSelectedAgentText(trigger)) === expectedName || null,
            { timeout, pollMs: 60 }
        ).then(Boolean);
    }

    function findAgentUpdateButton(trigger) {
        const roots = [];
        const closestRoot = trigger && trigger.closest
            ? trigger.closest([
                '.ticket-properties-wrapper',
                '[data-test-id="ticket-properties-sticky"]',
                '.ticket-sidebar-sticky',
                '[data-test-id*="ticket-properties"]',
                '[data-test-id*="properties"]'
            ].join(','))
            : null;

        if (closestRoot) roots.push(closestRoot);

        [
            document.querySelector('.ticket-properties-wrapper'),
            document.querySelector('[data-test-id="ticket-properties-sticky"]'),
            document.querySelector('.ticket-sidebar-sticky')
        ].filter(Boolean).forEach(root => {
            if (!roots.includes(root)) roots.push(root);
        });

        function findInRoot(root) {
            return Array.from(root.querySelectorAll('button, [role="button"]'))
                .find(button => {
                    return (
                        isUsableAgentElement(button) &&
                        !button.disabled &&
                        cleanAgentText(button.textContent).toLowerCase() === 'update'
                    );
                }) || null;
        }

        for (const root of roots) {
            const button = findInRoot(root);

            if (button) return button;
        }

        const updateButtons = Array.from(
            document.querySelectorAll('button, [role="button"]')
        ).filter(button => {
            return (
                isUsableAgentElement(button) &&
                !button.disabled &&
                cleanAgentText(button.textContent).toLowerCase() === 'update'
            );
        });

        if (updateButtons.length < 2 || !trigger) {
            return updateButtons[0] || null;
        }

        const triggerRect = trigger.getBoundingClientRect();

        return updateButtons
            .slice()
            .sort((first, second) => {
                return (
                    Math.abs(first.getBoundingClientRect().left - triggerRect.left) -
                    Math.abs(second.getBoundingClientRect().left - triggerRect.left)
                );
            })[0] || null;
    }

    function waitForAgentUpdateButton(trigger, timeout = 1400) {
        return waitFor(() => findAgentUpdateButton(trigger), { timeout, pollMs: 60 });
    }

    async function applySavedAgent() {
        if (actionInProgress || !isTicketPage()) return;

        const savedAgentName = getSavedAgentName();

        if (!savedAgentName) {
            configureSetAgent();
            return;
        }

        actionInProgress = true;
        setSetAgentBusy(true, 'Updating...');
        closeSetAgentMenu();

        try {
            const result = await openAgentOptions();

            if (!result.trigger) {
                showSetAgentToast(
                    'Agent Name field was not found. Open the ticket properties and try again.',
                    'error',
                    4300
                );
                return;
            }

            const currentName = getSelectedAgentText(result.trigger);

            if (normalizeAgentName(currentName) !== normalizeAgentName(savedAgentName)) {
                const matchingOption = result.options.find(option => {
                    return (
                        normalizeAgentName(option.textContent) ===
                        normalizeAgentName(savedAgentName)
                    );
                });

                if (!matchingOption) {
                    closeFreshdeskAgentDropdown(result.trigger);
                    showSetAgentToast(
                        'Saved agent was not found. Choose it again.',
                        'warning',
                        4200
                    );
                    showSetAgentMenu(getAgentOptionNames(result.options));
                    return;
                }

                if (!selectAgentOption(result.trigger, matchingOption)) {
                    showSetAgentToast('Could not select the saved agent.', 'error', 4200);
                    return;
                }

                const changed = await waitForSelectedAgent(
                    result.trigger,
                    savedAgentName
                );

                if (!changed) {
                    showSetAgentToast(
                        'Freshdesk did not confirm the Agent Name change.',
                        'error',
                        4200
                    );
                    return;
                }
            } else {
                closeFreshdeskAgentDropdown(result.trigger);
            }

            const updateButton = await waitForAgentUpdateButton(result.trigger);

            if (!updateButton) {
                showSetAgentToast(
                    `Agent selected: ${savedAgentName}. Click Update to save it.`,
                    'warning',
                    4500
                );
                return;
            }

            clickAgentElement(updateButton);
            showSetAgentToast(`Agent updated: ${savedAgentName}`);
        } catch (error) {
            console.error('[Set Agent] Could not update Agent Name.', error);
            showSetAgentToast('Could not update Agent Name. Try again.', 'error', 4200);
        } finally {
            actionInProgress = false;
            setSetAgentBusy(false);
        }
    }

    function getSetAgentInsertionPoint() {
        const unifiedToolbar = document.getElementById('better-freshdesk-unified-toolbar');

        if (unifiedToolbar) {
            const nextControl =
                document.getElementById('better-freshdesk-next-case') ||
                document.getElementById('better-freshdesk-refund-launcher');

            if (nextControl && nextControl.parentElement === unifiedToolbar) {
                return {
                    mode: 'before',
                    element: nextControl
                };
            }

            return {
                mode: 'append',
                element: unifiedToolbar
            };
        }

        const cmsButton = document.getElementById(CMS_BUTTON_ID);

        if (cmsButton) {
            return {
                mode: 'after',
                element: cmsButton
            };
        }

        const mainActionBar = document.querySelector('section#mainactionbar');
        const leftActions = mainActionBar
            ? mainActionBar.querySelector('.page-actions__left')
            : null;

        if (!leftActions) return null;

        const replyButton = leftActions.querySelector(
            'button[data-test-email-action="reply"]'
        );

        if (replyButton || leftActions.firstElementChild) {
            return {
                mode: 'before',
                element: replyButton || leftActions.firstElementChild
            };
        }

        return {
            mode: 'append',
            element: leftActions
        };
    }

    function createSetAgentButton() {
        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.className =
            'nucleus-button nucleus-button--secondary app-icon-btn--text hint--rounded hint--bottom';
        button.setAttribute('data-set-agent-owner', OWNER_VALUE);

        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            if (event.shiftKey) {
                configureSetAgent();
                return;
            }

            applySavedAgent();
        });

        button.addEventListener('contextmenu', event => {
            event.preventDefault();
            event.stopPropagation();
            configureSetAgent();
        });

        return button;
    }

    function installSetAgentButton() {
        addSetAgentStyles();

        if (!isTicketPage()) {
            const oldButton = document.getElementById(BUTTON_ID);

            if (
                oldButton &&
                oldButton.getAttribute('data-set-agent-owner') === OWNER_VALUE
            ) {
                oldButton.remove();
            }

            closeSetAgentMenu();
            return;
        }

        let button = document.getElementById(BUTTON_ID);

        if (
            button &&
            button.getAttribute('data-set-agent-owner') !== OWNER_VALUE
        ) {
            button.remove();
            button = null;
        }

        if (!button) {
            button = createSetAgentButton();
        }

        const insertionPoint = getSetAgentInsertionPoint();

        if (!insertionPoint || !insertionPoint.element) return;

        if (
            insertionPoint.mode === 'after' &&
            button.previousElementSibling !== insertionPoint.element
        ) {
            insertionPoint.element.insertAdjacentElement('afterend', button);
        } else if (
            insertionPoint.mode === 'before' &&
            button.nextElementSibling !== insertionPoint.element
        ) {
            insertionPoint.element.insertAdjacentElement('beforebegin', button);
        } else if (
            insertionPoint.mode === 'append' &&
            button.parentElement !== insertionPoint.element
        ) {
            insertionPoint.element.appendChild(button);
        }

        updateSetAgentButton();

        // Sweep into the unified toolbar in the same tick instead of waiting
        // for that module's own separate scheduled pass - closes the same
        // race the CMS header button had (button briefly loose, then jumps
        // into place).
        if (typeof window.__bvReconcileFreshdeskToolbar === 'function') {
            window.__bvReconcileFreshdeskToolbar();
        }
    }

    function scheduleSetAgentInstall() {
        clearTimeout(installTimer);
        installTimer = setTimeout(installSetAgentButton, 180);
    }

    function isSendEmailAgentAction(target) {
        const item = target?.closest?.('a.send-and-set-item, a[data-test-link], button');
        if (!item) return false;

        const marker = cleanAgentText([
            item.getAttribute('data-test-link'),
            item.getAttribute('aria-label'),
            item.textContent
        ].filter(Boolean).join(' ')).toLowerCase();

        return marker.includes('send email') || marker.includes('waiting on end user');
    }

    let replayingSendEmailAction = false;

    document.addEventListener('click', function (event) {
        if (replayingSendEmailAction || !isTicketPage() || !isSendEmailAgentAction(event.target)) return;

        const item = event.target.closest('a.send-and-set-item, a[data-test-link], button');
        if (!item) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        replayingSendEmailAction = true;

        Promise.resolve(applySavedAgent()).finally(function () {
            window.setTimeout(function () {
                try {
                    item.click();
                } finally {
                    replayingSendEmailAction = false;
                }
            }, 40);
        });
    }, true);

    document.addEventListener('click', event => {
        const menu = document.getElementById(MENU_ID);

        if (!menu) return;
        if (menu.contains(event.target)) return;
        if (event.target.closest && event.target.closest(`#${BUTTON_ID}`)) return;

        closeSetAgentMenu();
    }, true);

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            closeSetAgentMenu();
        }
    }, true);

    window.addEventListener('resize', () => {
        const menu = document.getElementById(MENU_ID);

        if (menu) positionSetAgentMenu(menu);
    });

    installSetAgentButton();

    onRouteChange(function () {
        const button = document.getElementById(BUTTON_ID);
        if (button && button.isConnected) return;
        scheduleSetAgentInstall();
    });
})();


/* ============================================================
 * Feature 5: Save & End Session Form Autofill
 * Uses the customer email and Freshdesk ticket already captured
 * by the Refund Capture Tool.
 * ============================================================ */

if (isCMSHost()) {

(function () {
    'use strict';

    if (window.__betterCmsEndSessionAutofillInstalled) {
        return;
    }

    window.__betterCmsEndSessionAutofillInstalled = true;

    const EMAIL_KEYS = ['Refund Active Email', 'Refund Email'];
    const TICKET_KEYS = ['Freshdesk ID', 'Refund Active Ticket'];
    const BLOCKED_EMAILS = [
        'sc-appsupport@spacecityhn.com',
        'support@livgolfplus.com',
        'customersupport@altitudeplus.com',
        'customer.support@altitudeplus.com',
        'support@altitudeplus.com'
    ];

    let observerTimer = null;
    const finalizeTimers = new WeakMap();
    const finalizedDialogs = new WeakSet();

    function cleanText(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function safeGet(key) {
        try {
            return cleanText(GM_getValue(key, ''));
        } catch (error) {
            return '';
        }
    }

    function isValidCustomerEmail(value) {
        const email = cleanText(value).toLowerCase();

        if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)) {
            return false;
        }

        if (/@viewlift\.com$/i.test(email)) {
            return false;
        }

        return !BLOCKED_EMAILS.includes(email);
    }

    function normalizeFreshdeskTicket(value) {
        const match = cleanText(value).match(
            /https:\/\/viewlift\.freshdesk\.com\/(?:a\/)?tickets\/(\d+)/i
        );

        return match
            ? `https://viewlift.freshdesk.com/a/tickets/${match[1]}`
            : '';
    }

    function getCapturedCustomerEmail() {
        const panelEmail = cleanText(
            document.getElementById('refund-email')?.value || ''
        );

        const candidates = [
            panelEmail,
            ...EMAIL_KEYS.map(safeGet)
        ];

        return candidates.find(isValidCustomerEmail) || '';
    }

    function getCapturedFreshdeskTicket() {
        const panelTicket = cleanText(
            document.getElementById('refund-freshdesk')?.value || ''
        );

        const candidates = [
            panelTicket,
            ...TICKET_KEYS.map(safeGet)
        ];

        for (const candidate of candidates) {
            const ticket = normalizeFreshdeskTicket(candidate);

            if (ticket) return ticket;
        }

        return '';
    }

    function setControlledValue(element, value) {
        if (!element || !value || element.value === value) {
            return false;
        }

        const previousValue = element.value;
        const prototype = element.tagName.toLowerCase() === 'textarea'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

        if (descriptor && descriptor.set) {
            descriptor.set.call(element, value);
        } else {
            element.value = value;
        }

        if (element._valueTracker) {
            element._valueTracker.setValue(previousValue);
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

        return true;
    }

    function getEndSessionDialog() {
        return Array.from(document.querySelectorAll('[role="dialog"][data-state="open"], [role="dialog"]'))
            .find(dialog => {
                const title = cleanText(
                    dialog.querySelector('[data-slot="dialog-title"], h1, h2, h3')?.textContent || ''
                ).toLowerCase();

                return title.includes('save and end this session');
            }) || null;
    }

    function scheduleFinalizeSession(dialog, customerEmail, freshdeskTicket) {
        if (!dialog || finalizedDialogs.has(dialog)) return;

        const previousTimer = finalizeTimers.get(dialog);

        if (previousTimer) {
            window.clearTimeout(previousTimer);
        }

        const timer = window.setTimeout(function tryFinalize() {
            if (!document.documentElement.contains(dialog) || finalizedDialogs.has(dialog)) {
                return;
            }

            const recipient = dialog.querySelector(
                'input[name="recipient"], input[type="email"][placeholder*="recipient" i]'
            );
            const message = dialog.querySelector(
                'textarea[name="message"], textarea[placeholder*="message" i]'
            );
            const finalizeButton = Array.from(
                dialog.querySelectorAll('button[type="submit"], button')
            ).find(button => {
                const text = cleanText(button.innerText || button.textContent || '').toLowerCase();
                return text === 'finalize session';
            });

            if (!recipient || !message || !finalizeButton) {
                scheduleFinalizeSession(dialog, customerEmail, freshdeskTicket);
                return;
            }

            if (recipient.value !== customerEmail) {
                setControlledValue(recipient, customerEmail);
            }

            if (message.value !== freshdeskTicket) {
                setControlledValue(message, freshdeskTicket);
            }

            const valuesAreReady =
                recipient.value === customerEmail &&
                message.value === freshdeskTicket;

            if (!valuesAreReady || finalizeButton.disabled) {
                scheduleFinalizeSession(dialog, customerEmail, freshdeskTicket);
                return;
            }

            finalizedDialogs.add(dialog);
            finalizeTimers.delete(dialog);
            finalizeButton.click();

            console.log('[Better CMS] End Session form completed and finalized automatically.');
        }, 180);

        finalizeTimers.set(dialog, timer);
    }

    function fillEndSessionForm() {
        const dialog = getEndSessionDialog();

        if (!dialog) return false;

        const recipient = dialog.querySelector(
            'input[name="recipient"], input[type="email"][placeholder*="recipient" i]'
        );
        const message = dialog.querySelector(
            'textarea[name="message"], textarea[placeholder*="message" i]'
        );

        if (!recipient || !message) return false;

        const customerEmail = getCapturedCustomerEmail();
        const freshdeskTicket = getCapturedFreshdeskTicket();

        if (customerEmail) {
            setControlledValue(recipient, customerEmail);
        } else {
            console.warn('[Better CMS] Customer email was not available for End Session.');
        }

        if (freshdeskTicket) {
            setControlledValue(message, freshdeskTicket);
        } else {
            console.warn('[Better CMS] Freshdesk ticket was not available for End Session.');
        }

        if (customerEmail && freshdeskTicket) {
            scheduleFinalizeSession(dialog, customerEmail, freshdeskTicket);
        }

        return Boolean(customerEmail || freshdeskTicket);
    }

    function scheduleFill() {
        waitFor(fillEndSessionForm, { timeout: 1500, pollMs: 50 });
    }

    document.addEventListener('click', function (event) {
        const button = event.target.closest?.('button');

        if (!button) return;

        const text = cleanText(button.innerText || button.textContent || '').toLowerCase();

        if (text.includes('save & end session') || text.includes('save and end session')) {
            scheduleFill();
        }
    }, true);

    function init() {
        if (!document.body) {
            window.setTimeout(init, 250);
            return;
        }

        onRouteChange(function () {
            clearTimeout(observerTimer);
            observerTimer = window.setTimeout(fillEndSessionForm, 50);
        });

        scheduleFill();
    }

    init();
})();

}



/* ============================================================
 * Feature 3: CMS Percentage Refund Workflow
 * Opens Refund > Percentage and prepares the Issue Refund form.
 * Completes the Issue Refund form and submits it automatically.
 * ============================================================ */

if (isCMSHost()) {

(function () {
    'use strict';

    if (window.__betterCmsV5PercentageRefundInstalled) return;
    window.__betterCmsV5PercentageRefundInstalled = true;

    const REFUND_PERCENTAGE = '100';
    const REFUND_REASON_VALUE = 'ROTH';
    const WORKFLOW_TIMEOUT_MS = 20000;

    let workflowActive = false;
    let workflowStartedAt = 0;
    let percentageOptionClicked = false;
    let percentageFilled = false;
    let reasonSelected = false;
    let commentsFilled = false;
    let internalClick = false;
    let lastRefundTriggerClickAt = 0;
    let lastReasonTriggerClickAt = 0;
    let runTimer = null;

    function cleanText(value) {
        return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function getText(element) {
        return cleanText(element?.innerText || element?.textContent || '');
    }

    function isVisible(element) {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 &&
            style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function getRefundTrigger() {
        return Array.from(document.querySelectorAll(
            'button[data-slot="dropdown-menu-trigger"], button[aria-haspopup="menu"]'
        )).filter(isVisible).find(button => getText(button).toLowerCase() === 'refund') || null;
    }

    function isRefundTrigger(target) {
        const button = target?.closest?.('button');
        return Boolean(button && button === getRefundTrigger());
    }

    function realClick(element, message) {
        if (!element || !isVisible(element)) return false;
        internalClick = true;

        try {
            if (typeof window.PointerEvent === 'function') {
                element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true, view: window }));
                element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, view: window }));
                element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, button: 0 }));
            }
            element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
            element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            if (typeof window.PointerEvent === 'function') {
                element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window, button: 0 }));
            }
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } finally {
            internalClick = false;
        }

        if (message) console.log(message);
        return true;
    }

    function setControlledValue(element, value) {
        if (!element) return false;
        if (element.value === value) return true;

        const previousValue = element.value;
        const prototype = element.tagName.toLowerCase() === 'textarea'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

        element.focus();
        if (descriptor?.set) descriptor.set.call(element, value);
        else element.value = value;

        if (element._valueTracker) element._valueTracker.setValue(previousValue);

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        return element.value === value;
    }

    function isPercentageRefundOption(element) {
        if (!element) return false;

        const item = element.closest?.(
            '[data-slot="dropdown-menu-item"], [role="menuitem"], [role="option"], [data-radix-collection-item]'
        );
        if (!item) return false;

        const text = getText(item).toLowerCase();
        return text === 'percentage' || text === '% refund' ||
            text.includes('percentage refund') || text.includes('% refund');
    }

    function getPercentageRefundOption() {
        return Array.from(document.querySelectorAll(
            '[data-slot="dropdown-menu-item"], [role="menuitem"], [role="option"], [data-radix-collection-item]'
        )).filter(isVisible).find(isPercentageRefundOption) || null;
    }

    function getIssueRefundDialog() {
        const dialog = Array.from(document.querySelectorAll(
            '[role="dialog"], [data-slot="dialog-content"]'
        )).filter(isVisible).find(element => {
            const title = getText(element.querySelector(
                '[data-slot="dialog-title"], h1, h2, h3'
            )).toLowerCase();
            return title === 'issue refund' || title === 'issue percentage refund';
        });

        if (dialog) return dialog;

        const input = document.querySelector(
            'input[placeholder*="50 for 50%" i], input[placeholder*="refund percentage" i]'
        );
        if (!input) return null;

        const semanticParent = input.closest?.(
            '[role="dialog"], [data-slot="dialog-content"], form, .modal-content, .modal-dialog, [class*="modal-content" i]'
        );
        if (semanticParent) return semanticParent;

        let parent = input.parentElement;
        for (let depth = 0; parent && depth < 7; depth += 1, parent = parent.parentElement) {
            const text = getText(parent).toLowerCase();
            if (text.includes('issue percentage refund') && parent.querySelector('textarea')) return parent;
        }

        return input.parentElement?.parentElement || null;
    }

    function getPercentageInput(dialog) {
        return dialog?.querySelector(
            'input[placeholder*="50 for 50%" i], input[placeholder*="refund percentage" i]'
        ) || Array.from(dialog?.querySelectorAll('input') || []).find(input =>
            cleanText(input.parentElement?.innerText).toLowerCase().includes('refund percentage')) || null;
    }

    function getReasonTrigger(dialog) {
        return Array.from(dialog?.querySelectorAll(
            'button[data-slot="select-trigger"], button[role="combobox"], [role="combobox"], ' +
            'button[data-slot="dropdown-menu-trigger"], button[aria-haspopup="menu"]'
        ) || []).filter(isVisible).find(element => {
            const text = getText(element).toLowerCase();
            const context = cleanText(element.parentElement?.innerText).toLowerCase();
            return text.includes('reason') || context.includes('reason');
        }) || null;
    }

    function getReasonOption() {
        // Matches the same selector list getPercentageRefundOption() already
        // uses successfully - the reason picker may render as the same kind
        // of Radix dropdown item rather than a distinct "select" component,
        // and narrowing to data-slot="select-item" only was likely why this
        // never found anything to click.
        const options = Array.from(document.querySelectorAll(
            '[data-slot="select-item"], [data-slot="dropdown-menu-item"], [role="option"], [role="menuitem"], [data-radix-collection-item]'
        )).filter(isVisible);

        return options.find(option => {
            const value = cleanText(option.getAttribute('data-value') || '').toUpperCase();
            return value === REFUND_REASON_VALUE || getText(option).toLowerCase().includes('roth');
        }) || null;
    }

    function isRefundActionIconClick(target) {
        const path = target?.closest?.('path');
        if (!path) return false;

        const pathData = cleanText(path.getAttribute('d')).replace(/\s+/g, '');
        const refundEyePath = 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5M12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5m0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3'.replace(/\s+/g, '');
        return pathData === refundEyePath;
    }

    function selectNativeROTH(dialog) {
        const select = Array.from(dialog?.querySelectorAll('select') || []).find(candidate =>
            Array.from(candidate.options || []).some(option => getText(option).toLowerCase().startsWith('roth'))
        );
        if (!select) return false;
        const option = Array.from(select.options || []).find(candidate =>
            cleanText(candidate.value).toUpperCase() === REFUND_REASON_VALUE ||
            getText(candidate).toLowerCase().startsWith('roth')
        );
        if (!option) return false;
        const previousValue = select.value;
        select.value = option.value;
        if (select._valueTracker) select._valueTracker.setValue(previousValue);
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[Better CMS Refund] Reason selected: ROTH.');
        return true;
    }

    function getIssueRefundButton(dialog) {
        const controls = Array.from(dialog?.querySelectorAll(
            'button, [role="button"], input[type="submit"], input[type="button"]'
        ) || []);

        return controls
            .filter(isVisible)
            .find(button => {
                const text = cleanText(
                    getText(button) || button.value || button.getAttribute('aria-label') || ''
                ).toLowerCase();
                return !button.disabled && (text === 'issue refund' || text === 'confirm refund');
            }) || null;
    }

    function extractFreshdeskTicketId(value) {
        const text = cleanText(value);
        const urlMatch = text.match(/viewlift\.freshdesk\.com\/(?:a\/)?tickets\/(\d+)/i);
        if (urlMatch) return urlMatch[1];
        return /^\d+$/.test(text) ? text : '';
    }

    function getFreshdeskTicketId() {
        const liveValue = cleanText(document.getElementById('refund-freshdesk')?.value || '');
        const liveTicketId = extractFreshdeskTicketId(liveValue);
        if (liveTicketId) return liveTicketId;

        try {
            const storedValue = cleanText(GM_getValue('Freshdesk ID', ''));
            return extractFreshdeskTicketId(storedValue);
        } catch (error) {
            return '';
        }
    }

    function getFreshdeskTicketURL() {
        const ticketId = getFreshdeskTicketId();
        return ticketId ? `https://viewlift.freshdesk.com/a/tickets/${ticketId}` : '';
    }

    function scheduleRun(delay = 100) {
        window.clearTimeout(runTimer);
        runTimer = window.setTimeout(runWorkflow, delay);
    }

    function runWorkflow() {
        if (!workflowActive) return;

        if (Date.now() - workflowStartedAt > WORKFLOW_TIMEOUT_MS) {
            workflowActive = false;
            console.warn('[Better CMS Refund] Timed out before all fields were prepared.');
            return;
        }

        const openDialog = getIssueRefundDialog();
        if (openDialog) {
            percentageOptionClicked = true;
        }

        if (!percentageOptionClicked) {
            const option = getPercentageRefundOption();
            if (option) {
                percentageOptionClicked = realClick(option, '[Better CMS Refund] Percentage selected.');
                scheduleRun(150);
                return;
            }

            const trigger = getRefundTrigger();
            if (trigger && trigger.getAttribute('aria-expanded') !== 'true' &&
                Date.now() - lastRefundTriggerClickAt > 500) {
                lastRefundTriggerClickAt = Date.now();
                realClick(trigger, '[Better CMS Refund] Refund menu opened.');
            }
            scheduleRun(120);
            return;
        }

        const dialog = getIssueRefundDialog();
        if (!dialog) {
            scheduleRun(120);
            return;
        }

        if (!percentageFilled) {
            percentageFilled = setControlledValue(getPercentageInput(dialog), REFUND_PERCENTAGE);
        }

        if (!commentsFilled) {
            const textarea = dialog.querySelector(
                'textarea[placeholder*="more details" i], textarea[placeholder*="refund" i], textarea'
            );
            const ticketURL = getFreshdeskTicketURL();
            if (textarea && ticketURL) {
                commentsFilled = setControlledValue(textarea, `Customer wanted a refund: ${ticketURL}`);
            }
        }

        if (!reasonSelected) {
            if (selectNativeROTH(dialog)) {
                reasonSelected = true;
            } else {
                const option = getReasonOption();
                if (option) {
                    reasonSelected = realClick(option, '[Better CMS Refund] Reason selected: ROTH.');
                } else {
                    // Previously assumed "already selected" whenever the
                    // trigger's visible text didn't literally match "select a
                    // reason" - a live CMS wording mismatch made this true
                    // immediately without ever actually picking ROTH, so the
                    // form could submit with the wrong (or no) reason instead
                    // of just failing to select one. Always try to open the
                    // menu and pick ROTH explicitly; the 20s workflowStartedAt
                    // timeout above is the only bailout now.
                    const trigger = getReasonTrigger(dialog);
                    if (trigger && trigger.getAttribute('aria-expanded') !== 'true' &&
                        Date.now() - lastReasonTriggerClickAt > 500) {
                        lastReasonTriggerClickAt = Date.now();
                        realClick(trigger, '[Better CMS Refund] Reason menu opened.');
                    }
                }
            }
        }

        if (percentageFilled && reasonSelected && commentsFilled) {
            const submitButton = getIssueRefundButton(dialog);
            if (submitButton) {
                realClick(submitButton, '[Better CMS Refund] Issue Refund clicked automatically.');
                workflowActive = false;
                return;
            }
        }

        scheduleRun(150);
    }

    function startWorkflow(percentageAlreadySelected = false) {
        workflowActive = true;
        workflowStartedAt = Date.now();
        percentageOptionClicked = percentageAlreadySelected;
        percentageFilled = false;
        reasonSelected = false;
        commentsFilled = false;
        lastRefundTriggerClickAt = Date.now();
        lastReasonTriggerClickAt = 0;
        scheduleRun(80);
    }

    document.addEventListener('click', function (event) {
        if (internalClick) return;

        if (isRefundActionIconClick(event.target)) {
            startWorkflow(false);
            return;
        }

        if (isRefundTrigger(event.target)) {
            startWorkflow(false);
            return;
        }

        if (isPercentageRefundOption(event.target)) {
            startWorkflow(true);
        }
    }, true);

    const observer = new MutationObserver(function () {
        if (workflowActive) scheduleRun(60);
    });

    function init() {
        if (!document.body) {
            window.setTimeout(init, 250);
            return;
        }

        observer.observe(document.body, { childList: true, subtree: true });
    }

    init();
})();

}

/* ============================================================
 * Feature: Auto-fill the "Cancel Subscription?" confirmation Comments field
 * A separate v5 dialog from the classic Cancellation Reason field (Feature
 * 2 above) - its own required "Comments" textarea was always coming back
 * empty. Fills it with the Freshdesk ticket link, same idea as Feature 2,
 * but never touches the actual confirm/cancel button - the agent still
 * reviews and submits by hand.
 * ============================================================ */

if (isCMSHost()) {

(function () {
    'use strict';

    function cleanText(value) {
        return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function getFreshdeskTicketURL() {
        const liveValue = String(
            document.getElementById('refund-freshdesk')?.value || ''
        ).trim();

        if (/^https:\/\/viewlift\.freshdesk\.com\/a\/tickets\/\d+$/i.test(liveValue)) {
            return liveValue;
        }

        try {
            const storedValue = String(GM_getValue('Freshdesk ID', '') || '').trim();

            return /^https:\/\/viewlift\.freshdesk\.com\/a\/tickets\/\d+$/i.test(storedValue)
                ? storedValue
                : '';
        } catch (error) {
            return '';
        }
    }

    function setControlledValue(element, value) {
        if (!element || !value || element.value === value) return false;

        const previousValue = element.value;
        const prototype = element.tagName.toLowerCase() === 'textarea'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

        if (descriptor && descriptor.set) descriptor.set.call(element, value);
        else element.value = value;

        if (element._valueTracker) element._valueTracker.setValue(previousValue);

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        return true;
    }

    function getCancelSubscriptionDialog() {
        return Array.from(document.querySelectorAll('[role="dialog"]')).find(dialog => {
            const text = cleanText(dialog.textContent).toLowerCase();
            return text.includes('cancel subscription');
        }) || null;
    }

    function getCommentsField(dialog) {
        return dialog.querySelector(
            'textarea[placeholder*="add comments" i], textarea[placeholder*="comment" i]'
        ) || null;
    }

    let lastFilledDialog = null;
    let debounceTimer = null;

    function fillCancelSubscriptionComments() {
        const dialog = getCancelSubscriptionDialog();

        if (!dialog) {
            lastFilledDialog = null;
            return;
        }

        if (dialog === lastFilledDialog) return;

        const field = getCommentsField(dialog);
        if (!field) return;

        const ticketURL = getFreshdeskTicketURL();
        if (!ticketURL) return;

        if (setControlledValue(field, ticketURL)) {
            lastFilledDialog = dialog;
            console.log('[Better CMS] Filled Cancel Subscription comments with the ticket link.');
        }
    }

    const observer = new MutationObserver(function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(fillCancelSubscriptionComments, 120);
    });

    function init() {
        if (!document.body) {
            window.setTimeout(init, 300);
            return;
        }

        observer.observe(document.body, { childList: true, subtree: true });
    }

    init();
})();

}

/* ============================================================
 * Feature 4: CMS Real Snapshot to Clipboard
 * Source: ViewLift CMS Real Snapshot to Clipboard 2.9
 * ============================================================ */


if (isCMSHost()) {

(function () {
    "use strict";

    if (window.__viewliftSnapshotToolsInstalled) {
        return;
    }

    window.__viewliftSnapshotToolsInstalled = true;

  const BUTTON_ID = "tm-viewlift-real-snapshot-button";
  const BADGE_ID = "tm-viewlift-payment-handler-badge";
  const WRAPPER_ID = "tm-viewlift-snapshot-tools";
  const STYLE_ID = "tm-viewlift-snapshot-tools-style";
  const PENDING_SNAPSHOT_KEY = BV_SNAPSHOT_KEY;

    const AUTO_OPEN_SUBSCRIPTION_PLANS = true;

    let autoOpenAttempted = false;
    let lastUrl = location.href;
    let routeTimer = null;
    let reusableCaptureStream = null;
    let reusableCaptureVideo = null;

    const GREEN_HANDLERS = [
        "roku",
        "stripe",
        "google",
        "google play",
        "play store"
    ];

    const RED_HANDLERS = [
        "itunes",
        "apple",
        "app store",
        "amazon"
    ];

    const HIDE_DURING_CAPTURE_SELECTORS = [
        `#${BUTTON_ID}`,
        `#${BADGE_ID}`,
        `#${WRAPPER_ID}`,
        "#refund-capture-panel"
    ];

    function isUserPage() {
        return /^\/users(?:\/|$)/i.test(location.pathname);
    }

    function isCustomerSupportSearchPage() {
        return /^\/users\/search\/?$/i.test(location.pathname);
    }

    function isSnapshotPage() {
        return isUserPage() || isCustomerSupportSearchPage();
    }

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            #${WRAPPER_ID} {
                display: inline-flex !important;
                align-items: center !important;
                gap: 8px !important;
                margin-left: 0 !important;
                margin-right: 2px !important;
            }

            #${WRAPPER_ID}[data-context="customer-support-search"] {
                margin-left: 8px !important;
                margin-right: 0 !important;
            }

            #${WRAPPER_ID}[data-context="customer-support-search"] #${BUTTON_ID} {
                width: 52px !important;
                height: 52px !important;
                box-shadow: none !important;
            }

            #${BUTTON_ID} {
                width: 34px !important;
                height: 34px !important;
                padding: 0 !important;
                font-size: 18px !important;
                font-family: Arial, sans-serif !important;
                background: linear-gradient(180deg, #9333ea 0%, #7c3aed 100%) !important;
                color: #ffffff !important;
                border: 1px solid #8b5cf6 !important;
                border-radius: 8px !important;
                cursor: pointer !important;
                box-shadow:
                    0 5px 14px rgba(124, 58, 237, 0.34),
                    inset 0 1px 0 rgba(255, 255, 255, 0.22) !important;
                line-height: 1 !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                vertical-align: middle !important;
                transform: translateY(0) !important;
                transition:
                    background 140ms ease,
                    box-shadow 140ms ease,
                    transform 140ms ease,
                    opacity 140ms ease !important;
            }

            #${BUTTON_ID}:hover {
                background: linear-gradient(180deg, #8b5cf6 0%, #6d28d9 100%) !important;
                box-shadow:
                    0 7px 18px rgba(124, 58, 237, 0.44),
                    inset 0 1px 0 rgba(255, 255, 255, 0.18) !important;
                transform: translateY(-1px) !important;
            }

            #${BUTTON_ID}:active {
                transform: translateY(0) !important;
                box-shadow:
                    0 2px 7px rgba(124, 58, 237, 0.28),
                    inset 0 2px 4px rgba(0, 0, 0, 0.12) !important;
            }

            #${BADGE_ID} {
                display: none !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 7px !important;
                width: fit-content !important;
                min-width: 86px !important;
                padding: 5px 11px !important;
                border-radius: 999px !important;
                font-size: 12px !important;
                font-weight: 800 !important;
                line-height: 1.2 !important;
                letter-spacing: 0.04em !important;
                text-transform: uppercase !important;
                box-sizing: border-box !important;
                white-space: nowrap !important;
                user-select: text !important;
                font-family: Arial, sans-serif !important;
            }

            #${BADGE_ID}::before {
                content: "" !important;
                width: 7px !important;
                height: 7px !important;
                border-radius: 999px !important;
                flex: 0 0 auto !important;
            }

            #${BADGE_ID}.tm-payment-handler-good {
                display: inline-flex !important;
                color: #065f46 !important;
                background: linear-gradient(180deg, #ecfdf5 0%, #d1fae5 100%) !important;
                border: 1px solid rgba(16, 185, 129, 0.55) !important;
                box-shadow:
                    0 2px 6px rgba(16, 185, 129, 0.16),
                    inset 0 1px 0 rgba(255, 255, 255, 0.70) !important;
            }

            #${BADGE_ID}.tm-payment-handler-good::before {
                background: #10b981 !important;
                box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.16) !important;
            }

            #${BADGE_ID}.tm-payment-handler-bad {
                display: inline-flex !important;
                color: #991b1b !important;
                background: linear-gradient(180deg, #fff1f2 0%, #fee2e2 100%) !important;
                border: 1px solid rgba(239, 68, 68, 0.55) !important;
                box-shadow:
                    0 2px 6px rgba(239, 68, 68, 0.14),
                    inset 0 1px 0 rgba(255, 255, 255, 0.70) !important;
            }

            #${BADGE_ID}.tm-payment-handler-bad::before {
                background: #ef4444 !important;
                box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.16) !important;
            }
        `;

        document.head.appendChild(style);
    }

    function removeToolsIfNotSnapshotPage() {
        if (isSnapshotPage()) return;

        const wrapper = document.getElementById(WRAPPER_ID);
        if (wrapper) wrapper.remove();
    }

    function isVisibleSnapshotElement(element) {
        if (!element) return false;

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
        );
    }

    function findCustomerSupportSearchButton() {
        const searchInput = Array.from(document.querySelectorAll("input"))
            .filter(isVisibleSnapshotElement)
            .sort((first, second) => {
                return second.getBoundingClientRect().width - first.getBoundingClientRect().width;
            })[0] || null;
        const candidates = Array.from(document.querySelectorAll("button, [role='button']"))
            .filter(element => {
                return (
                    isVisibleSnapshotElement(element) &&
                    cleanText(element.textContent).toLowerCase() === "search"
                );
            });

        if (!candidates.length) return null;
        if (!searchInput) return candidates[candidates.length - 1];

        const inputRect = searchInput.getBoundingClientRect();
        const score = element => {
            const rect = element.getBoundingClientRect();
            const verticalDistance = Math.abs(
                (rect.top + rect.height / 2) -
                (inputRect.top + inputRect.height / 2)
            );
            const rightSidePenalty = rect.left >= inputRect.left ? 0 : 1000;

            return verticalDistance * 10 + rightSidePenalty + Math.abs(rect.left - inputRect.right);
        };

        return candidates.slice().sort((first, second) => score(first) - score(second))[0];
    }

    function createOrMoveCustomerSupportSearchTools() {
        addStyles();

        const searchButton = findCustomerSupportSearchButton();
        if (!searchButton) return;

        let wrapper = document.getElementById(WRAPPER_ID);
        if (!wrapper) {
            wrapper = document.createElement("span");
            wrapper.id = WRAPPER_ID;
        }

        let button = document.getElementById(BUTTON_ID);
        if (!button) {
            button = document.createElement("button");
            button.id = BUTTON_ID;
            button.type = "button";
            button.textContent = "\uD83D\uDCF8";
            button.title = "Capture screenshot and copy it to the clipboard";
            button.setAttribute("aria-label", "Capture screenshot and copy it to the clipboard");
            button.addEventListener("click", captureRealTabSnapshot);
        }

        const badge = document.getElementById(BADGE_ID);
        if (badge) badge.remove();

        if (!wrapper.contains(button)) wrapper.appendChild(button);
        wrapper.dataset.context = "customer-support-search";

        if (wrapper.previousElementSibling !== searchButton) {
            searchButton.insertAdjacentElement("afterend", wrapper);
        }
    }

    function createOrMoveTools() {
        if (isCustomerSupportSearchPage()) {
            createOrMoveCustomerSupportSearchTools();
            return;
        }

        if (!isUserPage()) {
            removeToolsIfNotSnapshotPage();
            return;
        }

        addStyles();

        const clientNameHeader = findClientNameHeader();

        if (!clientNameHeader) {
            return;
        }

        let wrapper = document.getElementById(WRAPPER_ID);

        if (!wrapper) {
            wrapper = document.createElement("span");
            wrapper.id = WRAPPER_ID;
        }

        delete wrapper.dataset.context;

        let button = document.getElementById(BUTTON_ID);

        if (!button) {
            button = document.createElement("button");
            button.id = BUTTON_ID;
            button.type = "button";
            button.textContent = "📸";
            button.title = "Copy page snapshot";
            button.setAttribute("aria-label", "Copy page snapshot");
            button.addEventListener("click", captureRealTabSnapshot);
        }

        let badge = document.getElementById(BADGE_ID);

        if (!badge) {
            badge = document.createElement("span");
            badge.id = BADGE_ID;
            badge.title = "Payment Handler";
        }

        if (!wrapper.contains(badge)) wrapper.appendChild(badge);
        if (!wrapper.contains(button)) wrapper.appendChild(button);
        if (badge.nextElementSibling !== button) wrapper.insertBefore(badge, button);

        const nameContainer = clientNameHeader.parentElement;

        if (!nameContainer) {
            return;
        }

        nameContainer.style.display = "flex";
        nameContainer.style.alignItems = "center";
        nameContainer.style.gap = "8px";
        nameContainer.style.flexDirection = "row";

        if (wrapper.parentElement !== nameContainer || wrapper.nextElementSibling !== clientNameHeader) {
            clientNameHeader.insertAdjacentElement("beforebegin", wrapper);
        }

        updatePaymentHandlerBadge();

        if (AUTO_OPEN_SUBSCRIPTION_PLANS && isUserPage()) {
            autoOpenSubscriptionPlansIfNeeded();
        }
    }

    function updatePaymentHandlerBadge() {
        const badge = document.getElementById(BADGE_ID);
        if (!badge) return;

        let handler = findPaymentHandlerValue();

        if (handler) {
            saveStoredHandler(handler);
        } else {
            handler = getStoredHandler();
        }

        badge.classList.remove("tm-payment-handler-good", "tm-payment-handler-bad");

        if (!handler) {
            badge.textContent = "";
            badge.style.display = "none";
            return;
        }

        const normalized = normalizeHandler(handler);
        const isGreen = GREEN_HANDLERS.some(value => normalized.includes(value));
        const isRed = RED_HANDLERS.some(value => normalized.includes(value));

        if (!isGreen && !isRed) {
            badge.textContent = "";
            badge.style.display = "none";
            return;
        }

        badge.textContent = cleanHandlerDisplay(handler).toUpperCase();

        if (isGreen) {
            badge.classList.add("tm-payment-handler-good");
            return;
        }

        if (isRed) {
            badge.classList.add("tm-payment-handler-bad");
        }
    }

    function autoOpenSubscriptionPlansIfNeeded() {
        if (autoOpenAttempted) return;

        const currentHandler = findPaymentHandlerValue();

        if (currentHandler) {
            saveStoredHandler(currentHandler);
            updatePaymentHandlerBadge();
            return;
        }

        const storedHandler = getStoredHandler();

        if (storedHandler) {
            updatePaymentHandlerBadge();
            return;
        }

        const trigger = findSubscriptionPlansTrigger();

        if (!trigger) {
            return;
        }

        autoOpenAttempted = true;
        trigger.click();

        waitForPaymentHandler(12000).then(handler => {
            if (handler) {
                saveStoredHandler(handler);
                updatePaymentHandlerBadge();
            }
        });
    }

    function findSubscriptionPlansTrigger() {
        const elements = Array.from(document.querySelectorAll(
            "button, [role='button'], [role='tab'], a, [tabindex], div, span, p"
        ));

        for (const element of elements) {
            if (element.closest(`#${WRAPPER_ID}, #refund-capture-panel`)) continue;

            const text = cleanText(element.textContent);

            if (text !== "Subscription Plans") continue;

            const clickable = element.closest("button, [role='button'], [role='tab'], a, [tabindex]");

            if (clickable && !clickable.disabled) {
                return clickable;
            }

            return element;
        }

        return null;
    }

    function waitForPaymentHandler(timeoutMs) {
        return waitFor(findPaymentHandlerValue, { timeout: timeoutMs, pollMs: 300 })
            .then(result => result || "");
    }

    function findPaymentHandlerValue() {
        const labels = Array.from(document.querySelectorAll("p, span, div, label"))
            .filter(element => cleanText(element.textContent) === "Payment Handler");

        for (const label of labels) {
            const row = label.parentElement;
            if (!row) continue;

            const directCandidates = Array.from(row.children)
                .filter(element => element !== label)
                .map(element => cleanText(element.textContent))
                .filter(text => text && text !== "Payment Handler");

            for (const text of directCandidates) {
                if (isKnownHandler(text)) return cleanHandlerDisplay(text);
            }

            const nestedCandidates = Array.from(row.querySelectorAll("p, span"))
                .filter(element => element !== label)
                .map(element => cleanText(element.textContent))
                .filter(text => text && text !== "Payment Handler");

            for (const text of nestedCandidates) {
                if (isKnownHandler(text)) return cleanHandlerDisplay(text);
            }
        }

        return "";
    }

    function saveStoredHandler(handler) {
        try {
            localStorage.setItem(getHandlerStorageKey(), cleanHandlerDisplay(handler));
        } catch (error) {
            // Ignore storage errors.
        }
    }

    function getStoredHandler() {
        try {
            return localStorage.getItem(getHandlerStorageKey()) || "";
        } catch (error) {
            return "";
        }
    }

    function getHandlerStorageKey() {
        return `tm-viewlift-payment-handler:${location.pathname}`;
    }

    function cleanHandlerDisplay(value) {
        const normalized = normalizeHandler(value);

        if (normalized.includes("roku")) return "Roku";
        if (normalized.includes("stripe")) return "Stripe";
        if (normalized.includes("google") || normalized.includes("play store")) return "Google Play";
        if (normalized.includes("itunes")) return "iTunes";
        if (normalized.includes("apple") || normalized.includes("app store")) return "iTunes";
        if (normalized.includes("amazon")) return "Amazon";

        return cleanText(value);
    }

    function isKnownHandler(value) {
        const normalized = normalizeHandler(value);

        return GREEN_HANDLERS.some(handler => normalized.includes(handler)) ||
               RED_HANDLERS.some(handler => normalized.includes(handler));
    }

    function findClientNameHeader() {
        const pageHeader = Array.from(document.querySelectorAll("h3.flex.gap-3"))
            .find(element => !element.closest("[role='dialog'], #refund-capture-panel"));

        if (pageHeader) return pageHeader;

        const headerContainer = document.querySelector("#header");

        if (headerContainer) {
            const h4 = headerContainer.querySelector("h4");
            if (h4) return h4;
        }

        return document.querySelector("h4");
    }

    async function captureRealTabSnapshot() {
        const button = document.getElementById(BUTTON_ID);
        if (!button) return;

        const originalText = "📸";
        let restoreHiddenElements = null;
        let streamCreated = false;

        try {
            updatePaymentHandlerBadge();

            button.disabled = true;
            button.style.opacity = "0.75";

            restoreHiddenElements = hideElementsForCapture();

            await nextFrame();
            await nextFrame();
            await delay(150);

            if (typeof window.html2canvas !== "function") {
                throw new Error("DOM capture library is unavailable. Reload the CMS tab and try again.");
            }

            const canvas = await window.html2canvas(document.documentElement, {
                backgroundColor: "#ffffff",
                useCORS: true,
                allowTaint: false,
                scale: Math.min(window.devicePixelRatio || 1, 2),
                x: window.scrollX,
                y: window.scrollY,
                width: document.documentElement.clientWidth,
                height: document.documentElement.clientHeight,
                windowWidth: document.documentElement.clientWidth,
                windowHeight: document.documentElement.clientHeight,
                scrollX: -window.scrollX,
                scrollY: -window.scrollY,
                logging: false,
                ignoreElements: element => Boolean(
                    element.closest && element.closest(`#${BUTTON_ID}, #${BADGE_ID}, #${WRAPPER_ID}, #refund-capture-panel`)
                )
            });

            const blob = await canvasToBlob(canvas);

            const snapshotDataUrl = await blobToDataUrl(blob);
            const ticketUrl = String(GM_getValue('Refund Active Ticket', '') || '').trim() ||
                String(GM_getValue('Freshdesk ID', '') || '').trim();

            try {
                // A small queue, not a single value: requesting two snapshots
                // (for the same ticket or different ones) within the consumer's
                // poll window used to silently overwrite the first one.
                const existing = GM_getValue(PENDING_SNAPSHOT_KEY, null);
                const queue = Array.isArray(existing) ? existing : (existing ? [existing] : []);

                queue.push({
                    dataUrl: snapshotDataUrl,
                    ticketUrl,
                    createdAt: Date.now()
                });

                GM_setValue(PENDING_SNAPSHOT_KEY, queue.slice(-5));
            } catch (storageError) {
                console.warn("Could not queue snapshot for Freshdesk note.", storageError);
            }

            await navigator.clipboard.write([
                new ClipboardItem({
                    "image/png": blob
                })
            ]);

            restoreHiddenElements();
            restoreHiddenElements = null;

            button.disabled = false;
            button.style.opacity = "1";
            button.textContent = "✅";

            setTimeout(() => {
                button.textContent = originalText;
            }, 1200);

        } catch (error) {
            if (restoreHiddenElements) {
                restoreHiddenElements();
            }

            console.error("Real snapshot failed:", error);

            button.disabled = false;
            button.style.opacity = "1";
            button.textContent = "⚠️";

            alert("DOM snapshot failed. Reload the CMS tab and try again.");

            setTimeout(() => {
                button.textContent = originalText;
            }, 1200);
        }
    }

    function hideElementsForCapture() {
        const changedElements = [];

        for (const selector of HIDE_DURING_CAPTURE_SELECTORS) {
            document.querySelectorAll(selector).forEach(element => {
                if (changedElements.some(item => item.element === element)) {
                    return;
                }

                changedElements.push({
                    element,
                    visibility: element.style.visibility,
                    pointerEvents: element.style.pointerEvents
                });

                element.style.visibility = "hidden";
                element.style.pointerEvents = "none";
            });
        }

        return function restoreHiddenElements() {
            for (const item of changedElements) {
                item.element.style.visibility = item.visibility;
                item.element.style.pointerEvents = item.pointerEvents;
            }
        };
    }

    function handleRouteChange() {
        if (location.href === lastUrl) {
            return;
        }

        lastUrl = location.href;
        autoOpenAttempted = false;

        const badge = document.getElementById(BADGE_ID);
        if (badge) {
            badge.textContent = "";
            badge.classList.remove("tm-payment-handler-good", "tm-payment-handler-bad");
            badge.style.display = "none";
        }

        clearTimeout(routeTimer);

        routeTimer = setTimeout(() => {
            runStartupPasses();
        }, 250);
    }

    function installRouteWatcher() {
        onRouteChange(handleRouteChange);
    }

    async function runStartupPasses() {
        await waitFor(() => {
            createOrMoveTools();
            return !isSnapshotPage() || document.getElementById(WRAPPER_ID);
        }, { timeout: 3500, pollMs: 50 });
    }

    function canvasToBlob(canvas) {
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error("Could not create PNG blob."));
                }
            }, "image/png");
        });
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Could not read PNG blob.'));
            reader.readAsDataURL(blob);
        });
    }

    function stopStream(stream) {
        stream.getTracks().forEach(track => track.stop());
    }

    window.addEventListener("beforeunload", () => {
        if (reusableCaptureStream) {
            stopStream(reusableCaptureStream);
            reusableCaptureStream = null;
            reusableCaptureVideo = null;
        }
    });

    function nextFrame() {
        return new Promise(resolve => requestAnimationFrame(resolve));
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function normalizeHandler(value) {
        return cleanText(value)
            .toLowerCase()
            .replace(/\s+/g, " ");
    }

    function cleanText(value) {
        return String(value || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function installObserver() {
        let timer = null;

        onRouteChange(() => {
            if (document.visibilityState === 'hidden') return;
            const wrapper = document.getElementById(WRAPPER_ID);
            if (location.href === lastUrl && wrapper && wrapper.isConnected) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
                handleRouteChange();
                createOrMoveTools();
                updatePaymentHandlerBadge();
            }, 500);
        });
    }

    function init() {
        if (!document.body) {
            setTimeout(init, 300);
            return;
        }

        addStyles();
        installRouteWatcher();
        installObserver();
        runStartupPasses();

        setInterval(() => {
            if (document.visibilityState === 'hidden') return;

            if (AUTO_OPEN_SUBSCRIPTION_PLANS && isUserPage()) {
                autoOpenSubscriptionPlansIfNeeded();
            }
        }, 8000);
    }

    init();
})();

}
  })();

  (function () {
/* ============================================================
 * Feature 1: Freshdesk Auto Bold Support Text
 * ============================================================ */

if (location.hostname === 'viewlift.freshdesk.com' && location.pathname.startsWith('/a/tickets/')) {
(function () {
  "use strict";

  const processing = new WeakSet();
  const pastedEditors = new WeakMap();
  const PASTE_PROTECTION_MS = 250;
  const EDITOR_FONT_STYLE_ID = 'better-freshdesk-editor-font-normalizer-style';
  const CANNED_RESPONSE_LOCK_ATTR = BV_CANNED_RESPONSE_LOCK_ATTR;
  const CANNED_RESPONSE_GLOBAL_KEY = BV_CANNED_RESPONSE_GLOBAL_KEY;
  const CANNED_RESPONSE_PROTECTION_MS = 15000;

  function getEditor(element) {
    if (!element || !element.closest) return null;
    return element.closest('[contenteditable="true"]');
  }

  function markCannedResponseMode(editor) {
    if (editor && editor.setAttribute) {
      editor.setAttribute(CANNED_RESPONSE_LOCK_ATTR, 'yes');

      window.setTimeout(function () {
        if (Date.now() >= Number(window[CANNED_RESPONSE_GLOBAL_KEY] || 0)) {
          editor.removeAttribute(CANNED_RESPONSE_LOCK_ATTR);
        }
      }, CANNED_RESPONSE_PROTECTION_MS + 250);
    }

    window[CANNED_RESPONSE_GLOBAL_KEY] = Date.now() + CANNED_RESPONSE_PROTECTION_MS;

    console.log('[Freshdesk Canned Response] Canned response mode detected, skipping editor rewrites');
  }

  function isCannedResponseModeActive(editor) {
    const globalUntil = Number(window[CANNED_RESPONSE_GLOBAL_KEY] || 0);

    return Boolean(
      (editor && editor.getAttribute && editor.getAttribute(CANNED_RESPONSE_LOCK_ATTR) === 'yes') ||
      Date.now() < globalUntil
    );
  }

  function getLastNonEmptyLine(text) {
    const lines = String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    return lines.length ? lines[lines.length - 1] : '';
  }

  function lastLineIsCannedCommand(editor) {
    if (!editor) return false;

    const lastLine = getLastNonEmptyLine(editor.innerText || editor.textContent || '');

    return /^\/c?$/i.test(lastLine);
  }

  function slashKeyLooksLikeCommandContext(editor) {
    if (!editor) return false;

    const text = String(editor.innerText || editor.textContent || '');

    return text.trim() === '' || /[\s\n]$/.test(text);
  }

  function handleCannedCommandKeydown(event) {
    const editor = getEditor(event.target);

    if (!editor) return;

    if (event.key === '/' && slashKeyLooksLikeCommandContext(editor)) {
      markCannedResponseMode(editor);
    }
  }

  function handleCannedCommandInput(event) {
    const editor = getEditor(event.target);

    if (!editor) return;

    if (lastLineIsCannedCommand(editor)) {
      markCannedResponseMode(editor);
    }
  }

  function addEditorFontNormalizerStyles() {
    if (document.getElementById(EDITOR_FONT_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = EDITOR_FONT_STYLE_ID;
    style.textContent = `
      .fr-element.fr-view[contenteditable="true"],
      .fr-element[contenteditable="true"],
      [contenteditable="true"][role="textbox"] {
        font-family: inherit !important;
      }

      .fr-element.fr-view[contenteditable="true"] *,
      .fr-element[contenteditable="true"] *,
      [contenteditable="true"][role="textbox"] * {
        font-family: inherit !important;
        font-size: inherit !important;
        line-height: inherit !important;
      }

      .fr-element.fr-view[contenteditable="true"] p,
      .fr-element.fr-view[contenteditable="true"] div,
      .fr-element[contenteditable="true"] p,
      .fr-element[contenteditable="true"] div,
      [contenteditable="true"][role="textbox"] p,
      [contenteditable="true"][role="textbox"] div {
        margin-top: 0 !important;
        margin-bottom: 0 !important;
      }
    `;

    document.head.appendChild(style);
  }

  function markEditorAsRecentlyPasted(editor) {
    if (!editor) return;
    pastedEditors.set(editor, Date.now() + PASTE_PROTECTION_MS);
  }

  function isRecentlyPasted(editor) {
    const protectedUntil = pastedEditors.get(editor);
    return Boolean(protectedUntil && Date.now() < protectedUntil);
  }

  function unwrapFontTags(root) {
    if (!root || !root.querySelectorAll) return;

    root.querySelectorAll('font').forEach(function (fontNode) {
      const span = document.createElement('span');

      while (fontNode.firstChild) {
        span.appendChild(fontNode.firstChild);
      }

      fontNode.parentNode.replaceChild(span, fontNode);
    });
  }

  function removeInlineFontFormatting(root) {
    if (!root || !root.querySelectorAll) return;

    root.querySelectorAll('[style]').forEach(function (element) {
      element.style.removeProperty('font-family');
      element.style.removeProperty('font-size');
      element.style.removeProperty('line-height');
      element.style.removeProperty('margin');
      element.style.removeProperty('margin-top');
      element.style.removeProperty('margin-bottom');
      element.style.removeProperty('padding-top');
      element.style.removeProperty('padding-bottom');
      element.style.removeProperty('mso-line-height-rule');
      element.style.removeProperty('mso-fareast-font-family');
      element.style.removeProperty('mso-bidi-font-family');

      if (!element.getAttribute('style') || !element.getAttribute('style').trim()) {
        element.removeAttribute('style');
      }
    });
  }

  function cleanText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isEmptyBlock(element) {
    if (!element || element.nodeType !== 1) return false;

    return cleanText(element.innerText || element.textContent || '') === '';
  }

  function isGreetingLine(text) {
    return /^(hello|hi|dear|hola|buenos dÃ­as|buenas tardes|good morning|good afternoon)\b.*,\s*$/i.test(cleanText(text));
  }

  function normalizeGreetingSpacing(editor) {
    if (!editor || !editor.children) return;

    const children = Array.from(editor.children);

    for (const child of children) {
      if (!isGreetingLine(child.innerText || child.textContent || '')) continue;

      let next = child.nextElementSibling;
      let keptOneBlankLine = false;

      while (next && isEmptyBlock(next)) {
        const current = next;
        next = current.nextElementSibling;

        if (!keptOneBlankLine) {
          keptOneBlankLine = true;
          continue;
        }

        current.remove();
      }

      return;
    }
  }

  function getNextNonEmptyTextNode(root, textNode) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current;
    let found = false;

    while ((current = walker.nextNode())) {
      if (current === textNode) {
        found = true;
        continue;
      }

      if (found && cleanText(current.nodeValue)) {
        return current;
      }
    }

    return null;
  }

  function boldStandaloneTheBeforeSignature(editor) {
    if (!editor) return;

    const walker = document.createTreeWalker(
      editor,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
          if (node.parentElement && node.parentElement.closest('strong, b, code, pre, script, style')) {
            return NodeFilter.FILTER_REJECT;
          }

          return cleanText(node.nodeValue) === 'The'
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    const textNodes = [];
    let node;

    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    textNodes.forEach(function (textNode) {
      const nextTextNode = getNextNonEmptyTextNode(editor, textNode);

      if (!nextTextNode) return;

      if (/^Technical Support Team\b/.test(cleanText(nextTextNode.nodeValue))) {
        textNode.parentNode.replaceChild(makeBoldNode(textNode.nodeValue), textNode);
      }
    });
  }

  function normalizeEditorFormatting(editor) {
    if (!editor) return;

    addEditorFontNormalizerStyles();
    unwrapFontTags(editor);
    removeInlineFontFormatting(editor);
    normalizeGreetingSpacing(editor);
    boldStandaloneTheBeforeSignature(editor);
  }

  function shouldSkipEditor(editor) {
    if (!editor) return true;

    if (isCannedResponseModeActive(editor)) {
      return true;
    }

    if (isRecentlyPasted(editor)) {
      return true;
    }

    return false;
  }

  function shouldIgnoreNode(node) {
    if (!node || !node.parentElement) return true;

    return Boolean(
      node.parentElement.closest("strong, b, code, pre, script, style")
    );
  }

  function makeBoldNode(text) {
    const strong = document.createElement("strong");
    strong.textContent = text;
    return strong;
  }

  function buildBoldPattern() {
    return /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})|(The Technical Support Team)|(Technical Support Team)|(Regards,)/g;
  }

  function replaceLongDashCharacters(text) {
    return text.replace(/\s*[\u2013\u2014]\s*/g, ", ");
  }

  function replaceMatchesInTextNode(textNode, boldPattern) {
    let text = textNode.nodeValue;

    if (!text) return false;

    const originalText = text;

    text = replaceLongDashCharacters(text);

    boldPattern.lastIndex = 0;

    const hasBoldMatch = boldPattern.test(text);

    if (!hasBoldMatch && text === originalText) {
      return false;
    }

    boldPattern.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = boldPattern.exec(text)) !== null) {
      const before = text.slice(lastIndex, match.index);

      if (before) {
        fragment.appendChild(document.createTextNode(before));
      }

      fragment.appendChild(makeBoldNode(match[0]));

      lastIndex = match.index + match[0].length;
    }

    const after = text.slice(lastIndex);

    if (after) {
      fragment.appendChild(document.createTextNode(after));
    }

    textNode.parentNode.replaceChild(fragment, textNode);
    return true;
  }

  function processEditor(editor) {
    if (!editor || processing.has(editor)) return;
    if (shouldSkipEditor(editor)) return;

    normalizeEditorFormatting(editor);

    processing.add(editor);

    try {
      const boldPattern = buildBoldPattern();

      const walker = document.createTreeWalker(
        editor,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function (node) {
            if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
            if (shouldIgnoreNode(node)) return NodeFilter.FILTER_REJECT;

            const lowerText = node.nodeValue.toLowerCase();

            if (
              /[\u2013\u2014]/.test(node.nodeValue) ||
              /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(node.nodeValue) ||
              lowerText.includes("technical support team") ||
              lowerText.includes("regards,")
            ) {
              return NodeFilter.FILTER_ACCEPT;
            }

            return NodeFilter.FILTER_REJECT;
          }
        }
      );

      const textNodes = [];
      let currentNode;

      while ((currentNode = walker.nextNode())) {
        textNodes.push(currentNode);
      }

      textNodes.forEach(function (textNode) {
        replaceMatchesInTextNode(textNode, boldPattern);
      });

      normalizeGreetingSpacing(editor);
      boldStandaloneTheBeforeSignature(editor);
    } finally {
      processing.delete(editor);
    }
  }

  function handlePaste(event) {
    const editor = getEditor(event.target);

    if (!editor) return;

    markEditorAsRecentlyPasted(editor);

    window.setTimeout(function () {
      normalizeEditorFormatting(editor);
      processEditor(editor);
    }, PASTE_PROTECTION_MS + 50);
  }

  function handleChange(event) {
    const editor = getEditor(event.target);

    if (!editor) return;

    handleCannedCommandInput(event);

    window.setTimeout(function () {
      processEditor(editor);
    }, 50);
  }

  function scanEditors() {
    addEditorFontNormalizerStyles();

    document.querySelectorAll('[contenteditable="true"]').forEach(function (editor) {
      if (isCannedResponseModeActive(editor)) return;

      normalizeEditorFormatting(editor);
      processEditor(editor);
    });
  }

  scanEditors();

  document.addEventListener("keydown", handleCannedCommandKeydown, true);
  document.addEventListener("paste", handlePaste, true);
  document.addEventListener("input", handleChange, true);
})();

/* ============================================================
 * Feature 8: Unified ticket action bar
 * Keeps the high-frequency case controls together and identifies the client.
 * ============================================================ */

(function () {
  'use strict';

  if (location.hostname !== 'viewlift.freshdesk.com') return;
  if (!/^\/a\/tickets\/\d+(?:\/|$)/i.test(location.pathname)) return;

  const TOOLBAR_ID = 'better-freshdesk-unified-toolbar';
  const BRAND_ID = 'better-freshdesk-case-brand';
  const EMAIL_ID = 'better-freshdesk-action-email';
  const REFUND_TOGGLE_ID = 'better-freshdesk-refund-toggle';
  const CMS_SESSION_DOT_ID = 'better-freshdesk-cms-session-dot';
  const STYLE_ID = 'better-freshdesk-unified-toolbar-style';

  const BRAND_RULES = [
    { label: 'LIV', patterns: [/liv\s*golf/i, /livgolf/i, /livgolfplus\.com/i] },
    { label: 'DIRT', patterns: [/dirtvision/i, /dirt\s*vision/i, /dirtvision\.com/i] },
    { label: 'ALTITUDE', patterns: [/altitude/i, /altitudeplus/i] },
    { label: 'MSN', patterns: [/monumental\s*sports/i, /msn\b/i, /monumentalsportsnetwork/i] },
    { label: 'SCHN', patterns: [/space\s*city/i, /spacecityhn/i, /sc-appsupport/i] },
    { label: 'FOX', patterns: [/fox\s*sports/i, /foxsports/i, /foxsports\.com/i] }
  ];

  function cleanText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isVisible(element) {
    if (!element || element.nodeType !== 1) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${TOOLBAR_ID} {
        position: relative !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 7px !important;
        margin-right: 8px !important;
        vertical-align: middle !important;
        z-index: 30 !important;
      }

      #${CMS_SESSION_DOT_ID} {
        display: inline-flex !important;
        width: 10px !important;
        height: 10px !important;
        margin-right: 4px !important;
        border-radius: 999px !important;
        background: #9ca3af !important;
        box-shadow: 0 0 0 3px rgba(156, 163, 175, .16) !important;
        flex: 0 0 auto !important;
        cursor: default !important;
        transition: background 200ms ease, box-shadow 200ms ease !important;
      }

      #${CMS_SESSION_DOT_ID}[data-status="alive"] {
        background: #16a34a !important;
        box-shadow: 0 0 0 3px rgba(22, 163, 74, .18) !important;
      }

      #${CMS_SESSION_DOT_ID}[data-status="needs-login"] {
        background: #dc2626 !important;
        box-shadow: 0 0 0 3px rgba(220, 38, 38, .18) !important;
      }

      #${CMS_SESSION_DOT_ID}[data-status="error"] {
        background: #d97706 !important;
        box-shadow: 0 0 0 3px rgba(217, 119, 6, .18) !important;
      }

      #${CMS_SESSION_DOT_ID}[data-status="checking"] {
        background: #60a5fa !important;
        box-shadow: 0 0 0 3px rgba(96, 165, 250, .22) !important;
        animation: bv-dot-pulse 900ms ease-in-out infinite !important;
      }

      @keyframes bv-dot-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: .35; }
      }

      #${REFUND_TOGGLE_ID} {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 32px !important;
        height: 32px !important;
        margin-right: 6px !important;
        padding: 0 !important;
        border: 1px solid #0e4d8c !important;
        border-radius: 999px !important;
        background: linear-gradient(180deg, #2f7fe0 0%, #0b5cab 100%) !important;
        color: #ffffff !important;
        font-size: 15px !important;
        font-weight: 800 !important;
        cursor: pointer !important;
        box-shadow: 0 4px 12px rgba(11, 92, 171, .32), inset 0 1px 0 rgba(255, 255, 255, .2) !important;
        transition: background 140ms ease, box-shadow 140ms ease, transform 140ms ease !important;
      }

      #${REFUND_TOGGLE_ID}:hover {
        background: linear-gradient(180deg, #3d8bea 0%, #0e4d8c 100%) !important;
        box-shadow: 0 6px 16px rgba(11, 92, 171, .4), inset 0 1px 0 rgba(255, 255, 255, .18) !important;
        transform: translateY(-1px) !important;
      }

      #${REFUND_TOGGLE_ID}:active {
        transform: translateY(0) !important;
        box-shadow: 0 2px 6px rgba(11, 92, 171, .3), inset 0 2px 4px rgba(0, 0, 0, .14) !important;
      }

      #${BRAND_ID} {
        display: inline-flex !important;
        align-items: center !important;
        height: 32px !important;
        box-sizing: border-box !important;
        white-space: nowrap !important;
        border: 1px solid #cbd5e1 !important;
        border-radius: 999px !important;
        background: linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%) !important;
        color: #334155 !important;
        font: 600 12px/1.2 Arial, sans-serif !important;
        box-shadow: 0 1px 2px rgba(15, 23, 42, .06) !important;
        transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease !important;
      }

      #${BRAND_ID} {
        padding: 0 12px !important;
        letter-spacing: .05em !important;
        font-weight: 800 !important;
      }

      #${BRAND_ID}[data-brand="LIV"] { color: #166534 !important; background: linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%) !important; border-color: #86efac !important; box-shadow: 0 1px 3px rgba(22, 101, 52, .16) !important; }
      #${BRAND_ID}[data-brand="DIRT"] { color: #92400e !important; background: linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%) !important; border-color: #fcd34d !important; box-shadow: 0 1px 3px rgba(146, 64, 14, .16) !important; }
      #${BRAND_ID}[data-brand="ALTITUDE"] { color: #1e40af !important; background: linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%) !important; border-color: #93c5fd !important; box-shadow: 0 1px 3px rgba(30, 64, 175, .16) !important; }
      #${BRAND_ID}[data-brand="MSN"] { color: #581c87 !important; background: linear-gradient(180deg, #faf5ff 0%, #f3e8ff 100%) !important; border-color: #d8b4fe !important; box-shadow: 0 1px 3px rgba(88, 28, 135, .16) !important; }
      #${BRAND_ID}[data-brand="SCHN"] { color: #9f1239 !important; background: linear-gradient(180deg, #fff1f2 0%, #ffe4e6 100%) !important; border-color: #fda4af !important; box-shadow: 0 1px 3px rgba(159, 18, 57, .16) !important; }
      #${BRAND_ID}[data-brand="FOX"] { color: #9a3412 !important; background: linear-gradient(180deg, #fff7ed 0%, #ffedd5 100%) !important; border-color: #fdba74 !important; box-shadow: 0 1px 3px rgba(154, 52, 18, .16) !important; }

      #${TOOLBAR_ID} #refund-capture-panel.better-freshdesk-inline-panel {
        position: absolute !important;
        top: calc(100% + 8px) !important;
        left: 0 !important;
        right: auto !important;
        bottom: auto !important;
        width: 372px !important;
        max-width: min(372px, calc(100vw - 24px)) !important;
        z-index: 1000000 !important;
        transform-origin: top left !important;
      }

      #${TOOLBAR_ID} #refund-capture-panel.better-freshdesk-inline-panel[data-better-open="no"] { display: none !important; }
      #${TOOLBAR_ID} #refund-capture-panel.better-freshdesk-inline-panel[data-better-open="yes"] { display: block !important; }

      #better-freshdesk-requester-email, #better-freshdesk-copy-feedback { display: none !important; }
      section#mainactionbar [data-test-id="add-note"],
      section#mainactionbar [data-test-actions="forward"],
      section#mainactionbar [data-test-actions="close"],
      section#mainactionbar [data-test-id="top-navigation-servicetask"] { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  let actionBarFallbackSince = 0;

  function getActionBar() {
    return document.querySelector('section#mainactionbar .reply-bar-top') ||
      document.querySelector('section#mainactionbar .page-actions__left') ||
      document.querySelector('section#mainactionbar button[data-test-email-action="reply"]')?.parentElement ||
      null;
  }

  // Only settle for the bare section (a worse flex container, visually
  // different from the real action bar) after giving Freshdesk's own
  // controls a few seconds to render. Falling back immediately causes the
  // toolbar to render once in the wrong spot and then visibly jump into the
  // right one the moment the real container shows up.
  function getActionBarWithFallback() {
    const actionBar = getActionBar();
    if (actionBar) {
      actionBarFallbackSince = 0;
      return actionBar;
    }

    if (!actionBarFallbackSince) actionBarFallbackSince = Date.now();
    if (Date.now() - actionBarFallbackSince < 4000) return null;

    return document.querySelector('section#mainactionbar');
  }

  function getContextText() {
    const selectedGroups = Array.from(document.querySelectorAll('.ember-power-select-selected-item'))
      .map(element => element.textContent || '').join(' ');
    const mailtos = Array.from(document.querySelectorAll('a[href^="mailto:" i]'))
      .map(element => element.getAttribute('href') || '').join(' ');
    const ticketContext = Array.from(document.querySelectorAll(
      '[data-test-id*="group" i], [data-testid*="group" i], [data-test-id*="email" i], [data-testid*="email" i], .ticket-properties-wrapper'
    )).slice(0, 40).map(element => element.textContent || '').join(' ');

    return [document.title, selectedGroups, mailtos, ticketContext].join('\n');
  }

  function detectBrand() {
    const context = getContextText();
    return BRAND_RULES.find(rule => rule.patterns.some(pattern => pattern.test(context))) || null;
  }

  function normalizeCustomerEmail(value) {
    const match = cleanText(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (!match) return '';

    const email = match[0].toLowerCase();
    if (/^(?:no-?reply|do-?not-?reply)@/i.test(email)) return '';
    return email;
  }

  let cachedTicketPath = '';
  let cachedEmail = '';

  // No longer shown as a visible toolbar pill (removed per request), but
  // Feature 5 (quick-copy emails mentioned in ticket messages) still reads
  // this element's dataset.email to know which email is already "known" so
  // it doesn't offer a redundant copy-chip for it - kept as a hidden,
  // off-toolbar data holder rather than deleting the cross-feature link.
  function getEmail() {
    if (cachedTicketPath !== location.pathname) {
      cachedTicketPath = location.pathname;
      cachedEmail = '';
    }

    if (cachedEmail) return cachedEmail;

    const links = Array.from(document.querySelectorAll('a[href^="mailto:" i]'));
    for (const link of links) {
      const candidate = normalizeCustomerEmail(link.getAttribute('href') || '');
      if (candidate) {
        cachedEmail = candidate;
        return cachedEmail;
      }
    }

    const candidate = (getContextText().match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])
      .map(normalizeCustomerEmail)
      .find(Boolean);
    if (candidate) cachedEmail = candidate;

    return cachedEmail;
  }

  function updateHiddenEmailHolder() {
    let holder = document.getElementById(EMAIL_ID);
    if (!holder) {
      holder = document.createElement('span');
      holder.id = EMAIL_ID;
      holder.style.display = 'none';
      document.body.appendChild(holder);
    }
    const customerEmail = getEmail();
    if (holder.dataset.email !== customerEmail) holder.dataset.email = customerEmail;
  }

  function makeButton(id, text, title) {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.textContent = text;
    button.title = title;
    return button;
  }

  // Gives the anti-logout keep-alive from Feature 1b2 a visible result -
  // it was working silently before, with no way to confirm it without
  // manually digging through GM storage.
  function updateCmsSessionDot(dot) {
    let state = null;

    try {
      state = GM_getValue(BV_CMS_KEEP_ALIVE_STATUS_KEY, null);
    } catch (error) { /* storage unavailable */ }

    if (!state || !state.checkedAt) {
      dot.dataset.status = '';
      dot.title = 'CMS session: not checked yet. Click to check now.';
      return;
    }

    const minutesAgo = Math.round((Date.now() - state.checkedAt) / 60000);
    const staleness = minutesAgo <= 1 ? 'just now' : `${minutesAgo} min ago`;

    if (state.overall === 'needs-login') {
      dot.dataset.status = 'needs-login';
      dot.title = `CMS session needs login/OTP (checked ${staleness}). Click to check again.`;
    } else if (state.overall === 'error') {
      dot.dataset.status = 'error';
      dot.title = `Could not reach CMS to check the session (checked ${staleness}). Click to retry.`;
    } else {
      dot.dataset.status = 'alive';
      dot.title = `CMS session looks alive (checked ${staleness}). Click to check now.`;
    }
  }

  function toggleRefundPanel() {
    const panel = document.getElementById('refund-capture-panel');
    if (!panel) return;

    const open = panel.dataset.betterOpen === 'yes';
    panel.dataset.betterOpen = open ? 'no' : 'yes';
    panel.classList.toggle('is-minimized', open);

    if (!open) {
      const refresh = document.getElementById('refund-refresh');
      if (refresh) refresh.click();
    }
  }

  function mountRefundPanel(toolbar) {
    const panel = document.getElementById('refund-capture-panel');
    if (!panel) return;

    panel.classList.add('better-freshdesk-inline-panel');
    if (!panel.dataset.betterOpen) panel.dataset.betterOpen = 'no';
    if (panel.parentElement !== toolbar) toolbar.appendChild(panel);

    const minimize = panel.querySelector('#refund-minimize');
    if (minimize && minimize.dataset.betterBound !== 'yes') {
      minimize.dataset.betterBound = 'yes';
      minimize.addEventListener('click', () => {
        panel.dataset.betterOpen = 'no';
      }, true);
    }
  }

  function installToolbar() {
    addStyles();
    const actionBar = getActionBarWithFallback();
    if (!actionBar) return;

    let toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = TOOLBAR_ID;
      const reply = actionBar.querySelector('button[data-test-email-action="reply"]');
      actionBar.insertBefore(toolbar, reply || actionBar.firstElementChild || null);
    }

    let brand = document.getElementById(BRAND_ID);
    if (!brand) {
      brand = document.createElement('span');
      brand.id = BRAND_ID;
      brand.setAttribute('aria-label', 'Case client');
      toolbar.appendChild(brand);
    }

    const detectedBrand = detectBrand();
    const brandLabel = detectedBrand ? detectedBrand.label : 'CASE';
    if (brand.textContent !== brandLabel) brand.textContent = brandLabel;
    if (brand.dataset.brand !== brandLabel) brand.dataset.brand = brandLabel;
    const brandTitle = detectedBrand ? `Case client: ${detectedBrand.label}` : 'Case client not detected';
    if (brand.title !== brandTitle) brand.title = brandTitle;

    updateHiddenEmailHolder();

    const cms = document.getElementById('viewlift-open-cms-header-button');
    const agent = document.getElementById('better-freshdesk-my-agent-button');

    let refundToggle = document.getElementById(REFUND_TOGGLE_ID);
    if (!refundToggle) {
      refundToggle = makeButton(REFUND_TOGGLE_ID, '$', 'Open refund capture panel');
      refundToggle.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        toggleRefundPanel();
      });
    }

    let cmsSessionDot = document.getElementById(CMS_SESSION_DOT_ID);
    if (!cmsSessionDot) {
      cmsSessionDot = document.createElement('span');
      cmsSessionDot.id = CMS_SESSION_DOT_ID;
      cmsSessionDot.setAttribute('aria-label', 'CMS session status');
      cmsSessionDot.style.cursor = 'pointer';
      cmsSessionDot.addEventListener('click', () => {
        if (typeof window.__bvPingCMSHostsNow !== 'function') return;

        cmsSessionDot.dataset.status = 'checking';
        cmsSessionDot.title = 'Checking CMS session...';
        window.__bvPingCMSHostsNow(() => updateCmsSessionDot(cmsSessionDot));
      });
    }
    updateCmsSessionDot(cmsSessionDot);

    // These legacy toolbar controls are intentionally removed. Delete any
    // copies left behind by an older Better ViewLift version as well.
    document.getElementById('better-freshdesk-next-case')?.remove();
    document.getElementById('better-freshdesk-refund-launcher')?.remove();
    document.getElementById('better-freshdesk-generate-toggle')?.remove();
    document.getElementById('better-freshdesk-generate-panel')?.remove();

    const orderedControls = [brand, cms, cmsSessionDot, agent, refundToggle].filter(Boolean);
    const currentControls = Array.from(toolbar.children).filter(element => orderedControls.includes(element));
    const orderIsCorrect = orderedControls.length === currentControls.length &&
      orderedControls.every((element, index) => currentControls[index] === element);

    if (!orderIsCorrect) {
      orderedControls.forEach(element => toolbar.appendChild(element));
    }

    mountRefundPanel(toolbar);
  }

  // Other features (CMS header button, Set Agent) live in separate IIFEs and
  // insert their own button as a sibling near the action bar before this
  // toolbar's own scheduled pass gets a chance to sweep it into place - that
  // gap is what shows up as a button briefly appearing loose/out of order
  // before visibly jumping into the toolbar. Exposing a direct reconciliation
  // hook lets them close that gap themselves instead of waiting for it.
  window.__bvReconcileFreshdeskToolbar = installToolbar;

  function init() {
    if (!document.body) {
      window.setTimeout(init, 250);
      return;
    }

    installToolbar();

    let timer = null;
    const scheduleInstall = () => {
      if (document.visibilityState === 'hidden') return;
      const toolbar = document.getElementById(TOOLBAR_ID);
      // Re-verify the toolbar is still inside the CURRENT action bar, not just
      // "somewhere in the document" - Ember can replace the whole action bar
      // subtree, which would leave a stale toolbar node connected but orphaned
      // from the bar the user actually sees.
      if (
        toolbar &&
        toolbar.parentElement === getActionBar() &&
        document.getElementById(BRAND_ID)
      ) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(installToolbar, 80);
    };

    onRouteChange(scheduleInstall);
    window.addEventListener('focus', () => window.setTimeout(installToolbar, 100));
  }

  init();
})();


/* ============================================================
 * Feature 8b: Remove the SCHN+ Daily Goal Badge (removed feature)
 * Cleans up the badge element/style for anyone who still has a page open
 * from before this was pulled - the feature itself is gone per request.
 * ============================================================ */

(function () {
  'use strict';

  if (location.hostname !== 'viewlift.freshdesk.com') return;

  document.getElementById('better-freshdesk-tracker-goal')?.remove();
  document.getElementById('better-freshdesk-tracker-goal-style')?.remove();
})();


/* ============================================================
 * Feature 9: Queue CMS snapshots into a private note
 * ============================================================ */

(function () {
  'use strict';

  if (location.hostname !== 'viewlift.freshdesk.com') return;

  if (!/^\/a\/tickets\/\d+(?:\/|$)/i.test(location.pathname)) return;

  const SNAPSHOT_KEY = BV_SNAPSHOT_KEY;
  const STATUS_ID = 'better-freshdesk-snapshot-note-status';
  let pasteInProgress = false;

  function cleanText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function getTicketId() {
    const match = location.pathname.match(/\/a\/tickets\/(\d+)/i);
    return match ? match[1] : '';
  }

  function getPendingQueue() {
    try {
      let value = GM_getValue(SNAPSHOT_KEY, null);
      if (typeof value === 'string') value = JSON.parse(value);
      if (!value) return [];
      return Array.isArray(value) ? value : [value];
    } catch (error) {
      console.warn('[Freshdesk Snapshot] Could not read queued snapshot.', error);
      return [];
    }
  }

  function getPendingTicketId(snapshot) {
    const match = String(snapshot && snapshot.ticketUrl || '').match(/\/tickets\/(\d+)/i);
    return match ? match[1] : '';
  }

  // Peek only - do NOT remove yet. Mirrors the original single-value design:
  // a snapshot only leaves the queue once pasteSnapshot() actually succeeds,
  // so a failed attempt just retries on the next poll instead of being lost.
  function getPendingSnapshotForTicket(ticketId) {
    return getPendingQueue().find(snapshot =>
      snapshot && snapshot.dataUrl && getPendingTicketId(snapshot) === ticketId
    ) || null;
  }

  // Remove only the one matching entry, leaving any other tickets' queued
  // snapshots untouched for their own tab to pick up later.
  function removeSnapshotFromQueue(snapshot) {
    const queue = getPendingQueue().filter(item =>
      !(item && item.createdAt === snapshot.createdAt && item.ticketUrl === snapshot.ticketUrl)
    );

    if (queue.length) {
      GM_setValue(SNAPSHOT_KEY, queue);
    } else {
      GM_deleteValue(SNAPSHOT_KEY);
    }
  }

  function showStatus(message, type) {
    let status = document.getElementById(STATUS_ID);
    if (!status) {
      status = document.createElement('span');
      status.id = STATUS_ID;
      status.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:1000001;padding:9px 12px;border-radius:7px;background:#17324d;color:#fff;font:600 12px Arial,sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.22);';
      document.body.appendChild(status);
    }
    status.textContent = message;
    status.style.background = type === 'error' ? '#991b1b' : '#17324d';
    window.setTimeout(() => status.remove(), 4200);
  }

  function findEditor() {
    return document.querySelector(
      '[contenteditable="true"][role="textbox"], .fr-element[contenteditable="true"], [contenteditable="true"]'
    );
  }

  function clickPrivateNote() {
    const noteButton = document.querySelector('[data-test-id="add-note"], [data-test-note-action="add"]');
    if (noteButton && !noteButton.disabled) {
      noteButton.click();
      return true;
    }
    return false;
  }

  async function pasteSnapshot(snapshot) {
    const dataUrl = cleanText(snapshot && snapshot.dataUrl);
    if (!/^data:image\/png;base64,/i.test(dataUrl)) throw new Error('Invalid queued PNG.');

    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const file = new File([blob], 'cms-snapshot.png', { type: 'image/png' });
    const editor = findEditor();
    if (!editor) return false;

    editor.focus();

    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      editor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer
      }));
    } catch (error) {
      console.warn('[Freshdesk Snapshot] ClipboardEvent paste failed.', error);
    }

    await new Promise(resolve => setTimeout(resolve, 120));

    if (!editor.querySelector('img')) {
      editor.innerHTML = `${editor.innerHTML || ''}<p><img src="${dataUrl}" alt="CMS snapshot" style="max-width:100%;height:auto;"></p>`;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
    }

    return true;
  }

  async function consumeSnapshotIfReady() {
    if (pasteInProgress) return;
    const ticketId = getTicketId();
    if (!ticketId) return;

    const snapshot = getPendingSnapshotForTicket(ticketId);
    if (!snapshot) return;

    if (!findEditor()) {
      clickPrivateNote();
      window.setTimeout(consumeSnapshotIfReady, 700);
      return;
    }

    try {
      pasteInProgress = true;
      if (await pasteSnapshot(snapshot)) {
        removeSnapshotFromQueue(snapshot);
        showStatus('CMS snapshot added to private note.');
      }
    } catch (error) {
      console.error('[Freshdesk Snapshot] Could not add snapshot to note.', error);
      showStatus('Could not add CMS snapshot to the note.', 'error');
    } finally {
      pasteInProgress = false;
    }
  }

  function init() {
    if (!document.body) {
      window.setTimeout(init, 300);
      return;
    }

    window.setTimeout(consumeSnapshotIfReady, 150);
    window.setInterval(consumeSnapshotIfReady, 900);
  }

  init();
})();
}

/* ============================================================
 * Feature 9b: Compact Freshdesk Conversation Images
 * Keeps user-provided photos readable without letting them expand the ticket.
 * ============================================================ */

(function () {
    'use strict';

    if (location.hostname !== 'viewlift.freshdesk.com') return;

    const STYLE_ID = 'better-freshdesk-compact-images-style';
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        [data-test-id*="conversation" i] img,
        [data-test-id*="message" i] img,
        [data-test-id*="attachment" i] img,
        .conversation-body img,
        .thread-message img,
        .attachment img,
        [role="article"] img,
        [class*="conversation" i] img,
        [class*="message" i] img,
        [class*="description" i] img,
        [class*="reply" i] img,
        .fr-view img,
        .fr-element img {
            max-width: 360px !important;
            max-height: 240px !important;
            width: auto !important;
            height: auto !important;
            object-fit: contain !important;
            border-radius: 6px !important;
        }
    `;

    (document.head || document.documentElement).appendChild(style);
})();

/* ============================================================
 * Feature 5: Quick-copy emails mentioned in ticket messages
 * A customer sometimes states a different email in their own message than
 * the one already on file (e.g. "it's my email x@y.com"). Surfaces any such
 * NEW email as a one-click-copy chip under the message it appears in,
 * instead of making the agent select the text by hand. Only flags emails
 * that aren't already the ticket's known email and aren't an obvious
 * internal/system address - it does not try to tell customer messages
 * apart from agent replies, since Freshdesk doesn't expose that reliably.
 * ============================================================ */

(function () {
  'use strict';

  if (location.hostname !== 'viewlift.freshdesk.com') return;
  if (!/^\/a\/tickets\/\d+(?:\/|$)/i.test(location.pathname)) return;

  const STYLE_ID = 'better-freshdesk-mentioned-emails-style';
  const ROW_CLASS = 'better-freshdesk-mentioned-emails';
  const CHIP_CLASS = 'better-freshdesk-mentioned-email-chip';
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const EXCLUDED_LOCAL_PARTS = /^(no-?reply|do-?not-?reply|support|customer\.?support|help|info|contact)@/i;
  // Requires a separator between the area code and the next group, on
  // purpose - a bare 10-digit run is more likely an order/account ID than
  // a phone number, and this cuts down on those false positives.
  const PHONE_RE = /(?:\+\d{1,3}[-.\s])?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
  const scannedNotes = new WeakSet();

  const DETECTORS = [
    {
      type: 'email',
      re: EMAIL_RE,
      normalize: value => value.toLowerCase(),
      isExcluded: (value, knownEmail) =>
        value === knownEmail ||
        EXCLUDED_LOCAL_PARTS.test(value) ||
        /@(viewlift\.com|freshdesk\.com)$/i.test(value)
    },
    {
      type: 'phone',
      re: PHONE_RE,
      normalize: value => value.trim(),
      isExcluded: () => false
    }
  ];

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${ROW_CLASS} {
        display: flex !important;
        flex-wrap: wrap !important;
        gap: 6px !important;
        margin: 4px 0 12px !important;
      }
      .${CHIP_CLASS} {
        display: inline-flex !important;
        align-items: center !important;
        gap: 5px !important;
        padding: 4px 11px !important;
        border-radius: 999px !important;
        border: 1px solid #93c5fd !important;
        background: linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%) !important;
        color: #1e40af !important;
        font: 700 11.5px Arial, sans-serif !important;
        letter-spacing: .01em !important;
        cursor: copy !important;
        white-space: nowrap !important;
        box-shadow: 0 1px 3px rgba(30, 64, 175, .14) !important;
        transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease !important;
      }
      .${CHIP_CLASS}[data-type="email"]::before { content: "\\2709"; }
      .${CHIP_CLASS}[data-type="phone"]::before { content: "\\260E"; }
      .${CHIP_CLASS}:hover {
        box-shadow: 0 3px 8px rgba(30, 64, 175, .22) !important;
        transform: translateY(-1px) !important;
      }
      .${CHIP_CLASS}[data-type="phone"] {
        border-color: #6ee7b7 !important;
        background: linear-gradient(180deg, #ecfdf5 0%, #d1fae5 100%) !important;
        color: #065f46 !important;
        box-shadow: 0 1px 3px rgba(6, 95, 70, .14) !important;
      }
      .${CHIP_CLASS}[data-type="phone"]:hover {
        box-shadow: 0 3px 8px rgba(6, 95, 70, .22) !important;
      }
      .${CHIP_CLASS}[data-copied="yes"] {
        background: linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%) !important;
        border-color: #86efac !important;
        color: #166534 !important;
      }
    `;
    document.head.appendChild(style);
  }

  function getKnownTicketEmail() {
    const badge = document.getElementById('better-freshdesk-action-email');
    return String(badge?.dataset.email || '').trim().toLowerCase();
  }

  function copyValue(chip, value) {
    navigator.clipboard.writeText(value).then(function () {
      chip.dataset.copied = 'yes';
      window.setTimeout(function () { chip.dataset.copied = ''; }, 1500);
    }, function () {});
  }

  function scanNote(note) {
    if (scannedNotes.has(note)) return;

    const text = note.textContent || '';
    if (!text) return;

    const knownEmail = getKnownTicketEmail();
    const found = [];
    const seen = new Set();

    DETECTORS.forEach(function (detector) {
      const matches = text.match(detector.re);
      if (!matches) return;

      matches.forEach(function (rawMatch) {
        const value = detector.normalize(rawMatch);
        const dedupeKey = detector.type + ':' + value;

        if (seen.has(dedupeKey)) return;
        if (detector.isExcluded(value, knownEmail)) return;

        seen.add(dedupeKey);
        found.push({ type: detector.type, value });
      });
    });

    if (!found.length) return;

    scannedNotes.add(note);
    addStyles();

    const row = document.createElement('div');
    row.className = ROW_CLASS;

    found.forEach(function (entry) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = CHIP_CLASS;
      chip.dataset.type = entry.type;
      chip.textContent = entry.value;
      chip.title = 'Click to copy';
      chip.addEventListener('click', function () { copyValue(chip, entry.value); });
      row.appendChild(chip);
    });

    if (note.parentElement) note.parentElement.insertBefore(row, note.nextSibling);
  }

  function scanAllNotes() {
    document.querySelectorAll('.ticket_note').forEach(scanNote);
  }

  onRouteChange(scanAllNotes);
})();

/* ============================================================
 * Feature 6: Freshdesk Header Clutter Removal
 * ============================================================ */

(function () {
  'use strict';

  if (location.hostname !== 'viewlift.freshdesk.com') return;

  const STYLE_ID = 'better-freshdesk-header-cleanup-style';

  const removalRules = [
    {
      selector: '[data-test-id="freddy-copilot-trigger"]',
      getTarget: function (element) {
        return element.closest('.position--relative.ml-16.mr-16') ||
          element.closest('.position--relative') ||
          element;
      }
    },
    {
      selector: 'marketplace-viewer',
      getTarget: function (element) {
        return element.closest('.header-primary__user .ml-16') ||
          element.closest('.ember-view') ||
          element;
      }
    },
    {
      selector: '[data-test-id="help-and-support"]',
      getTarget: function (element) {
        return element.closest('.global-help-and-support') ||
          element.closest('.ember-basic-dropdown') ||
          element;
      }
    },
    {
      selector: '#irisDropdown, [data-test-dropdown-link="irisDropdown"]',
      getTarget: function (element) {
        return element.closest('div.global-notification') ||
          element.closest('.ember-basic-dropdown') ||
          element;
      }
    },
    {
      selector: '[data-test-id="trial-plan-button"]',
      getTarget: function (element) {
        return element.closest('.ml-16.element-inline') || element;
      }
    },
    {
      selector: '[data-testid="omnibar-trigger-button"], #omnibar-trigger-button',
      getTarget: function (element) {
        return element.closest('.trigger-button-container') || element;
      }
    },
    {
      selector: 'img[alt="Translate Buddy"]',
      getTarget: function (element) {
        return element.closest('button, a') ||
          element.closest('.conversation-app-icon') ||
          element;
      }
    },
    {
      // The top action bar's own "Reply" shortcut - removed per request.
      // The actual Reply/Note/Forward compose tabs at the bottom of the
      // conversation are a separate part of the page and are untouched.
      selector: 'section#mainactionbar button[data-test-email-action="reply"]',
      getTarget: function (element) {
        return element;
      }
    }
  ];

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [data-test-id="freddy-copilot-trigger"],
      marketplace-viewer,
      .header-primary__user .global-help-and-support,
      .header-primary__user div.global-notification,
      [data-test-id="trial-plan-button"],
      .trigger-button-container:has([data-testid="omnibar-trigger-button"]),
      .trigger-button-container:has(#omnibar-trigger-button),
      section#mainactionbar button[data-test-email-action="reply"] {
        display: none !important;
      }
    `;

    document.head.appendChild(style);
  }

  function removeHeaderClutter() {
    removalRules.forEach(function (rule) {
      document.querySelectorAll(rule.selector).forEach(function (element) {
        const target = rule.getTarget(element);

        if (target && target !== document.body && target !== document.documentElement) {
          target.remove();
        }
      });
    });
  }

  function init() {
    if (!document.body) {
      setTimeout(init, 200);
      return;
    }

    addStyles();
    removeHeaderClutter();
    onRouteChange(removeHeaderClutter);
  }

  init();
})();

/* ============================================================
 * Feature 2: Freshdesk Reply Template Cleanup and Apply Duplicate Cleanup
 * ============================================================ */

if (location.hostname === 'viewlift.freshdesk.com' && location.pathname.startsWith('/a/tickets/')) {
(function () {
    'use strict';

    const replyBoxSelector = 'button.editor-placeholder[data-test-id="active-editor"]';
    const removeQuotedSelector = 'button.fr-quoted-marker-remove';

    const editorSelectors = [
        '.fr-element.fr-view[contenteditable="true"]',
        '.fr-element[contenteditable="true"]',
        '[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"]'
    ];

    let shouldRemoveQuotedMarker = false;
    let lastEditor = null;
    let forceRewriteUntil = 0;
    let forceRewriteSequence = 0;
    let scheduledCleanRunId = 0;
    let pendingReplyShortcutUntil = 0;
    let pendingReplyShortcutHandled = false;
    let lastForceRewriteReason = '';
    const lastForcedRewriteFingerprint = new WeakMap();
    const CANNED_RESPONSE_LOCK_ATTR = BV_CANNED_RESPONSE_LOCK_ATTR;
    const CANNED_RESPONSE_GLOBAL_KEY = BV_CANNED_RESPONSE_GLOBAL_KEY;
    const CANNED_RESPONSE_PROTECTION_MS = 15000;

    function tryClickRemoveButton() {
        if (!shouldRemoveQuotedMarker) return;

        const removeButton = document.querySelector(removeQuotedSelector);

        if (removeButton) {
            removeButton.click();
            shouldRemoveQuotedMarker = false;
            console.log('[Freshdesk Cleaner] Quoted marker removed');
        }
    }

    function isVisible(element) {
        if (!element) return false;

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
            rect.width > 100 &&
            rect.height > 30 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
        );
    }

    function getEditor() {
        const active = document.activeElement;

        if (active && active.isContentEditable && isVisible(active)) {
            lastEditor = active;
            return active;
        }

        if (lastEditor && document.contains(lastEditor) && isVisible(lastEditor)) {
            return lastEditor;
        }

        for (const selector of editorSelectors) {
            const editors = Array.from(document.querySelectorAll(selector)).filter(isVisible);

            if (editors.length) {
                lastEditor = editors[editors.length - 1];
                return lastEditor;
            }
        }

        return null;
    }

    function getVisibleEditors() {
        const seen = new Set();
        const editors = [];

        for (const selector of editorSelectors) {
            Array.from(document.querySelectorAll(selector)).forEach(editor => {
                if (seen.has(editor)) return;
                seen.add(editor);

                if (isVisible(editor)) {
                    editors.push(editor);
                }
            });
        }

        return editors;
    }

    function getNewestVisibleEditor() {
        const editors = getVisibleEditors();

        if (!editors.length) return null;

        lastEditor = editors[editors.length - 1];
        return lastEditor;
    }

    function getEditorFromEventTarget(target) {
        if (!target || !target.closest) return null;
        return target.closest('[contenteditable="true"]');
    }

    function markCannedResponseMode(editor) {
        if (editor && editor.setAttribute) {
            editor.setAttribute(CANNED_RESPONSE_LOCK_ATTR, 'yes');

            window.setTimeout(function () {
                if (Date.now() >= Number(window[CANNED_RESPONSE_GLOBAL_KEY] || 0)) {
                    editor.removeAttribute(CANNED_RESPONSE_LOCK_ATTR);
                }
            }, CANNED_RESPONSE_PROTECTION_MS + 250);
        }

        window[CANNED_RESPONSE_GLOBAL_KEY] = Date.now() + CANNED_RESPONSE_PROTECTION_MS;

        console.log('[Freshdesk Canned Response] Canned response mode detected, skipping cleaner rewrites');
    }

    function clearCannedResponseMode(editor) {
        if (editor && editor.removeAttribute) {
            editor.removeAttribute(CANNED_RESPONSE_LOCK_ATTR);
        }

        window[CANNED_RESPONSE_GLOBAL_KEY] = 0;
    }

    function isCannedResponseModeActive(editor) {
        const globalUntil = Number(window[CANNED_RESPONSE_GLOBAL_KEY] || 0);

        return Boolean(
            (editor && editor.getAttribute && editor.getAttribute(CANNED_RESPONSE_LOCK_ATTR) === 'yes') ||
            Date.now() < globalUntil
        );
    }

    function getLastNonEmptyLine(text) {
        const lines = String(text || '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        return lines.length ? lines[lines.length - 1] : '';
    }

    function lastLineIsCannedCommand(editor) {
        if (!editor) return false;

        const lastLine = getLastNonEmptyLine(editor.innerText || editor.textContent || '');

        return /^\/c?$/i.test(lastLine);
    }

    function slashKeyLooksLikeCommandContext(editor) {
        if (!editor) return false;

        const text = String(editor.innerText || editor.textContent || '');

        return text.trim() === '' || /[\s\n]$/.test(text);
    }

    function handleCannedCommandKeydown(event) {
        const editor = getEditorFromEventTarget(event.target);

        if (!editor) return;

        if (event.key === '/' && slashKeyLooksLikeCommandContext(editor)) {
            markCannedResponseMode(editor);
        }
    }

    function handleCannedCommandInput(event) {
        const editor = getEditorFromEventTarget(event.target);

        if (!editor) return;

        if (lastLineIsCannedCommand(editor)) {
            markCannedResponseMode(editor);
        }
    }

    function removeInlineFontFormatting(editor) {
        if (!editor || !editor.querySelectorAll) return;

        editor.querySelectorAll('font').forEach(function (fontNode) {
            const span = document.createElement('span');

            while (fontNode.firstChild) {
                span.appendChild(fontNode.firstChild);
            }

            fontNode.parentNode.replaceChild(span, fontNode);
        });

        editor.querySelectorAll('[style]').forEach(function (element) {
            element.style.removeProperty('font-family');
            element.style.removeProperty('font-size');
            element.style.removeProperty('line-height');
            element.style.removeProperty('margin');
            element.style.removeProperty('margin-top');
            element.style.removeProperty('margin-bottom');
            element.style.removeProperty('padding-top');
            element.style.removeProperty('padding-bottom');
            element.style.removeProperty('mso-line-height-rule');
            element.style.removeProperty('mso-fareast-font-family');
            element.style.removeProperty('mso-bidi-font-family');

            if (!element.getAttribute('style') || !element.getAttribute('style').trim()) {
                element.removeAttribute('style');
            }
        });
    }

    function editorHasProtectedRichFormatting(editor) {
        if (!editor || !editor.querySelector) return false;

        return Boolean(editor.querySelector(
            'a, ul, ol, li, table, blockquote, img'
        ));
    }

    function splitQuotedThread(text) {
        const quotePatterns = [
            /^On .+ wrote:\s*$/im,
            /^El .+ escribiÃ³:\s*$/im,
            /^From:\s.+$/im,
            /^De:\s.+$/im,
            /^-----Original Message-----/im,
            /^-{2,}\s*Forwarded message\s*-{2,}/im
        ];

        let firstQuoteIndex = -1;

        for (const pattern of quotePatterns) {
            const match = text.match(pattern);

            if (match && typeof match.index === 'number') {
                if (firstQuoteIndex === -1 || match.index < firstQuoteIndex) {
                    firstQuoteIndex = match.index;
                }
            }
        }

        if (firstQuoteIndex === -1) {
            return {
                reply: text,
                quote: ''
            };
        }

        return {
            reply: text.slice(0, firstQuoteIndex),
            quote: text.slice(firstQuoteIndex)
        };
    }

    function normalizeText(value) {
        return value
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[""]/g, '"')
            .replace(/['']/g, "'")
            .trim();
    }

    function removeDuplicateParagraphs(text) {
        const paragraphs = text
            .split(/\n{2,}/)
            .map(paragraph => paragraph.trim())
            .filter(Boolean);

        const seen = new Set();
        const cleaned = [];

        for (const paragraph of paragraphs) {
            const key = normalizeText(paragraph);

            if (seen.has(key)) {
                continue;
            }

            seen.add(key);
            cleaned.push(paragraph);
        }

        return cleaned.join('\n\n');
    }

    function removeDuplicateGreeting(text) {
        const lines = text.split('\n');
        const nonEmptyIndexes = [];

        lines.forEach((line, index) => {
            if (line.trim()) {
                nonEmptyIndexes.push(index);
            }
        });

        if (nonEmptyIndexes.length < 2) {
            return text;
        }

        const firstIndex = nonEmptyIndexes[0];
        const secondIndex = nonEmptyIndexes[1];

        const firstLine = normalizeText(lines[firstIndex]);
        const secondLine = normalizeText(lines[secondIndex]);

        const greetingRegex = /^(hello|hi|dear|hola|buenos dÃ­as|buenas tardes|good morning|good afternoon)\b.*[,]?$/i;

        if (firstLine === secondLine && greetingRegex.test(firstLine)) {
            lines.splice(secondIndex, 1);
        }

        return lines.join('\n');
    }

    function normalizeGreetingSpacingInText(text) {
        return text.replace(
            /^((?:hello|hi|dear|hola|buenos dÃ­as|buenas tardes|good morning|good afternoon)\b[^\n]*,\s*)\n{3,}/i,
            '$1\n\n'
        );
    }

    function removeRepeatedTopGreeting(text) {
        const lines = text.split('\n');
        const greetingRegex = /^(hello|hi|dear|hola|buenos dÃ­as|buenas tardes|good morning|good afternoon)\b.*,\s*$/i;

        let firstGreetingIndex = -1;
        let firstGreetingText = '';

        for (let index = 0; index < lines.length; index += 1) {
            const normalized = normalizeText(lines[index]);

            if (!normalized) continue;

            if (firstGreetingIndex === -1) {
                if (greetingRegex.test(normalized)) {
                    firstGreetingIndex = index;
                    firstGreetingText = normalized;
                }

                continue;
            }

            if (normalized === firstGreetingText && greetingRegex.test(normalized)) {
                lines.splice(firstGreetingIndex, index - firstGreetingIndex);
                return lines.join('\n').replace(/^\n+/, '');
            }

            break;
        }

        return text;
    }

    function truncateAfterFirstSignature(text) {
        const signaturePattern = /(^|\n)(\s*Regards,\s*\n\s*The Technical Support Team\b[\s\S]*?)(?=\n\s*\S)/i;
        const match = signaturePattern.exec(text);

        if (!match) {
            return text;
        }

        const endIndex = match.index + match[0].length;
        const kept = text.slice(0, endIndex).trim();
        const removed = text.slice(endIndex).trim();

        if (!removed) {
            return text;
        }

        return kept;
    }

    function removeDefaultTemplateAfterAppliedScenario(text) {
        const defaultTemplatePattern = /\n+\s*Thank you for contacting the Technical Support Team\.\s*\n+\s*Regards,\s*\n\s*The Technical Support Team\s*$/i;

        return text.replace(defaultTemplatePattern, '').trim();
    }

    function shouldRunApplyDuplicateCleanup() {
        return lastForceRewriteReason === 'apply' || lastForceRewriteReason === 'manual';
    }

    function cleanAppliedScenarioDuplicates(text) {
        let cleaned = text;

        cleaned = removeRepeatedTopGreeting(cleaned);
        cleaned = removeDefaultTemplateAfterAppliedScenario(cleaned);
        cleaned = truncateAfterFirstSignature(cleaned);

        return cleaned
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function cleanReplyText(rawText) {
        if (!rawText) return rawText;

        let text = rawText
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        text = normalizeGreetingSpacingInText(text);

        const parts = splitQuotedThread(text);

        let reply = parts.reply
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        reply = removeDuplicateGreeting(reply);
        reply = removeDuplicateParagraphs(reply);

        if (shouldRunApplyDuplicateCleanup()) {
            reply = cleanAppliedScenarioDuplicates(reply);
        }

        reply = reply
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();

        const quote = parts.quote
            ? parts.quote.replace(/\n{3,}/g, '\n\n').trim()
            : '';

        return quote ? `${reply}\n\n${quote}` : reply;
    }

    function escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function isGreetingParagraph(text) {
        return /^(hello|hi|dear|hola|buenos dÃ­as|buenas tardes|good morning|good afternoon)\b.*,\s*$/i.test(
            String(text || '').replace(/\s+/g, ' ').trim()
        );
    }

    function cleanBlockText(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isEmptyEditorBlock(element) {
        return Boolean(element && element.nodeType === 1 && cleanBlockText(element.innerText || element.textContent || '') === '');
    }

    function isSignatureBlock(element) {
        const text = cleanBlockText(element ? element.innerText || element.textContent || '' : '');

        return text === 'Regards,' || text === 'The Technical Support Team';
    }

    function createBlankEditorBlock() {
        const blank = document.createElement('div');
        blank.innerHTML = '<br>';
        return blank;
    }

    function placeCaretInsideBlock(block) {
        if (!block) return;

        block.focus && block.focus();

        const range = document.createRange();
        range.selectNodeContents(block);
        range.collapse(true);

        const selection = window.getSelection();

        if (!selection) return;

        selection.removeAllRanges();
        selection.addRange(range);
    }

    function placeCaretAtEnd(editor) {
        if (!editor) return;

        editor.focus();

        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);

        const selection = window.getSelection();

        if (!selection) return;

        selection.removeAllRanges();
        selection.addRange(range);
    }

    function placeCaretAtReplyInsertionPoint(editor) {
        if (!editor || !editor.children) return;

        editor.focus();

        const children = Array.from(editor.children);
        const greetingIndex = children.findIndex(child => isGreetingParagraph(child.innerText || child.textContent || ''));
        const signatureIndex = children.findIndex(isSignatureBlock);

        if (greetingIndex !== -1 && signatureIndex !== -1 && signatureIndex > greetingIndex) {
            const betweenGreetingAndSignature = children
                .slice(greetingIndex + 1, signatureIndex)
                .filter(child => child.parentNode === editor);

            const emptyBodyBlock = betweenGreetingAndSignature.find(isEmptyEditorBlock);

            if (emptyBodyBlock) {
                placeCaretInsideBlock(emptyBodyBlock);
                return;
            }

            const blank = createBlankEditorBlock();
            editor.insertBefore(blank, children[signatureIndex]);
            placeCaretInsideBlock(blank);
            return;
        }

        if (signatureIndex !== -1) {
            const beforeSignature = children[signatureIndex - 1];

            if (beforeSignature && isEmptyEditorBlock(beforeSignature)) {
                placeCaretInsideBlock(beforeSignature);
                return;
            }

            const blank = createBlankEditorBlock();
            editor.insertBefore(blank, children[signatureIndex]);
            placeCaretInsideBlock(blank);
            return;
        }

        placeCaretAtEnd(editor);
    }

    function restoreCaretAfterForcedCleanup(editor) {
        if (!editor) return;

        window.setTimeout(function () {
            if (!document.contains(editor)) return;

            placeCaretAtReplyInsertionPoint(editor);
        }, 0);
    }

    function textToFreshdeskHtml(text) {
        const paragraphs = text
            .split(/\n{2,}/)
            .map(paragraph => paragraph.trim())
            .filter(Boolean);

        const htmlParts = paragraphs.map(paragraph => {
            const cleanParagraph = escapeHtml(paragraph).replace(/\n/g, '<br>');
            return `<div>${cleanParagraph}</div>`;
        });

        return htmlParts.join('<div><br></div>');
    }

    function cleanCurrentEditor() {
        const editor = getEditor();

        if (!editor) {
            console.log('[Freshdesk Cleaner] No editor found');
            return;
        }

        if (isCannedResponseModeActive(editor)) {
            console.log('[Freshdesk Canned Response] Editor is locked, skipping cleaner rewrite');
            return;
        }

        removeInlineFontFormatting(editor);

        const forceRewrite = shouldForceRewrite();

        if (editorHasProtectedRichFormatting(editor) && !forceRewrite) {
            console.log('[Freshdesk Cleaner] Link, list, table, blockquote, or image detected, skipping HTML rewrite');
            return;
        }

        const originalText = editor.innerText || editor.textContent || '';
        const cleanedText = cleanReplyText(originalText);

        if (!cleanedText) {
            return;
        }

        if (!forceRewrite && cleanedText === originalText.trim()) {
            return;
        }

        if (forceRewrite) {
            const fingerprint = forceRewriteSequence + '|' + cleanedText;

            if (lastForcedRewriteFingerprint.get(editor) === fingerprint) {
                return;
            }

            lastForcedRewriteFingerprint.set(editor, fingerprint);
        }

        editor.innerHTML = textToFreshdeskHtml(cleanedText);
        removeInlineFontFormatting(editor);

        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        editor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

        if (forceRewrite) {
            restoreCaretAfterForcedCleanup(editor);
        }

        console.log('[Freshdesk Cleaner] Reply cleaned after Apply');
    }

    function isApplyButton(element) {
        const button = element.closest(
            'button, [role="button"], input[type="button"], input[type="submit"], a'
        );

        if (!button) return false;

        const text = [
            button.innerText,
            button.textContent,
            button.value,
            button.getAttribute('aria-label'),
            button.getAttribute('title')
        ]
            .filter(Boolean)
            .join(' ')
            .trim()
            .toLowerCase();

        return /\b(apply|aplicar)\b/.test(text);
    }

    function isReplyButton(element) {
        const button = element.closest(
            'button, [role="button"], input[type="button"], input[type="submit"], a'
        );

        if (!button) return false;

        if (button.matches('button[data-test-email-action="reply"]')) {
            return true;
        }

        const text = [
            button.innerText,
            button.textContent,
            button.value,
            button.getAttribute('aria-label'),
            button.getAttribute('title'),
            button.getAttribute('data-test-email-action')
        ]
            .filter(Boolean)
            .join(' ')
            .trim()
            .toLowerCase();

        return /\b(reply|responder)\b/.test(text);
    }

    function isTypingTarget(element) {
        if (!element) return false;

        const editable = element.closest
            ? element.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
            : null;

        return Boolean(editable);
    }

    function isReplyShortcut(event) {
        if (!event || event.repeat) return false;
        if (event.ctrlKey || event.altKey || event.metaKey) return false;
        if (isTypingTarget(event.target)) return false;

        return String(event.key || '').toLowerCase() === 'r';
    }

    function markPendingReplyShortcut() {
        pendingReplyShortcutUntil = Date.now() + 10000;
        pendingReplyShortcutHandled = false;
    }

    function hasPendingReplyShortcut() {
        return !pendingReplyShortcutHandled && Date.now() < pendingReplyShortcutUntil;
    }

    function runReplyShortcutCleanupWhenEditorAppears() {
        if (!hasPendingReplyShortcut()) return false;

        const editor = getNewestVisibleEditor();

        if (!editor) {
            return false;
        }

        pendingReplyShortcutHandled = true;
        shouldRemoveQuotedMarker = true;
        markForceRewrite('reply-shortcut');
        scheduleClean();
        return true;
    }

    async function handleReplyShortcutKeydown(event) {
        if (!isReplyShortcut(event)) return;

        markPendingReplyShortcut();

        await waitFor(runReplyShortcutCleanupWhenEditorAppears, { timeout: 3500, pollMs: 50 });
    }

    function getButtonSearchText(element) {
        return [
            element.innerText,
            element.textContent,
            element.value,
            element.getAttribute('aria-label'),
            element.getAttribute('title'),
            element.getAttribute('data-test-id'),
            element.getAttribute('data-testid'),
            element.getAttribute('data-test'),
            element.getAttribute('id'),
            element.className
        ]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function isClickableVisible(element) {
        if (!element || element.nodeType !== 1) return false;

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            !element.disabled &&
            element.getAttribute('aria-disabled') !== 'true'
        );
    }

    function findSummaryButton() {
        const editSummaryButton = document.querySelector(
            'button[data-test-conversation-actions="edit-summary"], [role="button"][data-test-conversation-actions="edit-summary"]'
        );

        if (editSummaryButton && isClickableVisible(editSummaryButton)) {
            return editSummaryButton;
        }

        const addSummaryButton = document.querySelector(
            'button[data-test-id="add-summary-button"], [role="button"][data-test-id="add-summary-button"]'
        );

        if (addSummaryButton && isClickableVisible(addSummaryButton)) {
            return addSummaryButton;
        }

        return Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a'))
            .filter(element => {
                if (!isClickableVisible(element)) return false;
                if (element.closest('[contenteditable="true"], [role="textbox"], input, textarea, select')) return false;

                const text = getButtonSearchText(element);

                if (/\b(edit)\b/.test(text) && /\b(summary)\b/.test(text)) {
                    return true;
                }

                return /\b(summary|summarize|summarise|resumen)\b/.test(text);
            })[0] || null;
    }

    function dispatchButtonEvent(element, type, options) {
        if (!element) return false;

        const eventOptions = Object.assign({
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            button: 0,
            buttons: type === 'mousedown' || type === 'pointerdown' ? 1 : 0,
            detail: type === 'click' ? 1 : 0
        }, options || {});

        if (type.indexOf('pointer') === 0 && typeof PointerEvent === 'function') {
            return element.dispatchEvent(new PointerEvent(type, Object.assign({
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true
            }, eventOptions)));
        }

        return element.dispatchEvent(new MouseEvent(type, eventOptions));
    }

    function nativeButtonClick(element) {
        if (!element) return false;

        try {
            if (element instanceof HTMLButtonElement) {
                HTMLButtonElement.prototype.click.call(element);
                return true;
            }

            if (element instanceof HTMLAnchorElement) {
                HTMLAnchorElement.prototype.click.call(element);
                return true;
            }

            if (typeof element.click === 'function') {
                element.click();
                return true;
            }
        } catch (error) {
            console.error('[Freshdesk Summary Shortcut] Native click failed', error);
        }

        return false;
    }

    function realClickElement(element, logMessage) {
        if (!element || !isClickableVisible(element)) return false;

        element.scrollIntoView({
            block: 'center',
            inline: 'center'
        });

        element.focus && element.focus();

        const rect = element.getBoundingClientRect();
        const eventOptions = {
            clientX: Math.round(rect.left + rect.width / 2),
            clientY: Math.round(rect.top + rect.height / 2),
            screenX: Math.round(window.screenX + rect.left + rect.width / 2),
            screenY: Math.round(window.screenY + rect.top + rect.height / 2)
        };

        const innerTarget = element.querySelector('.nucleus-button__icon, svg, span') || element;

        try {
            nativeButtonClick(element);

            dispatchButtonEvent(element, 'pointerover', eventOptions);
            dispatchButtonEvent(element, 'mouseover', eventOptions);
            dispatchButtonEvent(element, 'pointerdown', eventOptions);
            dispatchButtonEvent(element, 'mousedown', eventOptions);
            dispatchButtonEvent(innerTarget, 'pointerdown', eventOptions);
            dispatchButtonEvent(innerTarget, 'mousedown', eventOptions);
            dispatchButtonEvent(innerTarget, 'pointerup', eventOptions);
            dispatchButtonEvent(innerTarget, 'mouseup', eventOptions);
            dispatchButtonEvent(element, 'pointerup', eventOptions);
            dispatchButtonEvent(element, 'mouseup', eventOptions);
            dispatchButtonEvent(innerTarget, 'click', eventOptions);
            dispatchButtonEvent(element, 'click', eventOptions);

            window.setTimeout(function () {
                nativeButtonClick(element);
                dispatchButtonEvent(element, 'click', eventOptions);
            }, 75);

            if (logMessage) {
                console.log(logMessage);
            }

            return true;
        } catch (error) {
            console.error('[Freshdesk Summary Shortcut] Click failed', error);
            return false;
        }
    }

    function isSummaryShortcut(event) {
        if (!event || event.repeat) return false;
        if (event.ctrlKey || event.altKey || event.metaKey) return false;
        if (isTypingTarget(event.target)) return false;

        return String(event.key || '').toLowerCase() === 'x';
    }

    function clickSummaryButtonFromShortcut() {
        const summaryButton = findSummaryButton();

        if (!summaryButton) {
            console.log('[Freshdesk Summary Shortcut] Summary button not found');
            return false;
        }

        return realClickElement(summaryButton, '[Freshdesk Summary Shortcut] Summary button clicked');
    }

    async function handleSummaryShortcutKeydown(event) {
        if (!isSummaryShortcut(event)) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        if (clickSummaryButtonFromShortcut()) return;

        await waitFor(clickSummaryButtonFromShortcut, { timeout: 1100, pollMs: 50 });
    }

    function markForceRewrite(reason) {
        forceRewriteSequence += 1;
        forceRewriteUntil = Date.now() + 10000;
        lastForceRewriteReason = reason || '';
    }

    function shouldForceRewrite() {
        return Date.now() < forceRewriteUntil;
    }

    function scheduleClean() {
        const runId = ++scheduledCleanRunId;
        const startedAt = Date.now();
        let lastText = '';
        let stableChecks = 0;

        function checkUntilStableThenClean() {
            if (runId !== scheduledCleanRunId) return;

            tryClickRemoveButton();

            const editor = getEditor() || getNewestVisibleEditor();

            if (!editor) {
                if (Date.now() - startedAt < 5000) {
                    setTimeout(checkUntilStableThenClean, 250);
                }

                return;
            }

            if (isCannedResponseModeActive(editor)) {
                console.log('[Freshdesk Canned Response] Editor is locked, skipping scheduled cleanup');
                return;
            }

            const currentText = editor.innerText || editor.textContent || '';

            if (!currentText.trim()) {
                if (Date.now() - startedAt < 5000) {
                    setTimeout(checkUntilStableThenClean, 250);
                }

                return;
            }

            if (currentText === lastText) {
                stableChecks += 1;
            } else {
                lastText = currentText;
                stableChecks = 0;
            }

            if (stableChecks >= 1 || Date.now() - startedAt >= 2500) {
                cleanCurrentEditor();
                return;
            }

            setTimeout(checkUntilStableThenClean, 250);
        }

        setTimeout(checkUntilStableThenClean, 300);
    }

    document.addEventListener('keydown', handleCannedCommandKeydown, true);
    document.addEventListener('keydown', handleReplyShortcutKeydown, true);
    document.addEventListener('keydown', handleSummaryShortcutKeydown, true);
    document.addEventListener('input', handleCannedCommandInput, true);

    document.addEventListener('focusin', function (event) {
        if (event.target && event.target.isContentEditable) {
            lastEditor = event.target;
        }
    }, true);

    document.addEventListener('click', function (event) {
        const replyBox = event.target.closest(replyBoxSelector);

        if (replyBox || isReplyButton(event.target)) {
            shouldRemoveQuotedMarker = true;
            markForceRewrite('reply');
            scheduleClean();
            return;
        }

        if (isApplyButton(event.target)) {
            shouldRemoveQuotedMarker = true;
            clearCannedResponseMode(getEditor());
            markForceRewrite('apply');
            scheduleClean();
        }
    }, true);

    const observer = new MutationObserver(function () {
        tryClickRemoveButton();

        if (hasPendingReplyShortcut()) {
            window.setTimeout(runReplyShortcutCleanupWhenEditorAppears, 100);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Manual cleanup shortcut: Ctrl + Shift + L
    document.addEventListener('keydown', function (event) {
        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'l') {
            event.preventDefault();
            clearCannedResponseMode(getEditor());
            markForceRewrite('manual');
            cleanCurrentEditor();
        }
    }, true);

})();
}

/* ============================================================
 * Feature 3: Freshdesk Header CMS User Search
 * ============================================================ */

(function () {
    'use strict';

    const CMS_USERS_URLS = {
        standard: 'https://cms.viewlift.com/users/search',
        gcp: 'https://cms-gcp.viewlift.com/users/search',
        msn: 'https://cms.monumentalsportsnetwork.com/users/search'
    };
    const BUTTON_ID = 'viewlift-open-cms-header-button';
    const CMS_EMAIL_PARAM = 'openCmsEmail';
    const CMS_PENDING_EMAIL_KEY = 'betterFreshdeskPendingCmsEmail';
    let cmsSearchCompleted = false;
    let cmsSearchStarted = false;
    let cmsFlowTimer = null;
    let cmsFlowObserver = null;

    function isFreshdeskPage() {
        return location.hostname === 'viewlift.freshdesk.com';
    }

    function isCMSUsersPage() {
        return isCMSHost() &&
            /^\/users\/search(?:\/|$)/i.test(location.pathname);
    }

    function isCMSPage() {
        return isCMSHost() &&
            /^\/users(?:\/|$)/i.test(location.pathname);
    }

    function cleanText(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function addClientContextText(chunks, value) {
        const text = cleanText(value);

        if (!text || chunks.includes(text)) return;

        chunks.push(text);
    }

    function getClientFieldContext() {
        const chunks = [];
        const possibleLabels = Array.from(document.querySelectorAll([
            'label',
            '[data-test-id*="label" i]',
            '[class*="label" i]',
            'span'
        ].join(',')));

        possibleLabels.forEach(label => {
            const labelText = cleanText(label.textContent).replace(/\s*\*+\s*$/, '');

            if (!/^client\s+name$/i.test(labelText)) return;

            let container = label.parentElement;

            for (let depth = 0; container && depth < 6; depth += 1) {
                const selectedValue = container.querySelector(
                    '.ember-power-select-selected-item, [role="combobox"], select, input'
                );

                if (selectedValue) {
                    addClientContextText(
                        chunks,
                        selectedValue.value ||
                        selectedValue.innerText ||
                        selectedValue.textContent
                    );
                    addClientContextText(chunks, container.innerText || container.textContent);
                    break;
                }

                container = container.parentElement;
            }
        });

        return chunks;
    }

    function getFreshdeskClientContext() {
        const primaryChunks = [];
        const preferredSelectors = [
            '[data-test-title="main-title"] a',
            '[data-test-title="main-title"]',
            '.header-primary .breadcrumb-title a',
            '.header-primary .breadcrumb-title',
            '[data-test-id*="ticket-subject" i]',
            '[data-test-title*="ticket-subject" i]',
            '[data-test-id*="client" i]',
            '[data-test-title*="client" i]',
            '[aria-label*="client" i]',
            '[name*="client" i]',
            'a[href^="mailto:"]'
        ];

        for (const selector of preferredSelectors) {
            const elements = Array.from(document.querySelectorAll(selector));

            for (const element of elements) {
                addClientContextText(
                    primaryChunks,
                    [
                        element.innerText,
                        element.textContent,
                        element.value,
                        element.getAttribute('href'),
                        element.getAttribute('aria-label'),
                        element.getAttribute('title')
                    ].filter(Boolean).join(' ')
                );
            }
        }

        for (const fieldText of getClientFieldContext()) {
            addClientContextText(primaryChunks, fieldText);
        }

        const breadcrumbItems = Array.from(document.querySelectorAll('.header-primary .breadcrumb__item'));

        for (const item of breadcrumbItems) {
            if (item.getAttribute('data-test-id') === 'breadcrumb-item') continue;

            const text = cleanText(item.innerText || item.textContent || '');

            if (text && !/^\d+$/.test(text)) {
                addClientContextText(primaryChunks, text);
            }
        }

        return {
            primary: primaryChunks.join(' | '),
            fallback: cleanText(document.body ? document.body.innerText : '')
        };
    }

    function getCMSKeyFromClientText(clientText) {
        const normalized = cleanText(clientText).toLowerCase();

        if (!normalized) return '';

        if (/\bmsn\b|\bmonumental\s+sports\s+network\b/i.test(normalized)) {
            return 'msn';
        }

        if (/\bschn\b|\bspace\s+city\s+home\s+network\b|\bliv\b|\bliv\s*golf(?:\s*(?:\+|plus))?\b|\blivgolf(?:\+|plus)?\b|livgolfplus\.com|\blightning\b|\btampa\b|\btampa\s+bay\b/i.test(normalized)) {
            return 'gcp';
        }

        if (/\baltitude\b|\bdirt\s*vision\b|\bdirtvision\b|\bvegas\s+golden\s+knights\b|\bvgk\b|\bknight\s*time\b/i.test(normalized)) {
            return 'standard';
        }

        return '';
    }

    // Brands confirmed to exist (from the ViewLift Support Bot's own platform
    // list - see memory.md) but with no host mapping above, so they fall
    // through to the "standard" default like a genuinely unknown client.
    // Unlike that generic case, this one is worth calling out loud: the
    // search will likely run against the wrong CMS instance entirely for
    // these tickets, not just show a plausible-but-wrong result.
    // User confirmed (2026-08-12) MOTV and FOX One aren't worth routing -
    // left unmapped deliberately, not an oversight. Knight Time is Vegas
    // Golden Knights on the standard host, now routed above.
    const UNROUTED_KNOWN_BRANDS = [
        { label: 'FOX One', re: /\bfox\s*one\b/i },
        { label: 'MOTV', re: /\bmotv\b/i }
    ];

    function getUnroutedKnownBrandLabel(clientContext) {
        const text = cleanText([
            clientContext && clientContext.primary,
            clientContext && clientContext.fallback
        ].filter(Boolean).join(' '));

        const match = UNROUTED_KNOWN_BRANDS.find(brand => brand.re.test(text));
        return match ? match.label : '';
    }

    function getCMSUsersURLForClient(clientContext) {
        const primaryText = clientContext && clientContext.primary
            ? clientContext.primary
            : cleanText(clientContext);
        const fallbackText = clientContext && clientContext.fallback
            ? clientContext.fallback
            : '';
        const cmsKey =
            getCMSKeyFromClientText(primaryText) ||
            getCMSKeyFromClientText(fallbackText) ||
            'standard';

        if (cmsKey === 'standard' && !getCMSKeyFromClientText(primaryText) && !getCMSKeyFromClientText(fallbackText)) {
            console.warn('[CMS Search] Client was not recognized, using the standard CMS:', primaryText || '(empty)');
        }

        return CMS_USERS_URLS[cmsKey];
    }

    function getCMSAccountForClient(clientContext) {
        const text = cleanText([
            clientContext && clientContext.primary,
            clientContext && clientContext.fallback
        ].filter(Boolean).join(' ')).toLowerCase();

        if (/\bschn\b|space\s+city\s+home\s+network/.test(text)) return 'schn';
        if (/\bliv\b|liv\s*golf|livgolfplus/.test(text)) return 'liv-golf';
        if (/\blightning\b|\btampa\b|tampa\s+bay/.test(text)) return 'lightning';
        return '';
    }

    function extractEmailFromText(text) {
        const match = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

        return match ? cleanText(match[0]) : '';
    }

    function isVisible(element) {
        if (!element) return false;

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
        );
    }

    const CMS_SEARCH_BLOCKED_EMAILS = [
        'support@livgolfplus.com',
        'sc-appsupport@spacecityhn.com',
        'customersupport@altitudeplus.com',
        'customer.support@altitudeplus.com',
        'support@altitudeplus.com',
        'noreply@viewlift.com',
        'no-reply@viewlift.com'
    ];

    // Generic, domain-independent version of the list above - catches our
    // own support-team addresses on brands/domains not already hardcoded
    // there (e.g. a new brand's "support@" or "getsupport@"), so the CMS
    // button never offers to search a support inbox as if it were the
    // customer's own email.
    const GENERIC_SUPPORT_LOCAL_PART_RE = /^(?:get)?support\b|^customer[.\-]?support\b|^[a-z]*-?appsupport\b|^(?:no-?reply|help|contact|info)\b/i;

    // A customer's own account email is never on our own domain - this
    // catches internal/bot addresses mentioned in ticket text (e.g. the
    // "Fan Assist" triage bot's fanassist@viewlift.com) that the specific
    // and generic support-address lists above don't otherwise name.
    const OWN_DOMAIN_RE = /@viewlift\.com$/i;

    // Common placeholder/example domains and local parts that show up in
    // UI hint text, sample data, or documentation - not real customers.
    const PLACEHOLDER_DOMAIN_RE = /@(?:email|example|test|domain|yourdomain|sample)\.com$/i;
    const PLACEHOLDER_LOCAL_PART_RE = /^(?:somebody|someone|anybody|example|yourname|username)$/i;

    function isBlockedCmsSearchEmail(email) {
        const lower = cleanText(email).toLowerCase();

        if (!lower) return true;

        if (CMS_SEARCH_BLOCKED_EMAILS.some(blocked => lower === blocked || lower.includes(blocked))) {
            return true;
        }

        if (OWN_DOMAIN_RE.test(lower) || PLACEHOLDER_DOMAIN_RE.test(lower)) return true;

        const localPart = lower.split('@')[0] || '';
        return GENERIC_SUPPORT_LOCAL_PART_RE.test(localPart) || PLACEHOLDER_LOCAL_PART_RE.test(localPart);
    }

    function extractBestCustomerEmailFromText(text) {
        const matches = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];
        const cleaned = matches.map(cleanText).filter(Boolean);

        // Same adjacent-text-with-no-separator problem as
        // collectAllTicketEmailCandidates below - prefer the shorter,
        // cleaner match when one candidate is another with extra text
        // glued onto the front (e.g. a ticket number or name with no
        // whitespace before the real address).
        const deduped = cleaned.filter(candidate =>
            !cleaned.some(other =>
                other !== candidate &&
                other.length < candidate.length &&
                candidate.toLowerCase().endsWith(other.toLowerCase())
            )
        );

        for (const email of deduped) {
            if (!isBlockedCmsSearchEmail(email)) {
                return email;
            }
        }

        return '';
    }

    function getVisibleText(element) {
        if (!element) return '';

        return cleanText(element.innerText || element.textContent || '');
    }

    function collectTextFromRoot(root, chunks, depth = 0) {
        if (!root || depth > 6) return;

        const elements = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];

        for (const element of elements) {
            if (!element) continue;

            if (element.closest && element.closest('#viewlift-open-cms-header-button, #refund-capture-panel')) {
                continue;
            }

            if (element.matches && element.matches('input, textarea')) {
                const value = cleanText(element.value || '');
                if (value) chunks.push(value);
            }

            const text = getVisibleText(element);

            if (text) chunks.push(text);

            const href = element.getAttribute ? element.getAttribute('href') || '' : '';
            const mailtoMatch = href.match(/^mailto:(.+)$/i);

            if (mailtoMatch) chunks.push(mailtoMatch[1]);

            if (element.shadowRoot) {
                collectTextFromRoot(element.shadowRoot, chunks, depth + 1);
            }
        }
    }

    function findEmailNearLabelInLines(lines) {
        for (let i = 0; i < lines.length; i += 1) {
            const line = cleanText(lines[i]);

            if (!/^email$/i.test(line) && !/\bemail\b/i.test(line)) {
                continue;
            }

            for (let j = i; j < Math.min(lines.length, i + 12); j += 1) {
                const email = extractBestCustomerEmailFromText(lines[j]);

                if (email) return email;
            }
        }

        return '';
    }

    function getContactInfoRoots() {
        const roots = [];

        const contactApps = Array.from(
            document.querySelectorAll('mfe-application[app-id="fw-unified-mfe--contact-info"]')
        );

        for (const app of contactApps) {
            roots.push(app);

            if (app.shadowRoot) {
                roots.push(app.shadowRoot);
            }
        }

        Array.from(document.querySelectorAll('[data-test-id*="contact" i], [class*="contact" i], [aria-label*="contact" i]')).forEach(element => {
            roots.push(element);

            if (element.shadowRoot) {
                roots.push(element.shadowRoot);
            }
        });

        return roots;
    }

    function findEmailInContactInfoRoots() {
        const roots = getContactInfoRoots();

        for (const root of roots) {
            const directNodes = root.querySelectorAll
                ? Array.from(root.querySelectorAll('p.break-all, [class~="break-all"], [class*="break-all"], a[href^="mailto:"], [data-test-id*="email" i], [class*="email" i]'))
                : [];

            for (const node of directNodes) {
                const text = [
                    node.innerText,
                    node.textContent,
                    node.getAttribute ? node.getAttribute('href') : ''
                ].filter(Boolean).join(' ');

                const email = extractBestCustomerEmailFromText(text);

                if (email) return email;
            }

            const chunks = [];
            collectTextFromRoot(root, chunks, 0);

            const labelEmail = findEmailNearLabelInLines(chunks);

            if (labelEmail) return labelEmail;

            const fallbackEmail = extractBestCustomerEmailFromText(chunks.join('\n'));

            if (fallbackEmail) return fallbackEmail;
        }

        return '';
    }

    function findEmailInFreshdeskTicketText() {
        const chunks = [];
        collectTextFromRoot(document, chunks, 0);

        const contactInfoIndex = chunks.findIndex(line => /^contact info$/i.test(cleanText(line)));

        if (contactInfoIndex !== -1) {
            const contactBlock = chunks.slice(contactInfoIndex, contactInfoIndex + 120);
            const labelEmail = findEmailNearLabelInLines(contactBlock);

            if (labelEmail) return labelEmail;

            const fallbackEmail = extractBestCustomerEmailFromText(contactBlock.join('\n'));

            if (fallbackEmail) return fallbackEmail;
        }

        return extractBestCustomerEmailFromText(chunks.join('\n'));
    }

    function getCustomerEmailFromContactInfo() {
        const contactInfoEmail = findEmailInContactInfoRoots();

        if (contactInfoEmail) {
            return contactInfoEmail;
        }

        const fallbackEmail = findEmailInFreshdeskTicketText();
        // Only worth a visible note when we're actually on a ticket - on the
        // tickets list/filters view there's no contact info or ticket body to
        // find an email in at all, so "not found" there is normal, not a bug.
        const isOnTicketPage = /^\/a\/tickets\/\d+(?:\/|$)/i.test(location.pathname);

        if (fallbackEmail) {
            // The official Contact Info panel is the reliable source; this
            // fallback scans ticket text instead, which can pick up an email
            // the customer mentioned that isn't their real account email.
            // Worth flagging visibly, not just in the console, since a wrong
            // email here means "No Data Available" in CMS with no obvious cause.
            if (isOnTicketPage) {
                bvNotify('CMS search: using an email found in the ticket text, not the Contact Info panel - double-check it matches the account.', { level: 'info', ttl: 9000 });
            }
            return fallbackEmail;
        }

        console.log('[CMS Search] Contact info email not found. Checked break-all nodes, mailto links, contact roots, shadow DOM, and visible ticket text.');
        // No bvNotify here - the click handler that calls this already shows
        // a native alert() when it gets an empty email back, so a second
        // toast would just be a redundant, confusing double-message.

        return '';
    }

    function findHeaderInsertionPoint() {
        const mainActionBar = document.querySelector('section#mainactionbar');

        if (!mainActionBar) return null;

        const leftActions = mainActionBar.querySelector('.page-actions__left');

        if (!leftActions) return null;

        const replyButton = leftActions.querySelector('button[data-test-email-action="reply"]');

        return replyButton || leftActions.firstElementChild || leftActions;
    }

    function ensureHeaderButtonStyle() {
        const styleId = 'viewlift-open-cms-header-button-style';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            #${BUTTON_ID} {
                margin-right: 6px !important;
                height: 32px !important;
                padding: 0 12px !important;
                border: 1px solid #0e4d8c !important;
                border-radius: 8px !important;
                background: linear-gradient(180deg, #2f7fe0 0%, #0b5cab 100%) !important;
                color: #ffffff !important;
                font-size: 12px !important;
                font-weight: 700 !important;
                letter-spacing: .02em !important;
                cursor: pointer !important;
                display: inline-flex !important;
                align-items: center !important;
                gap: 4px !important;
                box-shadow: 0 4px 12px rgba(11, 92, 171, .32), inset 0 1px 0 rgba(255, 255, 255, .2) !important;
                transition: background 140ms ease, box-shadow 140ms ease, transform 140ms ease !important;
            }
            #${BUTTON_ID}:hover {
                background: linear-gradient(180deg, #3d8bea 0%, #0e4d8c 100%) !important;
                box-shadow: 0 6px 16px rgba(11, 92, 171, .4), inset 0 1px 0 rgba(255, 255, 255, .18) !important;
                transform: translateY(-1px) !important;
            }
            #${BUTTON_ID}:active {
                transform: translateY(0) !important;
                box-shadow: 0 2px 6px rgba(11, 92, 171, .3), inset 0 2px 4px rgba(0, 0, 0, .14) !important;
            }
        `;
        document.head.appendChild(style);
    }

    function styleHeaderButton(button) {
        button.className = 'nucleus-button nucleus-button--secondary app-icon-btn--text hint--rounded hint--bottom';
        button.type = 'button';
        button.setAttribute('aria-label', 'Open CMS user search');
        button.setAttribute('data-viewlift-open-cms-header', 'yes');

        ensureHeaderButtonStyle();
    }

    const EMAIL_MENU_ID = 'viewlift-cms-email-menu';
    const EMAIL_MENU_STYLE_ID = 'viewlift-cms-email-menu-style';

    function collectAllTicketEmailCandidates(primaryEmail) {
        const chunks = [];
        collectTextFromRoot(document, chunks, 0);
        const matches = chunks.join('\n').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];
        const seen = new Set();
        const candidates = [];

        if (primaryEmail) {
            seen.add(primaryEmail.toLowerCase());
            candidates.push(primaryEmail);
        }

        matches.forEach(match => {
            const email = cleanText(match).toLowerCase();
            if (!email || seen.has(email) || isBlockedCmsSearchEmail(email)) return;
            seen.add(email);
            candidates.push(email);
        });

        // The page's own text nodes sometimes render adjacent with no
        // whitespace between them (a ticket number, a name, or a label
        // glued directly onto the real address with no separator - e.g.
        // "350804shaytaylor32@x.com" or "TaylorEmail:shaytaylor32@x.com"),
        // which the regex above can't tell apart from a genuinely longer
        // local part. When one candidate is just another, shorter
        // candidate with extra text glued onto the front, keep only the
        // shorter/cleaner one.
        return candidates.filter(candidate =>
            !candidates.some(other =>
                other !== candidate &&
                other.length < candidate.length &&
                candidate.endsWith(other)
            )
        );
    }

    function addEmailMenuStyles() {
        if (document.getElementById(EMAIL_MENU_STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = EMAIL_MENU_STYLE_ID;
        style.textContent = `
            #${EMAIL_MENU_ID} {
                position: fixed !important;
                z-index: 2147483000 !important;
                min-width: 220px !important;
                max-width: 340px !important;
                padding: 6px !important;
                border: 1px solid #c7d2e0 !important;
                border-radius: 10px !important;
                background: #ffffff !important;
                box-shadow: 0 12px 28px rgba(15, 23, 42, .2) !important;
                font: 12.5px Arial, sans-serif !important;
            }
            #${EMAIL_MENU_ID} .viewlift-cms-email-hint {
                padding: 4px 8px 6px !important;
                color: #64748b !important;
                font-size: 11px !important;
            }
            #${EMAIL_MENU_ID} button {
                display: block !important;
                width: 100% !important;
                box-sizing: border-box !important;
                text-align: left !important;
                padding: 7px 8px !important;
                border: none !important;
                border-radius: 6px !important;
                background: none !important;
                color: #1e293b !important;
                font: inherit !important;
                cursor: pointer !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
            }
            #${EMAIL_MENU_ID} button:hover { background: #eff6ff !important; }
            #${EMAIL_MENU_ID} button .viewlift-cms-email-tag {
                margin-left: 6px !important;
                color: #2563eb !important;
                font-weight: 700 !important;
                font-size: 10.5px !important;
            }
        `;
        document.head.appendChild(style);
    }

    function closeCmsEmailMenu() {
        document.getElementById(EMAIL_MENU_ID)?.remove();
    }

    function showCmsEmailMenu(button, emails, clientContext) {
        addEmailMenuStyles();
        closeCmsEmailMenu();

        const menu = document.createElement('div');
        menu.id = EMAIL_MENU_ID;
        menu.setAttribute('role', 'menu');

        const hint = document.createElement('div');
        hint.className = 'viewlift-cms-email-hint';
        hint.textContent = 'Multiple emails found in this ticket - pick one to search:';
        menu.appendChild(hint);

        emails.forEach((email, index) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.textContent = email;

            if (index === 0) {
                const tag = document.createElement('span');
                tag.className = 'viewlift-cms-email-tag';
                tag.textContent = 'Contact Info';
                item.appendChild(tag);
            }

            item.addEventListener('click', function (event) {
                event.preventDefault();
                event.stopPropagation();
                closeCmsEmailMenu();
                openCMSForEmail(email, clientContext);
            });
            menu.appendChild(item);
        });

        document.body.appendChild(menu);

        const rect = button.getBoundingClientRect();
        menu.style.top = `${Math.round(rect.bottom + 6)}px`;
        menu.style.left = `${Math.round(rect.left)}px`;

        window.setTimeout(function () {
            document.addEventListener('click', function onOutsideClick(event) {
                if (menu.contains(event.target)) return;
                closeCmsEmailMenu();
                document.removeEventListener('click', onOutsideClick);
            });
        }, 0);
    }

    function openCMSForEmail(email, clientContext) {
        const cmsUsersURL = getCMSUsersURLForClient(clientContext);
        const account = getCMSAccountForClient(clientContext);
        const url = new URL(cmsUsersURL);

        const unroutedBrand = getUnroutedKnownBrandLabel(clientContext);
        if (unroutedBrand) {
            bvNotify(
                `CMS search: "${unroutedBrand}" has no CMS host configured yet - opening the standard CMS instead, which likely won't have this customer.`,
                { level: 'warn', ttl: 12000 }
            );
        }

        // GCP's classic CMS has no account selector. Route through the
        // existing v5 selector when the ticket identifies the account.
        if (account && /cms-gcp\.viewlift\.com$/i.test(url.hostname)) {
            url.pathname = '/v5/overview';
            url.searchParams.set('betterSwitch', account);
            try {
                GM_setValue('betterCmsPendingAccountSwitch', JSON.stringify({
                    key: account,
                    returnUrl: `${url.origin}/users/search?keyword=${encodeURIComponent(email)}&filter=all`,
                    startedAt: Date.now()
                }));
            } catch (error) {
                console.warn('[CMS Search] Could not save the pending account switch.', error);
            }
        }
        // CMS's own /users/search page reads "keyword"/"filter" on load and
        // runs the real search itself - no DOM fill/click simulation needed.
        url.searchParams.set('keyword', email);
        url.searchParams.set('filter', 'all');

        console.log('[CMS Search] Opening CMS for:', email, 'Client context:', clientContext.primary || 'Unknown', 'Destination:', url.href);

        window.open(url.href, '_blank');
    }

    function installHeaderButton() {
        if (!isFreshdeskPage()) return;

        // Only makes sense on a specific ticket - there's no contact info or
        // ticket body to search from on the tickets list/filters/leaderboard
        // views, and leaving the button there just invites clicking it with
        // no ticket context (which then can't find any email at all).
        if (!/^\/a\/tickets\/\d+(?:\/|$)/i.test(location.pathname)) {
            document.getElementById(BUTTON_ID)?.remove();
            return;
        }

        if (document.getElementById(BUTTON_ID)) return;

        const insertionPoint = findHeaderInsertionPoint();

        if (!insertionPoint) {
            console.log('[CMS Search] Freshdesk header insertion point not found yet.');
            return;
        }

        const button = document.createElement('button');

        button.id = BUTTON_ID;
        button.textContent = 'CMS';

        styleHeaderButton(button);

        button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();

            const email = getCustomerEmailFromContactInfo();

            if (!email) {
                alert('No pude encontrar el email del cliente. Abre Contact info o copia el email visible en el ticket y vuelve a intentar.');
                return;
            }

            const clientContext = getFreshdeskClientContext();
            const candidates = collectAllTicketEmailCandidates(email);

            if (candidates.length > 1) {
                showCmsEmailMenu(button, candidates, clientContext);
                return;
            }

            openCMSForEmail(email, clientContext);
        });

        insertionPoint.insertAdjacentElement('beforebegin', button);

        // Sweep into the unified toolbar in the same tick instead of waiting
        // for that module's own separate scheduled pass to notice this
        // button and move it - that gap is what shows up as the CMS button
        // briefly sitting loose next to the reply bar before jumping into
        // place.
        if (typeof window.__bvReconcileFreshdeskToolbar === 'function') {
            window.__bvReconcileFreshdeskToolbar();
        }

        console.log('[CMS Search] Header CMS button added.');
    }

    function setNativeValue(element, value) {
        const tagName = element.tagName.toLowerCase();

        let prototype = null;

        if (tagName === 'input') {
            prototype = window.HTMLInputElement.prototype;
        } else if (tagName === 'textarea') {
            prototype = window.HTMLTextAreaElement.prototype;
        }

        const descriptor = prototype
            ? Object.getOwnPropertyDescriptor(prototype, 'value')
            : null;

        const previousValue = element.value;

        if (descriptor && descriptor.set) {
            descriptor.set.call(element, value);
        } else {
            element.value = value;
        }

        // Without resetting React's internal value tracker, React sees the
        // native setter's write as a no-op change and never fires its own
        // onChange, so the component's controlled state stays empty and the
        // next render reverts the input right back to blank.
        if (element._valueTracker) {
            element._valueTracker.setValue(previousValue);
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    }

    function realClick(element, logMessage) {
        if (!element || !isVisible(element)) return false;

        element.scrollIntoView({
            block: 'center',
            inline: 'center'
        });

        element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

        if (logMessage) {
            console.log(logMessage);
        }

        return true;
    }

    function getEmailFromURL() {
        try {
            const params = new URLSearchParams(location.search);
            return cleanText(params.get(CMS_EMAIL_PARAM) || '');
        } catch (error) {
            return '';
        }
    }

    function getPendingCMSEmail() {
        const emailFromURL = extractEmailFromText(getEmailFromURL());

        if (emailFromURL && !isBlockedCmsSearchEmail(emailFromURL)) {
            try {
                sessionStorage.setItem(CMS_PENDING_EMAIL_KEY, emailFromURL);
            } catch (error) {
                console.warn('[CMS Search] Could not save the pending email.', error);
            }

            return emailFromURL;
        }

        try {
            const storedEmail = extractEmailFromText(sessionStorage.getItem(CMS_PENDING_EMAIL_KEY) || '');
            if (storedEmail && !isBlockedCmsSearchEmail(storedEmail)) return storedEmail;
        } catch (error) {
            console.warn('[CMS Search] Could not read the pending email.', error);
        }

        try {
            const sharedEmail = extractEmailFromText(GM_getValue(CMS_PENDING_EMAIL_KEY, '') || '');
            if (sharedEmail && !isBlockedCmsSearchEmail(sharedEmail)) {
                sessionStorage.setItem(CMS_PENDING_EMAIL_KEY, sharedEmail);
                return sharedEmail;
            }
        } catch (error) {
            console.warn('[CMS Search] Could not read the shared pending email.', error);
        }

        return '';
    }

    function clearPendingCMSRequest() {
        try {
            sessionStorage.removeItem(CMS_PENDING_EMAIL_KEY);
        } catch (error) {
            console.warn('[CMS Search] Could not clear the pending email.', error);
        }

        try {
            GM_deleteValue(CMS_PENDING_EMAIL_KEY);
        } catch (error) {
            console.warn('[CMS Search] Could not clear the shared pending email.', error);
        }

        try {
            const url = new URL(location.href);

            if (!url.searchParams.has(CMS_EMAIL_PARAM)) return;

            url.searchParams.delete(CMS_EMAIL_PARAM);
            history.replaceState(history.state, '', url.pathname + url.search + url.hash);
        } catch (error) {
            console.warn('[CMS Search] Could not remove the email from the URL.', error);
        }
    }

    function openCustomerSupportPage(email) {
        if (isCMSUsersPage()) return true;

        const target = new URL('/users/search', location.origin);
        target.searchParams.set(CMS_EMAIL_PARAM, email);
        console.log('[CMS Search] Redirecting directly to Customer Support:', target.href);
        location.replace(target.href);
        return true;
    }

    function getSearchUserInput() {
        const exact = document.querySelector(
            'input[placeholder="Search"], input[placeholder="Search user"]'
        );

        if (exact && isVisible(exact)) {
            return exact;
        }

        return Array.from(document.querySelectorAll('input'))
            .filter(input => {
                if (!isVisible(input)) return false;
                if (input.disabled || input.readOnly) return false;

                const text = [
                    input.getAttribute('placeholder'),
                    input.getAttribute('aria-label'),
                    input.getAttribute('name'),
                    input.getAttribute('id')
                ].filter(Boolean).join(' ').toLowerCase();

                return text.includes('search user') || text.includes('search') ||
                    /@/.test(String(input.value || ''));
            })[0] || null;
    }

    function getSearchButton() {
        return Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(isVisible)
            .find(button => {
                const text = cleanText(button.innerText || button.textContent || '').toLowerCase();
                const label = cleanText([
                    button.getAttribute('aria-label'),
                    button.getAttribute('title'),
                    button.getAttribute('data-testid')
                ].filter(Boolean).join(' ')).toLowerCase();

                return text === 'search' || text === 'buscar' ||
                    /\bsearch\b|\bbuscar\b/.test(label);
            }) || null;
    }

    function stopCMSFlow() {
        clearTimeout(cmsFlowTimer);

        if (cmsFlowObserver) {
            cmsFlowObserver.disconnect();
            cmsFlowObserver = null;
        }
    }

    // Makes "why is this showing no results" self-diagnosing: if the email
    // we searched for isn't actually the customer's real account email
    // (wrong contact-info detection, or the customer has a different email
    // on file than the one mentioned in the ticket), this makes that obvious
    // immediately instead of leaving a blank results table with no clue why.
    function showSearchedEmailToast(email) {
        bvNotify('Searched: ' + email, { level: 'info', ttl: 6000 });
    }

    function runCMSSearch(email) {
        if (cmsSearchCompleted || cmsSearchStarted) return true;

        if (!email) {
            console.log('[CMS Search] No pending email.');
            return false;
        }

        const input = getSearchUserInput();

        if (!input) {
            console.log('[CMS Search] Search user input not found yet.');
            return false;
        }

        // From this point onward the email must never be injected again.
        // Some CMS versions search as the user types and do not expose a
        // detectable Search button. Retrying in that state would overwrite
        // anything the user types after clearing the original search.
        cmsSearchStarted = true;

        try {
            input.focus();
            setNativeValue(input, email);
            showSearchedEmailToast(email);

            const searchButton = getSearchButton();
            let searchTriggered = false;

            if (searchButton) {
                searchButton.scrollIntoView({ block: 'center', inline: 'center' });
                searchButton.focus();
                // Native click is required by the newer CMS search component;
                // dispatching synthetic mouse events alone does not submit it.
                searchButton.click();
                searchTriggered = true;
                console.log('[CMS Search] Search clicked once for: ' + email);
            }

            if (!searchTriggered) {
                input.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true
                }));
                input.dispatchEvent(new KeyboardEvent('keyup', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true
                }));

                console.log('[CMS Search] Email entered once; the CMS handles search from the input.');
            }
        } catch (error) {
            console.warn('[CMS Search] One-time search could not be completed.', error);
        } finally {
            cmsSearchCompleted = true;
            clearPendingCMSRequest();
            stopCMSFlow();
        }

        return true;
    }

    function runCMSFlow() {
        if (cmsSearchCompleted) return true;

        const email = getPendingCMSEmail();

        if (!email) {
            stopCMSFlow();
            return false;
        }

        if (!isCMSUsersPage()) {
            return openCustomerSupportPage(email);
        }

        return runCMSSearch(email);
    }

    async function initCMSFlow() {
        await waitFor(() => {
            if (cmsSearchCompleted) return true;

            const email = getPendingCMSEmail();

            if (!email) {
                stopCMSFlow();
                return true;
            }

            if (!isCMSUsersPage()) {
                return runCMSFlow();
            }

            if (!getSearchUserInput()) return false;

            return runCMSFlow();
        }, { timeout: 10200, pollMs: 50 });
    }

    function scheduleCMSFlow(delay = 200) {
        if (cmsSearchCompleted) return;

        clearTimeout(cmsFlowTimer);
        cmsFlowTimer = setTimeout(runCMSFlow, delay);
    }

    if (isFreshdeskPage()) {
        installHeaderButton();

        let timer = null;

        onRouteChange(function () {
            const isTicketPage = /^\/a\/tickets\/\d+(?:\/|$)/i.test(location.pathname);
            const buttonExists = !!document.getElementById(BUTTON_ID);

            // Nothing to do if we're already in the right state for this
            // page (button present on a ticket, or absent everywhere else).
            if (buttonExists === isTicketPage) return;

            clearTimeout(timer);

            timer = setTimeout(function () {
                installHeaderButton();
            }, 250);
        });
    }

    if (isCMSPage()) {
        getPendingCMSEmail();

        cmsFlowObserver = {
            disconnect: onRouteChange(function () {
                scheduleCMSFlow(200);
            })
        };

        initCMSFlow();
    }

    window.__betterFreshdeskGetCustomerEmail = getCustomerEmailFromContactInfo;

})();

/* ============================================================
 * Feature 4: Better Freshdesk Status Placement and Highlight
 * ============================================================ */

(function () {
  'use strict';

  if (location.hostname !== 'viewlift.freshdesk.com') return;

  const STYLE_ID = 'better-freshdesk-status-style';
  const STATUS_ROW_CLASS = 'better-freshdesk-status-row';
  const STATUS_LABEL_CLASS = 'better-freshdesk-status-label';

  function cleanText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isVisible(element) {
    if (!element || element.nodeType !== 1) return false;

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${STATUS_ROW_CLASS} {
        position: relative !important;
        margin: 8px 10px 12px !important;
        padding: 10px 12px !important;
        border: 1px solid rgba(148, 163, 184, 0.32) !important;
        border-left: 3px solid #64748b !important;
        border-radius: 10px !important;
        background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%) !important;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.045) !important;
      }

      .${STATUS_ROW_CLASS}:focus-within,
      .${STATUS_ROW_CLASS}:hover {
        border-color: rgba(100, 116, 139, 0.46) !important;
        border-left-color: #475569 !important;
        box-shadow: 0 3px 10px rgba(15, 23, 42, 0.06) !important;
      }

      .${STATUS_ROW_CLASS} .${STATUS_LABEL_CLASS} {
        display: inline-flex !important;
        align-items: center !important;
        width: fit-content !important;
        margin-bottom: 5px !important;
        padding: 2px 8px !important;
        border-radius: 999px !important;
        color: #334155 !important;
        background: rgba(100, 116, 139, 0.08) !important;
        font-weight: 700 !important;
        letter-spacing: 0.01em !important;
      }
    `;

    document.head.appendChild(style);
  }

  function getPropertiesSticky() {
    return (
      document.querySelector('[data-test-id="ticket-properties-sticky"]') ||
      document.querySelector('.ticket-sidebar-sticky') ||
      null
    );
  }

  function getPropertiesPanel() {
    return (
      document.querySelector('.ticket-properties-wrapper') ||
      document.querySelector('[data-test-id*="ticket-properties"]') ||
      document.querySelector('[data-test-id*="properties"]') ||
      document.body
    );
  }

  function isStatusLabel(element) {
    if (!element || !isVisible(element)) return false;
    if (element.closest('#refund-capture-panel, #viewlift-open-cms-header-button')) return false;
    if (element.closest('.status-cards-container')) return false;
    if (element.matches('[data-test-id="ticket-status"]')) return false;

    return cleanText(element.textContent) === 'Status';
  }

  function hasStatusControl(element) {
    if (!element) return false;

    return Boolean(element.querySelector(
      'button, [role="button"], [role="combobox"], input, textarea, select, .ember-basic-dropdown-trigger, [data-ebd-id], [aria-haspopup="listbox"], [aria-haspopup="menu"]'
    ));
  }

  function exactStatusLabelCount(element) {
    return Array.from(element.querySelectorAll('label, span, div, p'))
      .filter(child => cleanText(child.textContent) === 'Status')
      .length;
  }

  function scoreStatusCandidate(candidate, label) {
    if (!candidate || candidate === document.body || candidate === document.documentElement) return -1;
    if (!isVisible(candidate)) return -1;
    if (candidate.closest('#refund-capture-panel, #viewlift-open-cms-header-button')) return -1;

    const text = cleanText(candidate.innerText || candidate.textContent || '');
    const rect = candidate.getBoundingClientRect();

    if (!text) return -1;
    if (!candidate.contains(label)) return -1;
    if (text.includes('Properties') && text.length > 120) return -1;

    const labelCount = exactStatusLabelCount(candidate);
    if (labelCount !== 1) return -1;

    let score = 0;

    if (hasStatusControl(candidate)) score += 80;

    const classAndAttrs = [
      candidate.className,
      candidate.getAttribute('data-test-id'),
      candidate.getAttribute('data-test'),
      candidate.getAttribute('id')
    ].filter(Boolean).join(' ').toLowerCase();

    if (/field|property|control|form|select|dropdown|status/.test(classAndAttrs)) score += 30;

    if (rect.height > 24 && rect.height < 140) score += 30;
    if (rect.width > 120 && rect.width < 900) score += 15;
    if (text.length < 220) score += 25;
    if (candidate.children.length <= 8) score += 10;

    if (rect.height >= 180) score -= 120;
    if (text.length >= 350) score -= 140;
    if (candidate.querySelectorAll('input, button, [role="button"], [role="combobox"], select, textarea').length > 4) score -= 80;

    return score;
  }

  function findStatusRow() {
    const panel = getPropertiesPanel();
    const labels = Array.from(panel.querySelectorAll('label, span, div, p')).filter(isStatusLabel);

    let best = null;
    let bestScore = -1;
    let bestLabel = null;

    for (const label of labels) {
      let node = label;

      for (let depth = 0; node && depth < 7; depth += 1) {
        node = node.parentElement;
        const score = scoreStatusCandidate(node, label);

        if (score > bestScore) {
          best = node;
          bestScore = score;
          bestLabel = label;
        }
      }
    }

    if (!best || bestScore < 70) return null;

    if (bestLabel) {
      bestLabel.classList.add(STATUS_LABEL_CLASS);
    }

    return best;
  }

  function moveStatusBelowProperties() {
    addStyles();

    const sticky = getPropertiesSticky();
    if (!sticky || !isVisible(sticky)) return;

    const existing = document.querySelector(`.${STATUS_ROW_CLASS}`);
    if (existing && existing.isConnected && existing.previousElementSibling === sticky) return;

    const row = findStatusRow();
    if (!row) return;

    document.querySelectorAll(`.${STATUS_ROW_CLASS}`).forEach(existing => {
      if (existing !== row) existing.classList.remove(STATUS_ROW_CLASS);
    });

    row.classList.add(STATUS_ROW_CLASS);

    if (row.previousElementSibling === sticky) return;

    sticky.insertAdjacentElement('afterend', row);
  }

  function installObserver() {
    let timer = null;

    onRouteChange(function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        moveStatusBelowProperties();
      }, 120);
    });
  }

  function init() {
    if (!document.body) {
      setTimeout(init, 300);
      return;
    }

    addStyles();
    moveStatusBelowProperties();
    installObserver();
  }

  init();
})();

/* ============================================================
 * Feature: Auto-fill unset ("--") Support Plan/Platform via Freshdesk API
 * "None" is a legitimate, deliberately-chosen value on both fields - the
 * user confirmed only the actual unset placeholder ("--") should be
 * touched, "None" should be left alone. Both are Ember Power Select
 * fields that would not respond to click-simulation despite trying
 * the exact same technique the working Set Agent feature uses - so
 * instead of fighting that UI, this calls Freshdesk's own v2 REST
 * API directly. Requires the user's own Freshdesk API key (entered
 * via the "Freshdesk: Set API Key" Tampermonkey menu command); a
 * request to swap either field to a specific value was not made -
 * per the user, any real value is fine as long as it isn't "--".
 * ============================================================ */

(function () {
    'use strict';

    const DEFAULT_VALUE = 'Standard';
    let lastFixedTicketId = '';

    function cleanText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function isTicketPage() {
        return /^\/a\/tickets\/\d+(?:\/|$)/i.test(location.pathname);
    }

    function getTicketIdFromURL() {
        const match = location.pathname.match(/\/a\/tickets\/(\d+)/i);
        return match ? match[1] : '';
    }

    function getPropertyFieldValue(labelText) {
        const labels = Array.from(document.querySelectorAll('label, [class*="label" i]'));
        const label = labels.find(candidate =>
            cleanText(candidate.textContent).replace(/\s*\*+\s*$/, '').toLowerCase() === labelText.toLowerCase()
        );
        if (!label) return null;

        let container = label.parentElement;
        for (let depth = 0; container && depth < 6; depth += 1, container = container.parentElement) {
            const valueElement = container.querySelector(
                '.ember-power-select-trigger, .ember-power-select-selected-item, [role="combobox"], select, input'
            );
            if (valueElement) return cleanText(valueElement.textContent || valueElement.value);
        }
        return null;
    }

    function fixEmptyFieldsIfNeeded() {
        if (!isTicketPage()) return;

        const ticketId = getTicketIdFromURL();
        if (!ticketId || ticketId === lastFixedTicketId) return;
        if (!getFreshdeskApiKey()) return;

        // "None" is a legitimate, deliberately-chosen value (not blank) -
        // only "--" is the actual unset/blocking placeholder state.
        const fields = {};
        if (getPropertyFieldValue('Support Plan') === '--') fields.cf_support_plan = DEFAULT_VALUE;
        if (getPropertyFieldValue('Platform') === '--') fields.cf_platform = DEFAULT_VALUE;

        if (!Object.keys(fields).length) return;

        lastFixedTicketId = ticketId;

        freshdeskApiRequest({
            method: 'PUT',
            path: `/api/v2/tickets/${ticketId}`,
            body: { custom_fields: fields },
            onDone: function (error) {
                if (error) {
                    if (error.message === 'no-api-key') return;
                    if (error.responseBody) {
                        console.warn('[Freshdesk API] Support Plan/Platform update rejected:', error.responseBody);
                    }
                    bvNotify(
                        'Could not auto-fill Support Plan/Platform (' + error.message + '). ' +
                        'Check your key via the "Freshdesk: Set API Key" Tampermonkey menu, or the browser console for details.',
                        { level: 'warn', ttl: 9000 }
                    );
                    return;
                }
                bvNotify(
                    `Support Plan/Platform were unset ("--") - set to "${DEFAULT_VALUE}" via the Freshdesk API. Refresh to see it reflected in the form.`,
                    { level: 'info', ttl: 9000 }
                );
            }
        });
    }

    onRouteChange(function () {
        setTimeout(fixEmptyFieldsIfNeeded, 1200);
    });
})();
  })();
})();
