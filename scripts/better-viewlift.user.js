// ==UserScript==
// @name         Better Viewlift
// @namespace    https://github.com/Pepperoni-mc/viewlift-userscripts
// @version      3.0.9
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
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_addValueChangeListener
// ==/UserScript==

(function () {
  'use strict';

  const installMarker = document.documentElement;
  if (!installMarker || installMarker.hasAttribute('data-better-viewlift-installed')) return;
  installMarker.setAttribute('data-better-viewlift-installed', '3.0.9');

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

  const CMS_HOST_RE = /^(?:cms(?:-gcp|-qcp)?\.viewlift\.com|cms\.monumentalsportsnetwork\.com)$/i;
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

  function isCMSHost() {
    return CMS_HOST_RE.test(location.hostname);
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

      if (/^https:\/\/(?:cms(?:-gcp|-qcp)?\.viewlift\.com|cms\.monumentalsportsnetwork\.com)\/users(?:\/|$)/i.test(location.href)) {
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

    const observer = new MutationObserver(function () {
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

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
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

    setInterval(handleRefundToolRouteChange, 5000);
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
    // Startup, route, focus and periodic passes cover asynchronous rendering
    // without reacting to every DOM mutation on Freshdesk and the CMS.
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

    const observer = new MutationObserver(function () {
      const select = document.getElementById(REFUNDER_SELECT_ID);
      if (select && select.dataset.betterCmsRefunderPreferenceInstalled) return;
      installRefunderPreference();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setInterval(function () {
      if (document.visibilityState === 'visible') installRefunderPreference();
    }, 8000);
  }

  initRefunderPreference();
})();



/* ============================================================
 * Feature 2: CMS Auto Fill Cancellation Reason
 * Source: ViewLift CMS auto fill cancellation reason 1.0
 * ============================================================ */


if (/^(?:cms(?:-gcp|-qcp)?\.viewlift\.com|cms\.monumentalsportsnetwork\.com)$/i.test(location.hostname)) {

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
        if (/^\/users(?:\/|$)/i.test(location.pathname)) {
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
                padding: 0 10px !important;
                border: 1px solid #475569 !important;
                border-radius: 6px !important;
                background: #475569 !important;
                color: #fff !important;
                font-size: 12px !important;
                font-weight: 600 !important;
                line-height: 30px !important;
                white-space: nowrap !important;
                cursor: pointer !important;
            }

            #${BUTTON_ID}:hover {
                border-color: #334155 !important;
                background: #334155 !important;
            }

            #${BUTTON_ID}[data-configured="no"] {
                border-color: #b45309 !important;
                background: #b45309 !important;
            }

            #${BUTTON_ID}[data-busy="yes"] {
                opacity: .72 !important;
                cursor: wait !important;
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

    function waitForAgentOptions(trigger, timeout = 3500) {
        return new Promise(resolve => {
            const startedAt = Date.now();

            function check() {
                const options = getAgentOptions(trigger);

                if (options.length || Date.now() - startedAt >= timeout) {
                    resolve(options);
                    return;
                }

                setTimeout(check, 100);
            }

            check();
        });
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

    function waitForSelectedAgent(trigger, agentName, timeout = 2500) {
        return new Promise(resolve => {
            const startedAt = Date.now();
            const expectedName = normalizeAgentName(agentName);

            function check() {
                const currentName = normalizeAgentName(getSelectedAgentText(trigger));

                if (
                    currentName === expectedName ||
                    Date.now() - startedAt >= timeout
                ) {
                    resolve(currentName === expectedName);
                    return;
                }

                setTimeout(check, 100);
            }

            check();
        });
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

    function waitForAgentUpdateButton(trigger, timeout = 2500) {
        return new Promise(resolve => {
            const startedAt = Date.now();

            function check() {
                const updateButton = findAgentUpdateButton(trigger);

                if (updateButton || Date.now() - startedAt >= timeout) {
                    resolve(updateButton);
                    return;
                }

                setTimeout(check, 100);
            }

            check();
        });
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
            }, 80);
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

    const observer = new MutationObserver(function () {
        const button = document.getElementById(BUTTON_ID);
        if (button && button.isConnected) return;
        scheduleSetAgentInstall();
    });

    observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
    });

    setInterval(function () {
        if (document.visibilityState === 'visible') installSetAgentButton();
    }, 5000);
})();


/* ============================================================
 * Feature 5: Save & End Session Form Autofill
 * Uses the customer email and Freshdesk ticket already captured
 * by the Refund Capture Tool.
 * ============================================================ */

if (/^(?:cms(?:-gcp|-qcp)?\.viewlift\.com|cms\.monumentalsportsnetwork\.com)$/i.test(location.hostname)) {

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
 * Feature 3: CMS Percentage Refund Workflow
 * Opens Refund > Percentage and prepares the Issue Refund form.
 * Completes the Issue Refund form and submits it automatically.
 * ============================================================ */

if (/^(?:cms(?:-gcp|-qcp)?\.viewlift\.com|cms\.monumentalsportsnetwork\.com)$/i.test(location.hostname)) {

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
 * Feature 3 Legacy: CMS Auto Percentage Refund After Action
 * Source: exact original standalone script, injected into page context.
 * Reason: the original script uses @grant none. Better CMS needs GM_* grants,
 * so this module is injected into the page to preserve the original behavior.
 * ============================================================ */

(function () {
    'use strict';

    if (!/^(?:cms(?:-gcp|-qcp)?\.viewlift\.com|cms\.monumentalsportsnetwork\.com)$/i.test(location.hostname)) {
        return;
    }

    // The maintained workflow above supersedes this legacy injected copy.
    if (window.__betterCmsV5PercentageRefundInstalled) {
        return;
    }

    if (/^\/users(?:\/|$)/i.test(location.pathname)) {
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


if (/^(?:cms(?:-gcp|-qcp)?\.viewlift\.com|cms\.monumentalsportsnetwork\.com)$/i.test(location.hostname)) {

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
  const PENDING_SNAPSHOT_KEY = "betterFreshdeskPendingSnapshot";

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

            const snapshotDataUrl = await blobToDataUrl(blob);
            const ticketUrl = String(GM_getValue('Refund Active Ticket', '') || '').trim() ||
                String(GM_getValue('Freshdesk ID', '') || '').trim();

            try {
                GM_setValue(PENDING_SNAPSHOT_KEY, {
                    dataUrl: snapshotDataUrl,
                    ticketUrl,
                    createdAt: Date.now()
                });
            } catch (storageError) {
                console.warn("Could not queue snapshot for Freshdesk note.", storageError);
            }

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

        setInterval(handleRouteChange, 5000);
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

        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true
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
            handleRouteChange();
            createOrMoveTools();
            updatePaymentHandlerBadge();

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
  const CANNED_RESPONSE_LOCK_ATTR = 'data-better-freshdesk-canned-response-lock';
  const CANNED_RESPONSE_GLOBAL_KEY = '__betterFreshdeskCannedResponseProtectionUntil';
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

  function normalizeEditorFont(editor) {
    normalizeEditorFormatting(editor);
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

  addEditorFontNormalizerStyles();

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
  const STYLE_ID = 'better-freshdesk-unified-toolbar-style';
  let cachedTicketPath = '';
  let cachedEmail = '';
  let directEmailAttempts = 0;
  let lastDirectEmailAttemptAt = 0;
  const CUSTOMER_EMAIL_BLOCKLIST = new Set([
    'support@livgolfplus.com',
    'sc-appsupport@spacecityhn.com',
    'customersupport@altitudeplus.com',
    'customer.support@altitudeplus.com',
    'support@altitudeplus.com',
    'noreply@viewlift.com',
    'no-reply@viewlift.com'
  ]);

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
        gap: 6px !important;
        margin-right: 8px !important;
        vertical-align: middle !important;
        z-index: 30 !important;
      }

      #${BRAND_ID}, #${EMAIL_ID} {
        display: inline-flex !important;
        align-items: center !important;
        min-height: 30px !important;
        box-sizing: border-box !important;
        white-space: nowrap !important;
        border: 1px solid #d8e0e8 !important;
        border-radius: 6px !important;
        background: #f8fafc !important;
        color: #334155 !important;
        font: 600 12px/1.2 Arial, sans-serif !important;
      }

      #${BRAND_ID} {
        padding: 0 9px !important;
        letter-spacing: .04em !important;
      }

      #${BRAND_ID}[data-brand="LIV"] { color: #166534 !important; background: #f0fdf4 !important; border-color: #bbf7d0 !important; }
      #${BRAND_ID}[data-brand="DIRT"] { color: #92400e !important; background: #fffbeb !important; border-color: #fde68a !important; }
      #${BRAND_ID}[data-brand="ALTITUDE"] { color: #1e40af !important; background: #eff6ff !important; border-color: #bfdbfe !important; }
      #${BRAND_ID}[data-brand="MSN"] { color: #581c87 !important; background: #faf5ff !important; border-color: #e9d5ff !important; }
      #${BRAND_ID}[data-brand="SCHN"] { color: #9f1239 !important; background: #fff1f2 !important; border-color: #fecdd3 !important; }
      #${BRAND_ID}[data-brand="FOX"] { color: #9a3412 !important; background: #fff7ed !important; border-color: #fed7aa !important; }

      #${EMAIL_ID} {
        max-width: 260px !important;
        padding: 0 9px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        cursor: copy !important;
        user-select: text !important;
        color: #475569 !important;
        font-weight: 500 !important;
      }

      #${EMAIL_ID}[data-copied="yes"] { color: #15803d !important; background: #f0fdf4 !important; }

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

  function getActionBar() {
    return document.querySelector('section#mainactionbar .reply-bar-top') ||
      document.querySelector('section#mainactionbar .page-actions__left');
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
    if (CUSTOMER_EMAIL_BLOCKLIST.has(email)) return '';
    if (/^(?:no-?reply|do-?not-?reply)@/i.test(email)) return '';
    return email;
  }

  function getEmail() {
    if (cachedTicketPath !== location.pathname) {
      cachedTicketPath = location.pathname;
      cachedEmail = '';
      directEmailAttempts = 0;
      lastDirectEmailAttemptAt = 0;
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
    if (candidate) {
      cachedEmail = candidate;
      return cachedEmail;
    }

    const now = Date.now();
    if (
      typeof window.__betterFreshdeskGetCustomerEmail === 'function' &&
      directEmailAttempts < 3 &&
      now - lastDirectEmailAttemptAt >= 2000
    ) {
      directEmailAttempts += 1;
      lastDirectEmailAttemptAt = now;
      const direct = normalizeCustomerEmail(window.__betterFreshdeskGetCustomerEmail());
      if (direct) cachedEmail = direct;
    }

    return cachedEmail;
  }

  function copyText(text, element) {
    if (!text) return;
    const done = () => {
      element.dataset.copied = 'yes';
      element.title = 'Copied to clipboard';
      window.setTimeout(() => {
        if (element.isConnected) {
          delete element.dataset.copied;
          element.title = 'Click to copy customer email';
        }
      }, 1200);
    };

    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, 'text');
        done();
        return;
      }
    } catch (error) { /* use browser fallback */ }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {});
    }
  }

  function makeButton(id, text, title) {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.textContent = text;
    button.title = title;
    return button;
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
    const actionBar = getActionBar();
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

    let email = document.getElementById(EMAIL_ID);
    if (!email) {
      email = document.createElement('button');
      email.id = EMAIL_ID;
      email.type = 'button';
      email.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        copyText(email.dataset.email || email.textContent, email);
      });
    }
    const customerEmail = getEmail();
    const emailLabel = customerEmail || 'No email';
    if (email.textContent !== emailLabel) email.textContent = emailLabel;
    if (email.dataset.email !== customerEmail) email.dataset.email = customerEmail;
    const emailTitle = customerEmail ? 'Click to copy customer email' : 'Customer email not found';
    if (email.title !== emailTitle) email.title = emailTitle;

    const cms = document.getElementById('viewlift-open-cms-header-button');
    const agent = document.getElementById('better-freshdesk-my-agent-button');

    // These legacy toolbar controls are intentionally removed. Delete any
    // copies left behind by an older Better ViewLift version as well.
    document.getElementById('better-freshdesk-next-case')?.remove();
    document.getElementById('better-freshdesk-refund-launcher')?.remove();

    const orderedControls = [brand, cms, email, agent].filter(Boolean);
    const currentControls = Array.from(toolbar.children).filter(element => orderedControls.includes(element));
    const orderIsCorrect = orderedControls.length === currentControls.length &&
      orderedControls.every((element, index) => currentControls[index] === element);

    if (!orderIsCorrect) {
      orderedControls.forEach(element => toolbar.appendChild(element));
    }

    mountRefundPanel(toolbar);
  }

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
      if (
        toolbar &&
        toolbar.isConnected &&
        cachedTicketPath === location.pathname &&
        document.getElementById(BRAND_ID) &&
        document.getElementById(EMAIL_ID)
      ) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(installToolbar, 250);
    };

    const observer = new MutationObserver(scheduleInstall);
    observer.observe(document.body, { childList: true, subtree: true });
    window.setInterval(() => {
      if (document.visibilityState === 'visible') installToolbar();
    }, 8000);
  }

  init();
})();

/* ============================================================
 * Feature 8b: Ticket Tracker goal badge (removed)
 * Reads the private tracker API and shows today's progress in Freshdesk.
 * ============================================================ */

(function () {
  'use strict';

  // Ticket Tracker integration removed from Better Freshdesk.
  return;

  if (location.hostname !== 'viewlift.freshdesk.com') return;
  if (!/^\/a\/tickets\/\d+(?:\/|$)/i.test(location.pathname)) return;

  const API_URL = 'http://135.181.37.72:3001/api/ticket-tracker/stats';
  const CACHE_KEY = 'schnTrackerProgress';
  const KEY_NAME = 'betterFreshdeskTrackerApiKey';
  const BADGE_ID = 'better-freshdesk-tracker-goal';
  const STYLE_ID = 'better-freshdesk-tracker-style';
  const REFRESH_MS = 30000;

  function clean(value) { return String(value == null ? '' : value).trim(); }

  // Use the same legacy key name as SCHN+ Case Tracker when values are shared.
  function getStoredTrackerKey() {
    return clean(GM_getValue(KEY_NAME, '')) || clean(GM_getValue('api_key', ''));
  }

  function getCachedProgress() {
    try {
      const value = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      const today = new Date().toISOString().slice(0, 10);
      if (!value || value.date !== today) return null;
      return { today: Number(value.count) || 0, goal: Number(value.goal) || 35 };
    } catch (_) {
      return null;
    }
  }

  function setTrackerApiKey() {
    const current = getStoredTrackerKey();
    const value = window.prompt('Tracker API key (se guarda solo en Tampermonkey):', current);
    if (value === null) return;
    const next = clean(value);
    if (next) {
      GM_setValue(KEY_NAME, next);
      GM_setValue('api_key', next);
    } else {
      GM_deleteValue(KEY_NAME);
      GM_deleteValue('api_key');
    }
    updateStats();
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Set Tracker API Key', setTrackerApiKey);
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BADGE_ID} { display:inline-flex; align-items:center; gap:6px; min-height:30px; margin-left:8px; padding:0 10px; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc; color:#334155; font:600 12px/1.2 Arial,sans-serif; white-space:nowrap; cursor:pointer; }
      #${BADGE_ID}[data-state="goal"] { color:#166534; background:#f0fdf4; border-color:#bbf7d0; }
      #${BADGE_ID}[data-state="error"] { color:#92400e; background:#fffbeb; border-color:#fde68a; }
    `;
    document.head.appendChild(style);
  }

  function findRightSlot() {
    return document.querySelector('section#mainactionbar .page-actions__right') ||
      document.querySelector('section#mainactionbar .detail-pagination') ||
      document.querySelector('section#mainactionbar .page-actions') ||
      document.querySelector('section#mainactionbar');
  }

  function installBadge() {
    addStyles();
    const slot = findRightSlot();
    if (!slot) return null;
    let badge = document.getElementById(BADGE_ID);
    if (!badge) {
      badge = document.createElement('button');
      badge.id = BADGE_ID;
      badge.type = 'button';
      badge.title = 'Open Ticket Tracker';
      badge.addEventListener('click', () => {
        if (!getStoredTrackerKey()) {
          setTrackerApiKey();
          return;
        }
        window.open('http://135.181.37.72:3001/tracker', '_blank');
      });
    }
    if (badge.parentElement !== slot) slot.appendChild(badge);
    return badge;
  }

  function render(text, state, title) {
    const badge = installBadge();
    if (!badge) return;
    badge.textContent = text;
    badge.dataset.state = state || '';
    badge.title = title || 'Open Ticket Tracker';
  }

  function updateStats() {
    const cached = getCachedProgress();
    if (!cached) {
      render('Tracker: —', '', 'Instala/activa SCHN+ Case Tracker 1.5; el contador aparecerá al registrar el próximo ticket.');
      return;
    }
    render(cached.today + ' / ' + cached.goal + ' goal', cached.today >= cached.goal ? 'goal' : '', 'Ticket Tracker local: ' + cached.today + ' de ' + cached.goal);
  }

  function init() {
    if (!document.body) return window.setTimeout(init, 300);
    installBadge();
    updateStats();
    const observer = new MutationObserver(() => installBadge());
    observer.observe(document.body, { childList: true, subtree: true });
    window.setInterval(() => { installBadge(); updateStats(); }, REFRESH_MS);
    window.addEventListener('focus', updateStats);
  }

  init();
})();

/* ============================================================
 * Feature 9: Queue CMS snapshots into a private note
 * ============================================================ */

(function () {
  'use strict';

  if (location.hostname !== 'viewlift.freshdesk.com') return;

  if (!/^\/a\/tickets\/\d+(?:\/|$)/i.test(location.pathname)) return;

  const SNAPSHOT_KEY = 'betterFreshdeskPendingSnapshot';
  const STATUS_ID = 'better-freshdesk-snapshot-note-status';

  function cleanText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function getTicketId() {
    const match = location.pathname.match(/\/a\/tickets\/(\d+)/i);
    return match ? match[1] : '';
  }

  function getPendingSnapshot() {
    try {
      const value = GM_getValue(SNAPSHOT_KEY, null);
      if (!value) return null;
      if (typeof value === 'string') return JSON.parse(value);
      return value;
    } catch (error) {
      console.warn('[Freshdesk Snapshot] Could not read queued snapshot.', error);
      return null;
    }
  }

  function getPendingTicketId(snapshot) {
    const match = String(snapshot && snapshot.ticketUrl || '').match(/\/tickets\/(\d+)/i);
    return match ? match[1] : '';
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

    await new Promise(resolve => setTimeout(resolve, 400));

    if (!editor.querySelector('img')) {
      editor.innerHTML = `${editor.innerHTML || ''}<p><img src="${dataUrl}" alt="CMS snapshot" style="max-width:100%;height:auto;"></p>`;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
    }

    return true;
  }

  async function consumeSnapshotIfReady() {
    const snapshot = getPendingSnapshot();
    if (!snapshot || !snapshot.dataUrl) return;

    const ticketId = getTicketId();
    if (!ticketId || getPendingTicketId(snapshot) !== ticketId) return;

    if (!findEditor()) {
      clickPrivateNote();
      window.setTimeout(consumeSnapshotIfReady, 700);
      return;
    }

    try {
      if (await pasteSnapshot(snapshot)) {
        GM_deleteValue(SNAPSHOT_KEY);
        showStatus('CMS snapshot added to private note.');
      }
    } catch (error) {
      console.error('[Freshdesk Snapshot] Could not add snapshot to note.', error);
      showStatus('Could not add CMS snapshot to the note.', 'error');
    }
  }

  function init() {
    if (!document.body) {
      window.setTimeout(init, 300);
      return;
    }

    window.setTimeout(consumeSnapshotIfReady, 900);
    window.setInterval(consumeSnapshotIfReady, 2500);
  }

  init();
})();
}

/* ============================================================
 * Feature 5: Requester Email in Ticket Header
 * ============================================================ */

(function () {
  'use strict';

  if (location.hostname !== 'viewlift.freshdesk.com') return;

  // Superseded by the cached email control in the unified action bar.
  return;

  const STYLE_ID = 'better-freshdesk-requester-email-style';
  const EMAIL_BADGE_ID = 'better-freshdesk-requester-email';
  const COPY_FEEDBACK_ID = 'better-freshdesk-copy-feedback';
  const TICKET_PATH_PATTERN = /\/a\/tickets\/(\d+)/i;
  const CUSTOMER_EMAIL_BLOCKLIST = new Set([
    'support@livgolfplus.com',
    'sc-appsupport@spacecityhn.com',
    'customersupport@altitudeplus.com',
    'customer.support@altitudeplus.com',
    'support@altitudeplus.com',
    'noreply@viewlift.com',
    'no-reply@viewlift.com'
  ]);

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
      #${EMAIL_BADGE_ID} {
        display: inline-flex !important;
        align-items: center !important;
        max-width: min(360px, 42vw) !important;
        margin-left: 10px !important;
        color: #475569 !important;
        font-size: 12px !important;
        font-weight: 500 !important;
        line-height: 1.35 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        vertical-align: middle !important;
        cursor: copy !important;
        user-select: text !important;
      }

      #${EMAIL_BADGE_ID}[data-copied="yes"] {
        color: #15803d !important;
      }

      #${COPY_FEEDBACK_ID} {
        display: inline-flex !important;
        margin-left: 6px !important;
        color: #15803d !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        line-height: 1.35 !important;
        white-space: nowrap !important;
        vertical-align: middle !important;
      }
    `;

    document.head.appendChild(style);
  }

  function getTicketId() {
    const match = location.pathname.match(TICKET_PATH_PATTERN);
    return match ? match[1] : '';
  }

  function extractEmails(value) {
    return String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  }

  function isCustomerEmail(email) {
    const normalized = cleanText(email).toLowerCase();

    return Boolean(
      normalized &&
      !CUSTOMER_EMAIL_BLOCKLIST.has(normalized) &&
      !/^(noreply|no-reply|donotreply|do-not-reply)@/i.test(normalized)
    );
  }

  function addEmailCandidate(candidates, email, score) {
    const normalized = cleanText(email).toLowerCase();

    if (!isCustomerEmail(normalized)) return;

    const existing = candidates.get(normalized);
    if (!existing || score > existing.score) {
      candidates.set(normalized, { email: normalized, score });
    }
  }

  function getRequesterEmail() {
    const candidates = new Map();

    if (typeof window.__betterFreshdeskGetCustomerEmail === 'function') {
      addEmailCandidate(candidates, window.__betterFreshdeskGetCustomerEmail(), 180);
    }

    document.querySelectorAll('a[href^="mailto:" i]').forEach(function (link) {
      const href = link.getAttribute('href') || '';
      const email = decodeURIComponent(href.replace(/^mailto:/i, '').split('?')[0]);
      extractEmails(email).forEach(function (match) {
        addEmailCandidate(candidates, match, 120);
      });
    });

    const prioritySelector = [
      '[data-test-id*="email" i]',
      '[data-testid*="email" i]',
      '[class*="email" i]',
      '[class*="contact" i]'
    ].join(',');

    document.querySelectorAll(prioritySelector).forEach(function (element) {
      if (element.closest('#' + EMAIL_BADGE_ID)) return;

      const attributes = [
        element.getAttribute('data-test-id'),
        element.getAttribute('data-testid'),
        element.className
      ].filter(Boolean).join(' ').toLowerCase();

      const score = /email/.test(attributes) ? 105 : 90;
      extractEmails(element.textContent).forEach(function (match) {
        addEmailCandidate(candidates, match, score);
      });
    });

    const lines = String(document.body && document.body.innerText || '')
      .split(/\r?\n/)
      .map(cleanText)
      .filter(Boolean);

    lines.forEach(function (line) {
      const emails = extractEmails(line);
      if (!emails.length) return;

      const isContactLine = /^(to|from|email|e-mail)\s*:/i.test(line);
      const score = isContactLine ? 100 : 45;

      emails.forEach(function (match) {
        addEmailCandidate(candidates, match, score);
      });
    });

    const best = Array.from(candidates.values())
      .sort(function (left, right) {
        return right.score - left.score;
      })[0];

    return best ? best.email : '';
  }

  function getHeaderTicketIdElement(ticketId) {
    const breadcrumbId = document.querySelector('[data-test-id="breadcrumb-item"]');

    if (
      breadcrumbId &&
      cleanText(breadcrumbId.textContent) === ticketId &&
      !breadcrumbId.closest('#' + EMAIL_BADGE_ID)
    ) {
      return breadcrumbId;
    }

    const ticketHrefPattern = new RegExp('/a/tickets/' + ticketId + '(?:[/?#]|$)', 'i');
    const exactMatches = Array.from(document.querySelectorAll('a, button, span, div, p'))
      .filter(function (element) {
        if (!isVisible(element)) return false;
        if (element.closest('#' + EMAIL_BADGE_ID)) return false;
        return cleanText(element.textContent) === ticketId;
      });

    const ranked = exactMatches.map(function (element) {
      const href = element.getAttribute('href') || '';
      let score = 0;

      if (element.matches('a')) score += 50;
      if (ticketHrefPattern.test(href)) score += 200;
      if (element.parentElement && element.parentElement.matches('a')) score += 160;

      const rect = element.getBoundingClientRect();
      if (rect.width < 180 && rect.height < 50) score += 20;

      return { element, score };
    }).sort(function (left, right) {
      return right.score - left.score;
    });

    if (!ranked.length) return null;

    const best = ranked[0].element;
    return best.matches('a') ? best : best.closest('a') || best;
  }

  function removeEmailBadge() {
    document.querySelectorAll('#' + EMAIL_BADGE_ID).forEach(function (badge) {
      badge.remove();
    });

    document.querySelectorAll('#' + COPY_FEEDBACK_ID).forEach(function (feedback) {
      feedback.remove();
    });
  }

  function fallbackCopyToClipboard(text) {
    const textarea = document.createElement('textarea');

    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    let copied = false;

    try {
      copied = document.execCommand('copy');
    } catch (error) {
      copied = false;
    }

    textarea.remove();
    return copied;
  }

  function showCopiedFeedback(badge) {
    badge.setAttribute('title', 'Copied to clipboard');
    badge.setAttribute('data-copied', 'yes');

    document.querySelectorAll('#' + COPY_FEEDBACK_ID).forEach(function (feedback) {
      feedback.remove();
    });

    const feedback = document.createElement('span');
    feedback.id = COPY_FEEDBACK_ID;
    feedback.textContent = 'Copied';
    feedback.setAttribute('role', 'status');
    badge.insertAdjacentElement('afterend', feedback);

    window.setTimeout(function () {
      if (!badge.isConnected) return;

      badge.setAttribute('title', 'Click to copy requester email');
      badge.removeAttribute('data-copied');
      feedback.remove();
    }, 1200);
  }

  function copyEmailToClipboard(email, badge) {
    if (!email) return;

    if (typeof GM_setClipboard === 'function') {
      try {
        GM_setClipboard(email, 'text');
        showCopiedFeedback(badge);
        return;
      } catch (error) {
        // Continue with the browser clipboard fallbacks.
      }
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(email)
        .then(function () {
          showCopiedFeedback(badge);
        })
        .catch(function () {
          if (fallbackCopyToClipboard(email)) {
            showCopiedFeedback(badge);
          }
        });

      return;
    }

    if (fallbackCopyToClipboard(email)) {
      showCopiedFeedback(badge);
    }
  }

  function renderRequesterEmail() {
    const ticketId = getTicketId();

    if (!ticketId) {
      removeEmailBadge();
      return;
    }

    const ticketIdElement = getHeaderTicketIdElement(ticketId);
    if (!ticketIdElement) return;

    const email = getRequesterEmail();
    if (!email) {
      removeEmailBadge();
      return;
    }

    let badge = document.getElementById(EMAIL_BADGE_ID);

    if (!badge) {
      badge = document.createElement('span');
      badge.id = EMAIL_BADGE_ID;
      badge.setAttribute('title', 'Click to copy requester email');
      badge.setAttribute('aria-label', 'Requester email: ' + email);

      badge.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        copyEmailToClipboard(badge.textContent, badge);
      });
    }

    badge.textContent = email;
    badge.setAttribute('aria-label', 'Requester email: ' + email);

    if (badge.parentElement !== ticketIdElement.parentElement || badge.previousElementSibling !== ticketIdElement) {
      badge.remove();
      ticketIdElement.insertAdjacentElement('afterend', badge);
    }
  }

  function init() {
    if (!document.body) {
      setTimeout(init, 300);
      return;
    }

    addStyles();

    let timer = null;
    const scheduleRender = function () {
      clearTimeout(timer);
      timer = setTimeout(renderRequesterEmail, 180);
    };

    scheduleRender();

    const observer = new MutationObserver(scheduleRender);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    setInterval(renderRequesterEmail, 1500);
  }

  init();
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
      .trigger-button-container:has(#omnibar-trigger-button) {
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
    [500, 1500, 3500].forEach(function (delay) {
      setTimeout(removeHeaderClutter, delay);
    });
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
    const CANNED_RESPONSE_LOCK_ATTR = 'data-better-freshdesk-canned-response-lock';
    const CANNED_RESPONSE_GLOBAL_KEY = '__betterFreshdeskCannedResponseProtectionUntil';
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
        if (!hasPendingReplyShortcut()) return;

        const editor = getNewestVisibleEditor();

        if (!editor) {
            return;
        }

        pendingReplyShortcutHandled = true;
        shouldRemoveQuotedMarker = true;
        markForceRewrite('reply-shortcut');
        scheduleClean();
    }

    function handleReplyShortcutKeydown(event) {
        if (!isReplyShortcut(event)) return;

        markPendingReplyShortcut();

        window.setTimeout(runReplyShortcutCleanupWhenEditorAppears, 250);
        window.setTimeout(runReplyShortcutCleanupWhenEditorAppears, 700);
        window.setTimeout(runReplyShortcutCleanupWhenEditorAppears, 1200);
        window.setTimeout(runReplyShortcutCleanupWhenEditorAppears, 2000);
        window.setTimeout(runReplyShortcutCleanupWhenEditorAppears, 3500);
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

    function handleSummaryShortcutKeydown(event) {
        if (!isSummaryShortcut(event)) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        if (clickSummaryButtonFromShortcut()) return;

        window.setTimeout(clickSummaryButtonFromShortcut, 100);
        window.setTimeout(clickSummaryButtonFromShortcut, 300);
        window.setTimeout(clickSummaryButtonFromShortcut, 700);
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
    const CMS_HOST_RE = /^(?:cms(?:-gcp|-qcp)?\.viewlift\.com|cms\.monumentalsportsnetwork\.com)$/i;
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
        return CMS_HOST_RE.test(location.hostname) &&
            /^\/users\/search(?:\/|$)/i.test(location.pathname);
    }

    function isCMSPage() {
        return CMS_HOST_RE.test(location.hostname) &&
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

        if (/\baltitude\b|\bdirt\s*vision\b|\bdirtvision\b|\bvegas\s+golden\s+knights\b|\bvgk\b/i.test(normalized)) {
            return 'standard';
        }

        return '';
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

    function isBlockedCmsSearchEmail(email) {
        const lower = cleanText(email).toLowerCase();

        if (!lower) return true;

        return CMS_SEARCH_BLOCKED_EMAILS.some(blocked => lower === blocked || lower.includes(blocked));
    }

    function extractBestCustomerEmailFromText(text) {
        const matches = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];

        for (const match of matches) {
            const email = cleanText(match);

            if (email && !isBlockedCmsSearchEmail(email)) {
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

        if (fallbackEmail) {
            return fallbackEmail;
        }

        console.log('[CMS Search] Contact info email not found. Checked break-all nodes, mailto links, contact roots, shadow DOM, and visible ticket text.');

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

    function styleHeaderButton(button) {
        button.className = 'nucleus-button nucleus-button--secondary app-icon-btn--text hint--rounded hint--bottom';
        button.type = 'button';
        button.setAttribute('aria-label', 'Open CMS user search');
        button.setAttribute('data-viewlift-open-cms-header', 'yes');

        button.style.marginRight = '6px';
        button.style.height = '32px';
        button.style.padding = '0 10px';
        button.style.border = '1px solid #0b5cab';
        button.style.borderRadius = '6px';
        button.style.background = '#0b5cab';
        button.style.color = '#ffffff';
        button.style.fontSize = '12px';
        button.style.fontWeight = '600';
        button.style.cursor = 'pointer';
        button.style.display = 'inline-flex';
        button.style.alignItems = 'center';
        button.style.gap = '4px';
    }

    function installHeaderButton() {
        if (!isFreshdeskPage()) return;

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
            const cmsUsersURL = getCMSUsersURLForClient(clientContext);
            const url = cmsUsersURL + '?' + CMS_EMAIL_PARAM + '=' + encodeURIComponent(email);

            console.log('[CMS Search] Opening CMS for:', email, 'Client context:', clientContext.primary || 'Unknown', 'Destination:', cmsUsersURL);

            window.open(url, '_blank');
        });

        insertionPoint.insertAdjacentElement('beforebegin', button);

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

        if (descriptor && descriptor.set) {
            descriptor.set.call(element, value);
        } else {
            element.value = value;
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

            return storedEmail && !isBlockedCmsSearchEmail(storedEmail)
                ? storedEmail
                : '';
        } catch (error) {
            return '';
        }
    }

    function clearPendingCMSRequest() {
        try {
            sessionStorage.removeItem(CMS_PENDING_EMAIL_KEY);
        } catch (error) {
            console.warn('[CMS Search] Could not clear the pending email.', error);
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

                return text.includes('search user') || text.includes('search');
            })[0] || null;
    }

    function getSearchButton() {
        return Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(isVisible)
            .find(button => {
                const text = cleanText(button.innerText || button.textContent || '').toLowerCase();

                return text === 'search';
            }) || null;
    }

    function stopCMSFlow() {
        clearTimeout(cmsFlowTimer);

        if (cmsFlowObserver) {
            cmsFlowObserver.disconnect();
            cmsFlowObserver = null;
        }
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

            const searchButton = getSearchButton();
            let searchTriggered = false;

            if (searchButton) {
                searchTriggered = realClick(
                    searchButton,
                    '[CMS Search] Search clicked once for: ' + email
                );
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

    function scheduleCMSFlow(delay = 200) {
        if (cmsSearchCompleted) return;

        clearTimeout(cmsFlowTimer);
        cmsFlowTimer = setTimeout(runCMSFlow, delay);
    }

    if (isFreshdeskPage()) {
        installHeaderButton();

        let timer = null;

        const observer = new MutationObserver(function () {
            if (document.getElementById(BUTTON_ID)) return;
            clearTimeout(timer);

            timer = setTimeout(function () {
                installHeaderButton();
            }, 250);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setInterval(function () {
            if (document.visibilityState === 'visible') installHeaderButton();
        }, 5000);
    }

    if (isCMSPage()) {
        getPendingCMSEmail();
        scheduleCMSFlow(250);

        cmsFlowObserver = new MutationObserver(function () {
            scheduleCMSFlow(200);
        });

        cmsFlowObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(runCMSFlow, 700);
        setTimeout(runCMSFlow, 1500);
        setTimeout(runCMSFlow, 3000);
        setTimeout(runCMSFlow, 5000);
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

    const observer = new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        moveStatusBelowProperties();
      }, 120);
    });

    observer.observe(getPropertiesPanel(), {
      childList: true,
      subtree: true
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

    setInterval(function () {
      if (document.visibilityState === 'visible') moveStatusBelowProperties();
    }, 8000);
  }

  init();
})();
  })();
})();
