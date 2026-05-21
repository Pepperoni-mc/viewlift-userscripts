// ==UserScript==
// @name         Better Freshdesk
// @namespace    https://github.com/Pepperoni-mc/viewlift-userscripts
// @version      1.5
// @author       Happy
// @description  Freshdesk improvements: auto-bold support text, clean replies after Apply, CMS email search, and custom Status picker.
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

  function getEditor(element) {
    if (!element || !element.closest) return null;
    return element.closest('[contenteditable="true"]');
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
    return /(^|[\r\n])(\s*)(The Technical Support Team)\b|(Technical Support Team)|(Regards,)/gi;
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

      if (match[3]) {
        const linePrefix = (match[1] || "") + (match[2] || "");

        if (linePrefix) {
          fragment.appendChild(document.createTextNode(linePrefix));
        }

        fragment.appendChild(makeBoldNode(match[3]));
      } else {
        fragment.appendChild(makeBoldNode(match[0]));
      }

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
    } finally {
      processing.delete(editor);
    }
  }

  function handleChange(event) {
    const editor = getEditor(event.target);

    if (!editor) return;

    window.setTimeout(function () {
      processEditor(editor);
    }, 50);
  }

  function scanEditors() {
    document.querySelectorAll('[contenteditable="true"]').forEach(function (editor) {
      processEditor(editor);
    });
  }

  document.addEventListener("input", handleChange, true);
  document.addEventListener("paste", handleChange, true);
  document.addEventListener("keyup", handleChange, true);

  window.setInterval(scanEditors, 1500);
})();
}

/* ============================================================
 * Feature 2: Freshdesk Clean Reply After Apply
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

    function splitQuotedThread(text) {
        const quotePatterns = [
            /^On .+ wrote:\s*$/im,
            /^El .+ escribió:\s*$/im,
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

        const greetingRegex = /^(hello|hi|dear|hola|buenos días|buenas tardes|good morning|good afternoon)\b.*[,]?$/i;

        if (firstLine === secondLine && greetingRegex.test(firstLine)) {
            lines.splice(secondIndex, 1);
        }

        return lines.join('\n');
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

        const parts = splitQuotedThread(text);

        let reply = parts.reply
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        reply = removeDuplicateGreeting(reply);
        reply = removeDuplicateParagraphs(reply);

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

    function textToFreshdeskHtml(text) {
        return text
            .split(/\n{2,}/)
            .map(paragraph => {
                const cleanParagraph = escapeHtml(paragraph.trim()).replace(/\n/g, '<br>');
                return `<div>${cleanParagraph}</div>`;
            })
            .join('<div><br></div>');
    }

    function cleanCurrentEditor() {
        const editor = getEditor();

        if (!editor) {
            console.log('[Freshdesk Cleaner] No editor found');
            return;
        }

        const originalText = editor.innerText || editor.textContent || '';
        const cleanedText = cleanReplyText(originalText);

        if (!cleanedText || cleanedText === originalText.trim()) {
            return;
        }

        editor.innerHTML = textToFreshdeskHtml(cleanedText);

        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        editor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

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

    function scheduleClean() {
        setTimeout(tryClickRemoveButton, 300);
        setTimeout(tryClickRemoveButton, 800);
        setTimeout(tryClickRemoveButton, 1500);
        setTimeout(tryClickRemoveButton, 2500);

        setTimeout(cleanCurrentEditor, 400);
        setTimeout(cleanCurrentEditor, 900);
        setTimeout(cleanCurrentEditor, 1600);
        setTimeout(cleanCurrentEditor, 2600);
    }

    document.addEventListener('focusin', function (event) {
        if (event.target && event.target.isContentEditable) {
            lastEditor = event.target;
        }
    }, true);

    document.addEventListener('click', function (event) {
        const replyBox = event.target.closest(replyBoxSelector);

        if (replyBox) {
            shouldRemoveQuotedMarker = true;
            scheduleClean();
            return;
        }

        if (isApplyButton(event.target)) {
            shouldRemoveQuotedMarker = true;
            scheduleClean();
        }
    }, true);

    const observer = new MutationObserver(function () {
        tryClickRemoveButton();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Manual cleanup shortcut: Ctrl + Shift + L
    document.addEventListener('keydown', function (event) {
        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'l') {
            event.preventDefault();
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

    const CMS_USERS_URL = 'https://cms.viewlift.com/users';
    const BUTTON_ID = 'viewlift-open-cms-header-button';

    function isFreshdeskPage() {
        return location.hostname === 'viewlift.freshdesk.com';
    }

    function isCMSUsersPage() {
        return location.hostname === 'cms.viewlift.com' &&
            location.pathname.startsWith('/users');
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

    function getCustomerEmailFromContactInfo() {
        const contactApps = Array.from(
            document.querySelectorAll('mfe-application[app-id="fw-unified-mfe--contact-info"]')
        );

        for (const app of contactApps) {
            const root = app.shadowRoot;

            if (!root) continue;

            const emailNodes = Array.from(root.querySelectorAll('p.break-all'));

            for (const node of emailNodes) {
                const email = extractEmailFromText(node.innerText || node.textContent || '');

                if (email) {
                    return email;
                }
            }
        }

        console.log('[CMS Search] Contact info email not found in p.break-all.');

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
                alert('No pude encontrar el email en Contact info. Abre Contact info y vuelve a intentar.');
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
        const exact = document.querySelector('input[placeholder="Search user"]');

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

})();

/* ============================================================
 * Feature 4: Better Freshdesk Status Placement and Custom Status Picker
 * ============================================================ */

(function () {
  'use strict';

  if (location.hostname !== 'viewlift.freshdesk.com') return;

  const STYLE_ID = 'better-freshdesk-status-style';
  const STATUS_ROW_CLASS = 'better-freshdesk-status-row';
  const STATUS_LABEL_CLASS = 'better-freshdesk-status-label';
  const STATUS_DROPDOWN_CLASS = 'better-freshdesk-status-dropdown';
  const QUICKBAR_CLASS = 'better-freshdesk-status-quickbar';
  const QUICKBUTTON_CLASS = 'better-freshdesk-status-quickbutton';
  const OTHER_BUTTON_CLASS = 'better-freshdesk-status-other-button';
  const OTHER_LIST_CLASS = 'better-freshdesk-status-other-list';
  const NATIVE_HIDDEN_CLASS = 'better-freshdesk-native-status-list';

  const PRIORITY_STATUS_ORDER = [
    'Waiting on End User',
    'Resolved',
    'Open'
  ];

  const OTHER_STATUS_OPTIONS = [
    'Pending',
    'Closed',
    'Waiting on Customer',
    'Waiting on Review',
    'Waiting in Queue',
    'Under Development',
    'Phone Open',
    'Waiting on AI Team'
  ];

  const STATUS_HINTS = [
    ...PRIORITY_STATUS_ORDER,
    ...OTHER_STATUS_OPTIONS
  ];

  function cleanText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeText(value) {
    return cleanText(value).toLowerCase();
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

  function isTouchableForScript(element) {
    if (!element || element.nodeType !== 1) return false;

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden'
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

      .${STATUS_DROPDOWN_CLASS} {
        max-height: 360px !important;
        overflow: hidden !important;
        scrollbar-width: thin !important;
      }

      .${QUICKBAR_CLASS} {
        display: flex !important;
        flex-direction: column !important;
        gap: 4px !important;
        padding: 7px !important;
        margin: 0 !important;
        background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%) !important;
        border: 1px solid rgba(148, 163, 184, 0.22) !important;
        border-radius: 8px !important;
        box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05) !important;
      }

      .${QUICKBUTTON_CLASS} {
        width: 100% !important;
        min-height: 30px !important;
        padding: 5px 9px !important;
        border: 1px solid rgba(100, 116, 139, 0.24) !important;
        border-radius: 7px !important;
        background: #ffffff !important;
        color: #1f2937 !important;
        font-size: 12px !important;
        font-weight: 650 !important;
        text-align: left !important;
        cursor: pointer !important;
        transition: background 120ms ease, border-color 120ms ease, transform 120ms ease !important;
      }

      .${QUICKBUTTON_CLASS}:hover {
        background: #f1f5f9 !important;
        border-color: rgba(71, 85, 105, 0.42) !important;
        transform: translateY(-1px) !important;
      }

      .${QUICKBUTTON_CLASS}:active {
        transform: translateY(0) !important;
      }

      .${OTHER_BUTTON_CLASS} {
        color: #475569 !important;
        background: #f8fafc !important;
        border-style: dashed !important;
        font-weight: 700 !important;
      }

      .${OTHER_LIST_CLASS} {
        display: none !important;
        flex-direction: column !important;
        gap: 4px !important;
        margin-top: 4px !important;
        padding-top: 5px !important;
        border-top: 1px solid rgba(148, 163, 184, 0.24) !important;
        max-height: 190px !important;
        overflow-y: auto !important;
        scrollbar-width: thin !important;
      }

      .${QUICKBAR_CLASS}[data-show-other="true"] .${OTHER_LIST_CLASS} {
        display: flex !important;
      }

      .${QUICKBAR_CLASS}[data-show-other="true"] .${OTHER_BUTTON_CLASS} {
        background: #eef2ff !important;
        border-color: rgba(99, 102, 241, 0.35) !important;
        color: #3730a3 !important;
      }

      .${NATIVE_HIDDEN_CLASS} {
        position: absolute !important;
        left: -99999px !important;
        top: 0 !important;
        width: 1px !important;
        max-width: 1px !important;
        height: 180px !important;
        max-height: 180px !important;
        overflow: auto !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      .${STATUS_DROPDOWN_CLASS} [role="option"],
      .${STATUS_DROPDOWN_CLASS} [role="menuitem"],
      .${STATUS_DROPDOWN_CLASS} li {
        min-height: 34px !important;
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

  function getOptionText(element) {
    return cleanText(element.innerText || element.textContent || '');
  }

  function isStatusDropdown(dropdown) {
    if (!dropdown || !isVisible(dropdown)) return false;

    if (!dropdown.classList.contains('ticket-properties-dropdown') &&
        !dropdown.classList.contains('ember-power-select-dropdown') &&
        !dropdown.querySelector('[role="listbox"]')) {
      return false;
    }

    const text = normalizeText(dropdown.innerText || dropdown.textContent || '');

    return STATUS_HINTS.some(status => text.includes(status.toLowerCase()));
  }

  function findStatusDropdowns() {
    return Array.from(document.querySelectorAll(
      '.ticket-properties-dropdown, .ember-power-select-dropdown, .ember-basic-dropdown-content, [role="listbox"]'
    )).filter(isStatusDropdown);
  }

  function findCurrentStatusDropdown() {
    const dropdowns = findStatusDropdowns();

    if (!dropdowns.length) return null;

    return dropdowns[dropdowns.length - 1];
  }

  function findVisibleStatusOption(statusText, dropdown) {
    const wanted = normalizeText(statusText);
    const root = dropdown || document;

    return Array.from(root.querySelectorAll('li, [role="option"], [role="menuitem"]'))
      .filter(isTouchableForScript)
      .find(option => normalizeText(getOptionText(option)) === wanted) || null;
  }

  function realClick(element, logMessage) {
    if (!element || !isTouchableForScript(element)) return false;

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

  function getScrollTargets(dropdown) {
    return Array.from(new Set([
      dropdown,
      dropdown.querySelector('[role="listbox"]'),
      dropdown.querySelector('.ember-power-select-options'),
      dropdown.querySelector('[data-test-id^="vertical-options-count"]')
    ].filter(Boolean)));
  }

  function scrollTarget(target, delta) {
    try {
      target.scrollTop += delta;
      target.dispatchEvent(new Event('scroll', { bubbles: true }));
      target.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: delta,
        view: window
      }));
    } catch (error) {
      // Ignore scrolling errors.
    }
  }

  async function selectStatusOption(statusText) {
    const dropdown = findCurrentStatusDropdown();

    if (!dropdown) {
      console.log('[Better Freshdesk] Status dropdown not found.');
      return false;
    }

    dropdown.classList.add(STATUS_DROPDOWN_CLASS);

    await delay(30);

    let option = findVisibleStatusOption(statusText, dropdown);

    if (option) {
      return realClick(option, '[Better Freshdesk] Status selected: ' + statusText);
    }

    const targets = getScrollTargets(dropdown);

    for (let pass = 0; pass < 36; pass += 1) {
      targets.forEach(target => scrollTarget(target, -120));
      await delay(45);

      option = findVisibleStatusOption(statusText, dropdown);
      if (option) {
        return realClick(option, '[Better Freshdesk] Status selected: ' + statusText);
      }
    }

    for (let pass = 0; pass < 72; pass += 1) {
      targets.forEach(target => scrollTarget(target, 120));
      await delay(45);

      option = findVisibleStatusOption(statusText, dropdown);
      if (option) {
        return realClick(option, '[Better Freshdesk] Status selected: ' + statusText);
      }
    }

    console.log('[Better Freshdesk] Could not find status option:', statusText);
    return false;
  }

  function hideNativeList(dropdown) {
    const nativeContainers = Array.from(dropdown.querySelectorAll(
      '[role="listbox"], .ember-power-select-options, [data-test-id^="vertical-options-count"]'
    ));

    nativeContainers.forEach(container => {
      if (!container.closest(`.${QUICKBAR_CLASS}`)) {
        container.classList.add(NATIVE_HIDDEN_CLASS);
      }
    });
  }

  function makeStatusButton(statusText, extraClass) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = extraClass ? `${QUICKBUTTON_CLASS} ${extraClass}` : QUICKBUTTON_CLASS;
    button.textContent = statusText;
    button.setAttribute('data-better-freshdesk-status', statusText);

    button.addEventListener('mousedown', function (event) {
      event.preventDefault();
      event.stopPropagation();
    }, true);

    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      selectStatusOption(statusText);
    }, true);

    return button;
  }

  function buildQuickStatusBar(dropdown) {
    if (!dropdown || dropdown.querySelector(`.${QUICKBAR_CLASS}`)) return;

    const bar = document.createElement('div');
    bar.className = QUICKBAR_CLASS;
    bar.setAttribute('data-show-other', 'false');

    PRIORITY_STATUS_ORDER.forEach(status => {
      bar.appendChild(makeStatusButton(status));
    });

    const otherButton = document.createElement('button');
    otherButton.type = 'button';
    otherButton.className = `${QUICKBUTTON_CLASS} ${OTHER_BUTTON_CLASS}`;
    otherButton.textContent = 'Other';
    otherButton.setAttribute('data-better-freshdesk-status-other', 'true');

    otherButton.addEventListener('mousedown', function (event) {
      event.preventDefault();
      event.stopPropagation();
    }, true);

    otherButton.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();

      const isShowing = bar.getAttribute('data-show-other') === 'true';
      bar.setAttribute('data-show-other', isShowing ? 'false' : 'true');
      otherButton.textContent = isShowing ? 'Other' : 'Hide other statuses';
    }, true);

    bar.appendChild(otherButton);

    const otherList = document.createElement('div');
    otherList.className = OTHER_LIST_CLASS;

    OTHER_STATUS_OPTIONS.forEach(status => {
      otherList.appendChild(makeStatusButton(status));
    });

    bar.appendChild(otherList);

    dropdown.prepend(bar);
  }

  function enhanceStatusDropdowns() {
    const dropdowns = findStatusDropdowns();

    dropdowns.forEach(dropdown => {
      dropdown.classList.add(STATUS_DROPDOWN_CLASS);
      buildQuickStatusBar(dropdown);
      hideNativeList(dropdown);
    });
  }

  function scheduleDropdownEnhancement() {
    setTimeout(enhanceStatusDropdowns, 30);
    setTimeout(enhanceStatusDropdowns, 120);
    setTimeout(enhanceStatusDropdowns, 300);
    setTimeout(enhanceStatusDropdowns, 700);
  }

  function installObserver() {
    let timer = null;

    const observer = new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        moveStatusBelowProperties();
        enhanceStatusDropdowns();
      }, 200);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  document.addEventListener('click', function (event) {
    const row = event.target.closest(`.${STATUS_ROW_CLASS}`);

    if (row) {
      scheduleDropdownEnhancement();
      return;
    }

    const text = normalizeText(event.target.innerText || event.target.textContent || '');

    if (text === 'status' || event.target.closest('[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="menu"], .ember-basic-dropdown-trigger')) {
      scheduleDropdownEnhancement();
    }
  }, true);

  function init() {
    if (!document.body) {
      setTimeout(init, 300);
      return;
    }

    moveStatusBelowProperties();
    enhanceStatusDropdowns();
    installObserver();

    setInterval(function () {
      moveStatusBelowProperties();
      enhanceStatusDropdowns();
    }, 1500);
  }

  init();
})();
