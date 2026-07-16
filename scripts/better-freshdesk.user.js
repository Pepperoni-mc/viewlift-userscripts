// ==UserScript==
// @name         Better Freshdesk
// @namespace    https://github.com/Pepperoni-mc/viewlift-userscripts
// @version      3.14
// @author       Happy
// @description  Freshdesk improvements: auto-bold support text and emails, normalized reply spacing, shortcuts, robust CMS email lookup, canned response protection, caret placement fix, safer Apply duplicate cleanup, CMS email search, highlighted Status placement, requester email in the ticket breadcrumb, and header clutter removal.
// @match        https://viewlift.freshdesk.com/*
// @match        https://cms.viewlift.com/*
// @match        https://cms-qcp.viewlift.com/*
// @updateURL    https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-freshdesk.user.js
// @downloadURL  https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-freshdesk.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

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
}

/* ============================================================
 * Feature 5: Requester Email in Ticket Header
 * ============================================================ */

(function () {
  'use strict';

  if (location.hostname !== 'viewlift.freshdesk.com') return;

  const STYLE_ID = 'better-freshdesk-requester-email-style';
  const EMAIL_BADGE_ID = 'better-freshdesk-requester-email';
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
      }

      #${EMAIL_BADGE_ID}::before {
        content: 'â€¢' !important;
        margin-right: 7px !important;
        color: #94a3b8 !important;
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
      badge.setAttribute('title', 'Requester email');
      badge.setAttribute('aria-label', 'Requester email: ' + email);
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

    let timer = null;
    const observer = new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(removeHeaderClutter, 60);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setInterval(removeHeaderClutter, 2000);
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

    const CMS_USERS_URL = 'https://cms.viewlift.com/v5/customer-support';
    const BUTTON_ID = 'viewlift-open-cms-header-button';

    function isFreshdeskPage() {
        return location.hostname === 'viewlift.freshdesk.com';
    }

    function isCMSUsersPage() {
        return location.hostname === 'cms.viewlift.com' &&
            /^\/v5\/customer-support(?:\/|$)/i.test(location.pathname);
    }

    function cleanText(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
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

            const url = CMS_USERS_URL + '?openCmsEmail=' + encodeURIComponent(email);

            console.log('[CMS Search] Opening CMS for:', email);

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
            return cleanText(params.get('openCmsEmail') || '');
        } catch (error) {
            return '';
        }
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

    function runCMSSearch() {
        const email = getEmailFromURL();

        if (!email) {
            console.log('[CMS Search] No email in URL.');
            return false;
        }

        const input = getSearchUserInput();

        if (!input) {
            console.log('[CMS Search] Search user input not found yet.');
            return false;
        }

        input.focus();
        setNativeValue(input, email);

        const searchButton = getSearchButton();

        if (!searchButton) {
            console.log('[CMS Search] Search button not found yet.');
            return false;
        }

        realClick(searchButton, '[CMS Search] Search clicked for: ' + email);

        return true;
    }

    function scheduleCMSSearch() {
        setTimeout(runCMSSearch, 400);
        setTimeout(runCMSSearch, 900);
        setTimeout(runCMSSearch, 1500);
        setTimeout(runCMSSearch, 2500);
        setTimeout(runCMSSearch, 4000);
    }

    if (isFreshdeskPage()) {
        installHeaderButton();

        let timer = null;

        const observer = new MutationObserver(function () {
            clearTimeout(timer);

            timer = setTimeout(function () {
                installHeaderButton();
            }, 250);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setInterval(installHeaderButton, 1500);
    }

    if (isCMSUsersPage()) {
        scheduleCMSSearch();

        const observer = new MutationObserver(function () {
            runCMSSearch();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
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
    moveStatusBelowProperties();
    installObserver();

    setInterval(function () {
      moveStatusBelowProperties();
    }, 1500);
  }

  init();
})();
