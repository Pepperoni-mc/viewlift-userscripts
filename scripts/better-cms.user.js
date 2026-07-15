// ==UserScript==
// @name         Better CMS
// @namespace    https://github.com/Pepperoni-mc/viewlift-userscripts
// @version      2.4
// @author       Happy, Potato
// @description  ViewLift CMS tools: refund capture, session-finalization autofill, cancellation reason autofill, refund workflow helper, and real snapshot capture.
// @match        https://viewlift.freshdesk.com/*
// @match        https://cms.viewlift.com/*
// @match        https://cms-qcp.viewlift.com/*
// @updateURL    https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-cms.user.js
// @downloadURL  https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-cms.user.js
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_addValueChangeListener
// ==/UserScript==


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

  const CMS_HOST_RE = /^cms(?:-qcp)?\.viewlift\.com$/i;
  const CMS_USER_ID_RE = /\/(?:users\/(?:search\/)?|v5\/customer-support\/user\/)([0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const CMS_USER_URL_RE = /https:\/\/cms(?:-qcp)?\.viewlift\.com\/(?:users\/(?:search\/)?|v5\/customer-support\/user\/)(?:[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[^\s"'<>]*)?/ig;
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

  function isFreshdeskHost() {
    return location.hostname === 'viewlift.freshdesk.com';
  }

  function isCMSHost() {
    return CMS_HOST_RE.test(location.hostname);
  }

  function isCMSUserPage() {
    return isCMSHost() && /^\/(?:users|v5\/customer-support\/user)(\/|$)/i.test(location.pathname);
  }

  function isSupportedPage() {
    return isFreshdeskHost() || isCMSUserPage();
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

    const hostMatch = String(url || '').match(/^https:\/\/(cms(?:-qcp)?\.viewlift\.com)/i);
    const host = hostMatch ? hostMatch[1].toLowerCase() : location.hostname.toLowerCase();

    return `https://${host}/v5/customer-support/user/${id}?tab=overview`;
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

    return lines;
  }

  function collectDeepTextFromRoot(root, chunks, depth = 0) {
    if (!root || depth > 6) return;

    const elements = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];

    for (const element of elements) {
      if (isIgnoredElement(element)) continue;

      if (element.matches && element.matches('input, textarea, select')) {
        const value = cleanText(element.value);
        if (value) chunks.push(value);
      }

      const text = cleanText(element.innerText || element.textContent || '');
      if (text) chunks.push(text);

      if (element.shadowRoot) {
        collectDeepTextFromRoot(element.shadowRoot, chunks, depth + 1);
      }
    }
  }

  function getDeepPageTextOutsidePanel() {
    const chunks = [];

    collectDeepTextFromRoot(document, chunks, 0);

    return chunks.join('\n');
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

      if (/^https:\/\/cms(?:-qcp)?\.viewlift\.com\/(?:users\/search|v5\/customer-support\/user)\//i.test(location.href)) {
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
        .slice(Math.max(0, i - 3), Math.min(lines.length, i + 8))
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

    data.amount = findRefundAmountInBillingLines(lines);

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

    if (forceOverwrite || !field.value || isBlockedEmail(field.value) || isBadPaymentValue(field.value)) {
      field.value = next;
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

    return '';
  }

  function getRefundClientContextText() {
    const values = [
      location.href,
      document.title,
      safeGet(STORAGE_KEYS.client, ''),
      safeGet(STORAGE_KEYS.email, ''),
      safeGet(STORAGE_KEYS.activeEmail, ''),
      safeGet(STORAGE_KEYS.cms, ''),
      document.getElementById('refund-email')?.value || '',
      document.getElementById('refund-cms')?.value || '',
      document.body?.innerText || '',
      getDeepPageTextOutsidePanel()
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

    savePageData();
    refreshAutoFields(forceOverwrite);

    if (statusMessage) setStatus(statusMessage);
  }

  function retryCapture() {
    let attempts = 0;

    const interval = setInterval(function () {
      attempts += 1;
      runCapture(false);

      if (attempts >= 60) clearInterval(interval);
    }, 1000);
  }

  function observeDynamicChanges() {
    let timer = null;

    const observer = new MutationObserver(function () {
      clearTimeout(timer);

      timer = setTimeout(function () {
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(function () {
            runCapture(false);
          }, { timeout: 1200 });
        } else {
          runCapture(false);
        }
      }, 800);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'value', 'title', 'aria-label']
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
        background: #0b5cab;
        min-height: 40px;
        height: 40px;
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
        background: #0b5cab;
        color: #ffffff;
        font-weight: 800;
        flex: 0 0 auto;
        border: none;
        cursor: pointer;
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

      /* CMS v5 dark theme */
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
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function () {
      const result = originalPushState.apply(this, arguments);
      setTimeout(handleRefundToolRouteChange, 0);
      return result;
    };

    history.replaceState = function () {
      const result = originalReplaceState.apply(this, arguments);
      setTimeout(handleRefundToolRouteChange, 0);
      return result;
    };

    window.addEventListener('popstate', function () {
      setTimeout(handleRefundToolRouteChange, 0);
    });

    window.addEventListener('hashchange', function () {
      setTimeout(handleRefundToolRouteChange, 0);
    });

    setInterval(handleRefundToolRouteChange, 500);
  }

  function runRefundToolStartupPasses() {
    cleanStoredBadValues();
    createUI();

    setTimeout(function () {
      createUI();
      runCapture(true);
      updateSyncStatusFromStorage();
    }, 300);

    setTimeout(function () {
      createUI();
      runCapture(true);
      updateSyncStatusFromStorage();
    }, 900);

    setTimeout(function () {
      createUI();
      runCapture(true);
      updateSyncStatusFromStorage();
    }, 1800);

    setTimeout(function () {
      createUI();
      runCapture(true);
      updateSyncStatusFromStorage();
    }, 3200);
  }

  function initRefundCaptureTool() {
    if (!document.body) {
      setTimeout(initRefundCaptureTool, 300);
      return;
    }

    installRefundToolRouteWatcher();
    installCrossTabSync();
    installVisibilityCapture();
    observeDynamicChanges();
    retryCapture();

    runRefundToolStartupPasses();

    setInterval(function () {
      handleRefundToolRouteChange();

      if (isSupportedPage()) {
        createUI();
        runCapture(false);
        updateSyncStatusFromStorage();
      } else {
        removeUI();
      }
    }, 1500);
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

    const observer = new MutationObserver(function () {
      installRefunderPreference();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setInterval(installRefunderPreference, 1500);
  }

  initRefunderPreference();
})();



/* ============================================================
 * Feature 2: CMS Auto Fill Cancellation Reason
 * Source: ViewLift CMS auto fill cancellation reason 1.0
 * ============================================================ */


if (/^cms(?:-qcp)?\.viewlift\.com$/i.test(location.hostname)) {

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
        if (/^\/v5\/customer-support(?:\/|$)/i.test(location.pathname)) {
            return getFreshdeskTicketURL();
        }

        return LEGACY_CANCELLATION_REASON;
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
        if (!shouldFillReason) return;

        fillAttempts += 1;

        const reasonValue = getCancellationReasonValue();

        if (!reasonValue) {
            if (fillAttempts >= maxFillAttempts) {
                shouldFillReason = false;
                fillAttempts = 0;
                console.warn('[ViewLift Cancel Reason] Freshdesk ticket was not available.');
            }

            return;
        }

        const field = getBestReasonField();

        if (!field) {
            if (fillAttempts >= maxFillAttempts) {
                shouldFillReason = false;
                fillAttempts = 0;
                console.log('[ViewLift Cancel Reason] No reason field found');
            }

            return;
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
    }

    function scheduleFillReason() {
        fillAttempts = 0;

        setTimeout(fillReasonField, 300);
        setTimeout(fillReasonField, 700);
        setTimeout(fillReasonField, 1200);
        setTimeout(fillReasonField, 2000);
        setTimeout(fillReasonField, 3000);
    }

    document.addEventListener('click', function (event) {
        if (!isCancelButton(event.target)) return;

        shouldFillReason = true;
        scheduleFillReason();

        console.log('[ViewLift Cancel Reason] Cancel button clicked');
    }, true);

    const observer = new MutationObserver(function () {
        if (shouldFillReason) {
            fillReasonField();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();

}


/* ============================================================
 * Feature 5: Save & End Session Form Autofill
 * Uses the customer email and Freshdesk ticket already captured
 * by the Refund Capture Tool.
 * ============================================================ */

if (/^cms(?:-qcp)?\.viewlift\.com$/i.test(location.hostname)) {

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
        [0, 100, 250, 500, 900, 1500].forEach(delay => {
            window.setTimeout(fillEndSessionForm, delay);
        });
    }

    document.addEventListener('click', function (event) {
        const button = event.target.closest?.('button');

        if (!button) return;

        const text = cleanText(button.innerText || button.textContent || '').toLowerCase();

        if (text.includes('save & end session') || text.includes('save and end session')) {
            scheduleFill();
        }
    }, true);

    const observer = new MutationObserver(function () {
        clearTimeout(observerTimer);
        observerTimer = window.setTimeout(fillEndSessionForm, 50);
    });

    function init() {
        if (!document.body) {
            window.setTimeout(init, 250);
            return;
        }

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        scheduleFill();
    }

    init();
})();

}



/* ============================================================
 * Feature 3: CMS v5 Percentage Refund Workflow
 * Opens Refund > % Refund and prepares the Issue Refund form.
 * The final Issue Refund button is intentionally not clicked.
 * ============================================================ */

if (/^cms(?:-qcp)?\.viewlift\.com$/i.test(location.hostname)) {

(function () {
    'use strict';

    if (window.__betterCmsV5PercentageRefundInstalled) return;
    window.__betterCmsV5PercentageRefundInstalled = true;

    const REFUND_PERCENTAGE = '100';
    const REFUND_REASON_VALUE = 'ROTH';
    const COMMENT_PREFIX = 'Customer wanted a refund: ';
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
            element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
            element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
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

    function getPercentageRefundOption() {
        return Array.from(document.querySelectorAll(
            '[data-slot="dropdown-menu-item"], [role="menuitem"], [role="option"], [data-radix-collection-item]'
        )).filter(isVisible).find(item => {
            const text = getText(item).toLowerCase();
            return text === '% refund' || text.includes('% refund') || text.includes('percentage refund');
        }) || null;
    }

    function getIssueRefundDialog() {
        const dialog = Array.from(document.querySelectorAll(
            '[role="dialog"], [data-slot="dialog-content"]'
        )).filter(isVisible).find(element => {
            const title = getText(element.querySelector(
                '[data-slot="dialog-title"], h1, h2, h3'
            )).toLowerCase();
            return title === 'issue refund';
        });

        if (dialog) return dialog;

        const input = document.querySelector(
            'input[placeholder*="50 for 50%" i], input[placeholder*="refund percentage" i]'
        );
        return input?.closest?.('[role="dialog"], [data-slot="dialog-content"], form') || null;
    }

    function getPercentageInput(dialog) {
        return dialog?.querySelector(
            'input[placeholder*="50 for 50%" i], input[placeholder*="refund percentage" i]'
        ) || Array.from(dialog?.querySelectorAll('input') || []).find(input =>
            cleanText(input.parentElement?.innerText).toLowerCase().includes('refund percentage')) || null;
    }

    function getReasonTrigger(dialog) {
        return Array.from(dialog?.querySelectorAll(
            'button[data-slot="select-trigger"], button[role="combobox"], [role="combobox"]'
        ) || []).filter(isVisible).find(element => {
            const text = getText(element).toLowerCase();
            const context = cleanText(element.parentElement?.innerText).toLowerCase();
            return text.includes('select a reason') || context.includes('reason');
        }) || null;
    }

    function getReasonOption() {
        const options = Array.from(document.querySelectorAll(
            '[data-slot="select-item"], [role="option"], [data-radix-collection-item]'
        )).filter(isVisible);

        return options.find(option => {
            const value = cleanText(option.getAttribute('data-value') || '').toUpperCase();
            return value === REFUND_REASON_VALUE || getText(option).toLowerCase().includes('roth');
        }) || options.find(option => {
            const text = getText(option).toLowerCase();
            return text === 'other' || text.includes('other reason');
        }) || null;
    }

    function getFreshdeskURL() {
        const liveValue = cleanText(document.getElementById('refund-freshdesk')?.value || '');
        if (/^https:\/\/viewlift\.freshdesk\.com\/a\/tickets\/\d+$/i.test(liveValue)) return liveValue;

        try {
            const storedValue = cleanText(GM_getValue('Freshdesk ID', ''));
            return /^https:\/\/viewlift\.freshdesk\.com\/a\/tickets\/\d+$/i.test(storedValue)
                ? storedValue : '';
        } catch (error) {
            return '';
        }
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

        if (!percentageOptionClicked) {
            const option = getPercentageRefundOption();
            if (option) {
                percentageOptionClicked = realClick(option, '[Better CMS Refund] % Refund selected.');
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
            const ticket = getFreshdeskURL();
            if (textarea && ticket) {
                commentsFilled = setControlledValue(textarea, COMMENT_PREFIX + ticket);
            }
        }

        if (!reasonSelected) {
            const option = getReasonOption();
            if (option) {
                reasonSelected = realClick(option, '[Better CMS Refund] Reason selected: ROTH.');
            } else {
                const trigger = getReasonTrigger(dialog);
                const triggerText = getText(trigger).toLowerCase();

                if (trigger && !triggerText.includes('select a reason')) {
                    reasonSelected = true;
                } else if (trigger && trigger.getAttribute('aria-expanded') !== 'true' &&
                    Date.now() - lastReasonTriggerClickAt > 500) {
                    lastReasonTriggerClickAt = Date.now();
                    realClick(trigger, '[Better CMS Refund] Reason menu opened.');
                }
            }
        }

        if (percentageFilled && reasonSelected && commentsFilled) {
            workflowActive = false;
            console.log('[Better CMS Refund] Form prepared. Click Issue Refund when ready.');
            return;
        }

        scheduleRun(150);
    }

    function startWorkflow() {
        workflowActive = true;
        workflowStartedAt = Date.now();
        percentageOptionClicked = false;
        percentageFilled = false;
        reasonSelected = false;
        commentsFilled = false;
        lastRefundTriggerClickAt = Date.now();
        lastReasonTriggerClickAt = 0;
        scheduleRun(80);
    }

    document.addEventListener('click', function (event) {
        if (!internalClick && isRefundTrigger(event.target)) startWorkflow();
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
 * Feature 3 Legacy: CMS Auto Percentage Refund After Action
 * Source: exact original standalone script, injected into page context.
 * Reason: the original script uses @grant none. Better CMS needs GM_* grants,
 * so this module is injected into the page to preserve the original behavior.
 * ============================================================ */

(function () {
    'use strict';

    if (!/^cms(?:-qcp)?\.viewlift\.com$/i.test(location.hostname)) {
        return;
    }

    if (/^\/v5\/customer-support(?:\/|$)/i.test(location.pathname)) {
        return;
    }

    if (document.getElementById('better-cms-original-refund-workflow-script')) {
        return;
    }

    const script = document.createElement('script');
    script.id = 'better-cms-original-refund-workflow-script';
    script.type = 'text/javascript';
    script.textContent = "(function () {\n    'use strict';\n\n    const REFUND_PERCENTAGE = '100';\n    const REFUND_REASON_VALUE = 'ROTH';\n    const ADDITIONAL_COMMENT_PREFIX = 'Customer wanted a refund: ';\n\n    let workflowActive = false;\n    let attempts = 0;\n\n    let refundClicked = false;\n    let issuePercentageClicked = false;\n    let percentageFilled = false;\n    let reasonDropdownOpened = false;\n    let reasonSelected = false;\n    let additionalCommentsHandled = false;\n\n    function isVisible(element) {\n        if (!element) return false;\n\n        const rect = element.getBoundingClientRect();\n        const style = window.getComputedStyle(element);\n\n        return (\n            rect.width > 0 &&\n            rect.height > 0 &&\n            style.display !== 'none' &&\n            style.visibility !== 'hidden' &&\n            style.opacity !== '0'\n        );\n    }\n\n    function cleanText(value) {\n        return (value || '').replace(/\\s+/g, ' ').trim();\n    }\n\n    function getText(element) {\n        return cleanText(element.innerText || element.textContent || '');\n    }\n\n    function realClick(element, logMessage) {\n        if (!element || !isVisible(element)) return false;\n\n        element.scrollIntoView({\n            block: 'center',\n            inline: 'center'\n        });\n\n        element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));\n        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));\n        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));\n        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));\n\n        if (logMessage) {\n            console.log(logMessage);\n        }\n\n        return true;\n    }\n\n    function setNativeValue(element, value) {\n        const tagName = element.tagName.toLowerCase();\n\n        let prototype = null;\n\n        if (tagName === 'input') {\n            prototype = window.HTMLInputElement.prototype;\n        } else if (tagName === 'textarea') {\n            prototype = window.HTMLTextAreaElement.prototype;\n        }\n\n        const descriptor = prototype\n            ? Object.getOwnPropertyDescriptor(prototype, 'value')\n            : null;\n\n        if (descriptor && descriptor.set) {\n            descriptor.set.call(element, value);\n        } else {\n            element.value = value;\n        }\n\n        element.dispatchEvent(new Event('input', { bubbles: true }));\n        element.dispatchEvent(new Event('change', { bubbles: true }));\n        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));\n        element.dispatchEvent(new Event('blur', { bubbles: true }));\n    }\n\n    function isActionIconClick(target) {\n        const icon = target.closest('[data-testid=\"VisibilityIcon\"]');\n\n        if (icon) return true;\n\n        const clickable = target.closest('button, [role=\"button\"], a, td, div');\n\n        if (!clickable) return false;\n\n        return Boolean(clickable.querySelector('[data-testid=\"VisibilityIcon\"]'));\n    }\n\n    function findButtonByText(text) {\n        const targetText = text.toLowerCase();\n\n        return Array.from(document.querySelectorAll('button, [role=\"button\"]'))\n            .filter(isVisible)\n            .find(button => getText(button).toLowerCase() === targetText);\n    }\n\n    function findMenuItemByText(text) {\n        const targetText = text.toLowerCase();\n\n        return Array.from(document.querySelectorAll('li, [role=\"menuitem\"], [role=\"option\"]'))\n            .filter(isVisible)\n            .find(item => getText(item).toLowerCase() === targetText);\n    }\n\n    function getRefundPercentageInput() {\n        const exact = document.querySelector('input[placeholder=\"Enter refund percentage\"]');\n\n        if (exact && isVisible(exact)) {\n            return exact;\n        }\n\n        return Array.from(document.querySelectorAll('input'))\n            .filter(input => {\n                if (!isVisible(input)) return false;\n                if (input.disabled || input.readOnly) return false;\n\n                const text = [\n                    input.getAttribute('aria-label'),\n                    input.getAttribute('placeholder'),\n                    input.getAttribute('name'),\n                    input.getAttribute('id'),\n                    input.closest('.MuiFormControl-root')?.innerText,\n                    input.closest('.MuiDialog-root')?.innerText\n                ].filter(Boolean).join(' ').toLowerCase();\n\n                return text.includes('refund') || text.includes('percentage');\n            })[0] || null;\n    }\n\n    function fillRefundPercentage() {\n        const input = getRefundPercentageInput();\n\n        if (!input) return false;\n\n        input.focus();\n        setNativeValue(input, REFUND_PERCENTAGE);\n\n        percentageFilled = true;\n\n        console.log('[ViewLift Refund] Refund percentage filled: 100');\n\n        return true;\n    }\n\n    function getReasonDropdown() {\n        const candidates = Array.from(document.querySelectorAll(\n            '[role=\"combobox\"], .MuiSelect-select, .MuiInputBase-root'\n        )).filter(element => {\n            if (!isVisible(element)) return false;\n\n            const text = [\n                element.getAttribute('aria-label'),\n                element.getAttribute('placeholder'),\n                element.getAttribute('name'),\n                element.getAttribute('id'),\n                getText(element),\n                element.closest('.MuiFormControl-root')?.innerText,\n                element.closest('.MuiDialog-root')?.innerText\n            ].filter(Boolean).join(' ').toLowerCase();\n\n            if (text.includes('refund percentage')) return false;\n            if (text.includes('enter refund percentage')) return false;\n\n            return (\n                text.includes('reason') ||\n                text.includes('refund reason') ||\n                element.getAttribute('role') === 'combobox' ||\n                String(element.className).includes('MuiSelect')\n            );\n        });\n\n        if (!candidates.length) return null;\n\n        const scored = candidates.map(element => {\n            const text = [\n                element.getAttribute('aria-label'),\n                element.getAttribute('placeholder'),\n                getText(element),\n                element.closest('.MuiFormControl-root')?.innerText,\n                element.closest('.MuiDialog-root')?.innerText\n            ].filter(Boolean).join(' ').toLowerCase();\n\n            let score = 0;\n\n            if (text.includes('refund reason')) score += 50;\n            if (text.includes('reason')) score += 30;\n            if (element.getAttribute('role') === 'combobox') score += 20;\n            if (String(element.className).includes('MuiSelect')) score += 15;\n\n            return { element, score };\n        });\n\n        scored.sort((a, b) => b.score - a.score);\n\n        return scored[0].element;\n    }\n\n    function getROTHOption() {\n        const exact = document.querySelector(\n            'li[data-value=\"ROTH\"], [role=\"option\"][data-value=\"ROTH\"]'\n        );\n\n        if (exact && isVisible(exact)) {\n            return exact;\n        }\n\n        return Array.from(document.querySelectorAll('li, [role=\"option\"], [role=\"menuitem\"]'))\n            .filter(isVisible)\n            .find(option => {\n                const text = getText(option).toLowerCase();\n                const value = option.getAttribute('data-value');\n\n                return value === REFUND_REASON_VALUE || text.includes('roth');\n            }) || null;\n    }\n\n    function getAdditionalCommentsField() {\n        const selectors = [\n            'textarea[rows=\"4\"][required]',\n            'textarea.MuiInputBase-inputMultiline[required]',\n            'textarea.MuiInputBase-inputMultiline',\n            'textarea[rows=\"4\"]'\n        ];\n\n        for (const selector of selectors) {\n            const fields = Array.from(document.querySelectorAll(selector))\n                .filter(field => {\n                    return (\n                        isVisible(field) &&\n                        !field.disabled &&\n                        !field.readOnly\n                    );\n                });\n\n            if (fields.length) {\n                return fields[fields.length - 1];\n            }\n        }\n\n        const textareas = Array.from(document.querySelectorAll('textarea'))\n            .filter(field => {\n                return (\n                    isVisible(field) &&\n                    !field.disabled &&\n                    !field.readOnly\n                );\n            });\n\n        if (textareas.length) {\n            return textareas[textareas.length - 1];\n        }\n\n        return null;\n    }\n\n    function getFreshdeskURLFromRefundCaptureTool() {\n        const field = document.getElementById('refund-freshdesk');\n\n        if (!field) {\n            console.log('[ViewLift Refund] Refund Capture Tool field #refund-freshdesk not found');\n            return '';\n        }\n\n        const value = cleanText(field.value);\n\n        if (/^https:\\/\\/viewlift\\.freshdesk\\.com\\/a\\/tickets\\/\\d+$/i.test(value)) {\n            return value;\n        }\n\n        console.log('[ViewLift Refund] Refund Capture Tool field found but no valid Freshdesk URL:', value || 'empty');\n\n        return '';\n    }\n\n    function handleAdditionalComments() {\n        const field = getAdditionalCommentsField();\n\n        if (!field) {\n            console.log('[ViewLift Refund] Additional comments field not found.');\n            return false;\n        }\n\n        field.scrollIntoView({\n            block: 'center',\n            inline: 'center'\n        });\n\n        field.focus();\n        field.click();\n\n        const freshdeskURL = getFreshdeskURLFromRefundCaptureTool();\n\n        if (freshdeskURL) {\n            const comment = ADDITIONAL_COMMENT_PREFIX + freshdeskURL;\n\n            setNativeValue(field, comment);\n\n            console.log('[ViewLift Refund] Additional comments filled from Refund Capture Tool:', comment);\n        } else {\n            console.log('[ViewLift Refund] No Freshdesk URL available. Additional comments focused for manual paste.');\n        }\n\n        additionalCommentsHandled = true;\n\n        return true;\n    }\n\n    function selectROTHReason() {\n        const option = getROTHOption();\n\n        if (option) {\n            realClick(option, '[ViewLift Refund] Refund reason selected: ROTH');\n\n            reasonSelected = true;\n\n            setTimeout(handleAdditionalComments, 400);\n            setTimeout(handleAdditionalComments, 1000);\n\n            return true;\n        }\n\n        if (!reasonDropdownOpened) {\n            const dropdown = getReasonDropdown();\n\n            if (dropdown) {\n                reasonDropdownOpened = true;\n                realClick(dropdown, '[ViewLift Refund] Refund reason dropdown opened');\n                return true;\n            }\n        }\n\n        return false;\n    }\n\n    function runWorkflow() {\n        if (!workflowActive) return;\n\n        attempts += 1;\n\n        if (attempts > 50) {\n            workflowActive = false;\n            console.log('[ViewLift Refund] Workflow stopped after too many attempts');\n            return;\n        }\n\n        if (!refundClicked) {\n            const refundButton = findButtonByText('Refund');\n\n            if (refundButton) {\n                refundClicked = realClick(refundButton, '[ViewLift Refund] Refund clicked automatically');\n                setTimeout(runWorkflow, 400);\n                return;\n            }\n        }\n\n        if (!issuePercentageClicked) {\n            const item = findMenuItemByText('Issue percentage refund');\n\n            if (item) {\n                issuePercentageClicked = realClick(item, '[ViewLift Refund] Issue percentage refund clicked automatically');\n                setTimeout(runWorkflow, 400);\n                return;\n            }\n        }\n\n        if (!percentageFilled) {\n            if (fillRefundPercentage()) {\n                setTimeout(runWorkflow, 400);\n                return;\n            }\n        }\n\n        if (!reasonSelected) {\n            if (selectROTHReason()) {\n                setTimeout(runWorkflow, 400);\n                return;\n            }\n        }\n\n        if (reasonSelected && !additionalCommentsHandled) {\n            if (handleAdditionalComments()) {\n                workflowActive = false;\n                console.log('[ViewLift Refund] Refund form prepared. Final confirmation was NOT clicked.');\n                return;\n            }\n        }\n\n        if (\n            refundClicked &&\n            issuePercentageClicked &&\n            percentageFilled &&\n            reasonSelected &&\n            additionalCommentsHandled\n        ) {\n            workflowActive = false;\n            console.log('[ViewLift Refund] Refund form prepared. Final confirmation was NOT clicked.');\n        }\n    }\n\n    function startWorkflow() {\n        workflowActive = true;\n        attempts = 0;\n\n        refundClicked = false;\n        issuePercentageClicked = false;\n        percentageFilled = false;\n        reasonDropdownOpened = false;\n        reasonSelected = false;\n        additionalCommentsHandled = false;\n\n        console.log('[ViewLift Refund] Action clicked. Starting refund workflow.');\n\n        setTimeout(runWorkflow, 300);\n        setTimeout(runWorkflow, 700);\n        setTimeout(runWorkflow, 1200);\n        setTimeout(runWorkflow, 1800);\n        setTimeout(runWorkflow, 2600);\n        setTimeout(runWorkflow, 3600);\n        setTimeout(runWorkflow, 5000);\n    }\n\n    document.addEventListener('click', function (event) {\n        if (isActionIconClick(event.target)) {\n            startWorkflow();\n        }\n    }, true);\n\n    const observer = new MutationObserver(function () {\n        if (workflowActive) {\n            runWorkflow();\n        }\n    });\n\n    observer.observe(document.body, {\n        childList: true,\n        subtree: true\n    });\n\n})();";
    (document.head || document.documentElement).appendChild(script);
})();

/* ============================================================
 * Feature 4: CMS Real Snapshot to Clipboard
 * Source: ViewLift CMS Real Snapshot to Clipboard 2.9
 * ============================================================ */


if (/^cms(?:-qcp)?\.viewlift\.com$/i.test(location.hostname)) {

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

    const AUTO_OPEN_SUBSCRIPTION_PLANS = true;

    let autoOpenAttempted = false;
    let lastUrl = location.href;
    let routeTimer = null;

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
        return /^\/(?:users|v5\/customer-support\/user)(\/|$)/i.test(location.pathname);
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

    function removeToolsIfNotUserPage() {
        if (isUserPage()) return;

        const wrapper = document.getElementById(WRAPPER_ID);
        if (wrapper) wrapper.remove();
    }

    function createOrMoveTools() {
        if (!isUserPage()) {
            removeToolsIfNotUserPage();
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

        if (AUTO_OPEN_SUBSCRIPTION_PLANS) {
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
        return new Promise(resolve => {
            const startedAt = Date.now();

            const timer = setInterval(() => {
                const handler = findPaymentHandlerValue();

                if (handler) {
                    clearInterval(timer);
                    resolve(handler);
                    return;
                }

                if (Date.now() - startedAt >= timeoutMs) {
                    clearInterval(timer);
                    resolve("");
                }
            }, 300);
        });
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
        const v5Header = Array.from(document.querySelectorAll("h3.flex.gap-3"))
            .find(element => !element.closest("[role='dialog'], #refund-capture-panel"));

        if (v5Header) return v5Header;

        const pageHeader = document.querySelector("#header");

        if (pageHeader) {
            const h4 = pageHeader.querySelector("h4");
            if (h4) return h4;
        }

        return document.querySelector("h4");
    }

    async function captureRealTabSnapshot() {
        const button = document.getElementById(BUTTON_ID);
        if (!button) return;

        const originalText = "📸";
        let restoreHiddenElements = null;
        let stream;

        try {
            updatePaymentHandlerBadge();

            button.disabled = true;
            button.style.opacity = "0.75";

            restoreHiddenElements = hideElementsForCapture();

            await nextFrame();
            await nextFrame();
            await delay(150);

            stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    displaySurface: "browser",
                    logicalSurface: true,
                    cursor: "never"
                },
                audio: false,
                preferCurrentTab: true
            });

            const video = document.createElement("video");
            video.srcObject = stream;
            video.muted = true;
            video.playsInline = true;

            await video.play();

            await new Promise(resolve => {
                if (video.readyState >= 2) {
                    resolve();
                } else {
                    video.onloadedmetadata = resolve;
                }
            });

            await nextFrame();

            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const context = canvas.getContext("2d");
            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            const blob = await canvasToBlob(canvas);

            await navigator.clipboard.write([
                new ClipboardItem({
                    "image/png": blob
                })
            ]);

            stopStream(stream);
            stream = null;

            restoreHiddenElements();
            restoreHiddenElements = null;

            button.disabled = false;
            button.style.opacity = "1";
            button.textContent = "✅";

            setTimeout(() => {
                button.textContent = originalText;
            }, 1200);

        } catch (error) {
            if (stream) {
                stopStream(stream);
            }

            if (restoreHiddenElements) {
                restoreHiddenElements();
            }

            console.error("Real snapshot failed:", error);

            button.disabled = false;
            button.style.opacity = "1";
            button.textContent = "⚠️";

            alert(
                "Snapshot failed.\n\n" +
                "When prompted, choose the current browser tab, not the whole screen or window.\n\n" +
                "Check the browser console for details."
            );

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
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function () {
            const result = originalPushState.apply(this, arguments);
            setTimeout(handleRouteChange, 0);
            return result;
        };

        history.replaceState = function () {
            const result = originalReplaceState.apply(this, arguments);
            setTimeout(handleRouteChange, 0);
            return result;
        };

        window.addEventListener("popstate", () => {
            setTimeout(handleRouteChange, 0);
        });

        window.addEventListener("hashchange", () => {
            setTimeout(handleRouteChange, 0);
        });

        setInterval(handleRouteChange, 400);
    }

    function runStartupPasses() {
        createOrMoveTools();

        setTimeout(createOrMoveTools, 250);
        setTimeout(createOrMoveTools, 600);
        setTimeout(createOrMoveTools, 1200);
        setTimeout(createOrMoveTools, 2200);
        setTimeout(createOrMoveTools, 3500);
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

    function stopStream(stream) {
        stream.getTracks().forEach(track => track.stop());
    }

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

        const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                handleRouteChange();
                createOrMoveTools();
                updatePaymentHandlerBadge();
            }, 200);
        });

        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true
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
            handleRouteChange();
            createOrMoveTools();
            updatePaymentHandlerBadge();

            if (AUTO_OPEN_SUBSCRIPTION_PLANS) {
                autoOpenSubscriptionPlansIfNeeded();
            }
        }, 1000);
    }

    init();
})();

}
