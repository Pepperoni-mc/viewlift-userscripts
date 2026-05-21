// ==UserScript==
// @name         Better Freshdesk
// @namespace    https://github.com/Pepperoni-mc/viewlift-userscripts
// @version      1.0
// @author       Happy
// @description  Freshdesk improvements: auto-bold support text, clean replies after Apply, and open/search CMS users from Freshdesk.
// @match        https://viewlift.freshdesk.com/*
// @match        https://cms.viewlift.com/*
// @match        https://cms-qcp.viewlift.com/*
// @updateURL    https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-freshdesk.user.js
// @downloadURL  https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-freshdesk.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  if (window.__betterFreshdeskInstalled) {
    return;
  }

  window.__betterFreshdeskInstalled = true;

  const CMS_USERS_URL = "https://cms.viewlift.com/users";
  const CMS_BUTTON_ID = "viewlift-open-cms-header-button";

  function isFreshdeskPage() {
    return location.hostname === "viewlift.freshdesk.com";
  }

  function isFreshdeskTicketPage() {
    return isFreshdeskPage() && location.pathname.startsWith("/a/tickets/");
  }

  function isCMSUsersPage() {
    return (
      /^cms(?:-qcp)?\.viewlift\.com$/i.test(location.hostname) &&
      location.pathname.startsWith("/users")
    );
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractEmailFromText(text) {
    const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? cleanText(match[0]) : "";
  }

  function isVisible(element) {
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  /*
   * Feature 1:
   * Freshdesk Auto Bold Support Text
   */

  function installAutoBoldSupportText() {
    if (!isFreshdeskTicketPage()) return;

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
      if (!isFreshdeskTicketPage()) return;

      document.querySelectorAll('[contenteditable="true"]').forEach(function (editor) {
        processEditor(editor);
      });
    }

    document.addEventListener("input", handleChange, true);
    document.addEventListener("paste", handleChange, true);
    document.addEventListener("keyup", handleChange, true);

    window.setInterval(scanEditors, 1500);
  }

  /*
   * Feature 2:
   * Freshdesk Clean Reply After Apply
   */

  function installCleanReplyAfterApply() {
    if (!isFreshdeskTicketPage()) return;

    const replyBoxSelector = 'button.editor-placeholder[data-test-id="active-editor"]';
    const removeQuotedSelector = "button.fr-quoted-marker-remove";

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
        console.log("[Better Freshdesk] Quoted marker removed");
      }
    }

    function isVisibleEditor(element) {
      if (!element) return false;

      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return (
        rect.width > 100 &&
        rect.height > 30 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    }

    function getEditor() {
      const active = document.activeElement;

      if (active && active.isContentEditable && isVisibleEditor(active)) {
        lastEditor = active;
        return active;
      }

      if (lastEditor && document.contains(lastEditor) && isVisibleEditor(lastEditor)) {
        return lastEditor;
      }

      for (const selector of editorSelectors) {
        const editors = Array.from(document.querySelectorAll(selector)).filter(isVisibleEditor);

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

        if (match && typeof match.index === "number") {
          if (firstQuoteIndex === -1 || match.index < firstQuoteIndex) {
            firstQuoteIndex = match.index;
          }
        }
      }

      if (firstQuoteIndex === -1) {
        return {
          reply: text,
          quote: ""
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
        .replace(/\s+/g, " ")
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

      return cleaned.join("\n\n");
    }

    function removeDuplicateGreeting(text) {
      const lines = text.split("\n");
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

      return lines.join("\n");
    }

    function cleanReplyText(rawText) {
      if (!rawText) return rawText;

      let text = rawText
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      const parts = splitQuotedThread(text);

      let reply = parts.reply
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      reply = removeDuplicateGreeting(reply);
      reply = removeDuplicateParagraphs(reply);

      reply = reply
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();

      const quote = parts.quote
        ? parts.quote.replace(/\n{3,}/g, "\n\n").trim()
        : "";

      return quote ? `${reply}\n\n${quote}` : reply;
    }

    function escapeHtml(text) {
      return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function textToFreshdeskHtml(text) {
      return text
        .split(/\n{2,}/)
        .map(paragraph => {
          const cleanParagraph = escapeHtml(paragraph.trim()).replace(/\n/g, "<br>");
          return `<div>${cleanParagraph}</div>`;
        })
        .join("<div><br></div>");
    }

    function cleanCurrentEditor() {
      const editor = getEditor();

      if (!editor) {
        console.log("[Better Freshdesk] No editor found");
        return;
      }

      const originalText = editor.innerText || editor.textContent || "";
      const cleanedText = cleanReplyText(originalText);

      if (!cleanedText || cleanedText === originalText.trim()) {
        return;
      }

      editor.innerHTML = textToFreshdeskHtml(cleanedText);

      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));

      console.log("[Better Freshdesk] Reply cleaned after Apply");
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
        button.getAttribute("aria-label"),
        button.getAttribute("title")
      ]
        .filter(Boolean)
        .join(" ")
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

    document.addEventListener("focusin", function (event) {
      if (event.target && event.target.isContentEditable) {
        lastEditor = event.target;
      }
    }, true);

    document.addEventListener("click", function (event) {
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

    document.addEventListener("keydown", function (event) {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        cleanCurrentEditor();
      }
    }, true);
  }

  /*
   * Feature 3:
   * Freshdesk Header CMS User Search
   */

  function installHeaderCMSSearch() {
    function getCustomerEmailFromContactInfo() {
      const contactApps = Array.from(
        document.querySelectorAll('mfe-application[app-id="fw-unified-mfe--contact-info"]')
      );

      for (const app of contactApps) {
        const root = app.shadowRoot;

        if (!root) continue;

        const emailNodes = Array.from(root.querySelectorAll("p.break-all"));

        for (const node of emailNodes) {
          const email = extractEmailFromText(node.innerText || node.textContent || "");

          if (email) {
            return email;
          }
        }
      }

      console.log("[Better Freshdesk] Contact info email not found in p.break-all.");

      return "";
    }

    function findHeaderInsertionPoint() {
      const mainActionBar = document.querySelector("section#mainactionbar");

      if (!mainActionBar) return null;

      const leftActions = mainActionBar.querySelector(".page-actions__left");

      if (!leftActions) return null;

      const replyButton = leftActions.querySelector('button[data-test-email-action="reply"]');

      return replyButton || leftActions.firstElementChild || leftActions;
    }

    function styleHeaderButton(button) {
      button.className = "nucleus-button nucleus-button--secondary app-icon-btn--text hint--rounded hint--bottom";
      button.type = "button";
      button.setAttribute("aria-label", "Open CMS user search");
      button.setAttribute("data-viewlift-open-cms-header", "yes");

      button.style.marginRight = "6px";
      button.style.height = "32px";
      button.style.padding = "0 10px";
      button.style.border = "1px solid #0b5cab";
      button.style.borderRadius = "6px";
      button.style.background = "#0b5cab";
      button.style.color = "#ffffff";
      button.style.fontSize = "12px";
      button.style.fontWeight = "600";
      button.style.cursor = "pointer";
      button.style.display = "inline-flex";
      button.style.alignItems = "center";
      button.style.gap = "4px";
    }

    function installHeaderButton() {
      if (!isFreshdeskPage()) return;

      if (document.getElementById(CMS_BUTTON_ID)) return;

      const insertionPoint = findHeaderInsertionPoint();

      if (!insertionPoint) {
        console.log("[Better Freshdesk] Freshdesk header insertion point not found yet.");
        return;
      }

      const button = document.createElement("button");

      button.id = CMS_BUTTON_ID;
      button.textContent = "CMS";

      styleHeaderButton(button);

      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();

        const email = getCustomerEmailFromContactInfo();

        if (!email) {
          alert("No pude encontrar el email en Contact info. Abre Contact info y vuelve a intentar.");
          return;
        }

        const url = CMS_USERS_URL + "?openCmsEmail=" + encodeURIComponent(email);

        console.log("[Better Freshdesk] Opening CMS for:", email);

        window.open(url, "_blank");
      });

      insertionPoint.insertAdjacentElement("beforebegin", button);

      console.log("[Better Freshdesk] Header CMS button added.");
    }

    function setNativeValue(element, value) {
      const tagName = element.tagName.toLowerCase();

      let prototype = null;

      if (tagName === "input") {
        prototype = window.HTMLInputElement.prototype;
      } else if (tagName === "textarea") {
        prototype = window.HTMLTextAreaElement.prototype;
      }

      const descriptor = prototype
        ? Object.getOwnPropertyDescriptor(prototype, "value")
        : null;

      if (descriptor && descriptor.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }

      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    }

    function realClick(element, logMessage) {
      if (!element || !isVisible(element)) return false;

      element.scrollIntoView({
        block: "center",
        inline: "center"
      });

      element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

      if (logMessage) {
        console.log(logMessage);
      }

      return true;
    }

    function getEmailFromURL() {
      try {
        const params = new URLSearchParams(location.search);
        return cleanText(params.get("openCmsEmail") || "");
      } catch (error) {
        return "";
      }
    }

    function getSearchUserInput() {
      const exact = document.querySelector('input[placeholder="Search user"]');

      if (exact && isVisible(exact)) {
        return exact;
      }

      return Array.from(document.querySelectorAll("input"))
        .filter(input => {
          if (!isVisible(input)) return false;
          if (input.disabled || input.readOnly) return false;

          const text = [
            input.getAttribute("placeholder"),
            input.getAttribute("aria-label"),
            input.getAttribute("name"),
            input.getAttribute("id")
          ].filter(Boolean).join(" ").toLowerCase();

          return text.includes("search user") || text.includes("search");
        })[0] || null;
    }

    function getSearchButton() {
      return Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(isVisible)
        .find(button => {
          const text = cleanText(button.innerText || button.textContent || "").toLowerCase();

          return text === "search";
        }) || null;
    }

    function runCMSSearch() {
      const email = getEmailFromURL();

      if (!email) {
        console.log("[Better Freshdesk] No email in CMS URL.");
        return false;
      }

      const input = getSearchUserInput();

      if (!input) {
        console.log("[Better Freshdesk] Search user input not found yet.");
        return false;
      }

      input.focus();
      setNativeValue(input, email);

      const searchButton = getSearchButton();

      if (!searchButton) {
        console.log("[Better Freshdesk] Search button not found yet.");
        return false;
      }

      realClick(searchButton, "[Better Freshdesk] Search clicked for: " + email);

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
  }

  function initBetterFreshdesk() {
    if (!document.body) {
      setTimeout(initBetterFreshdesk, 300);
      return;
    }

    installAutoBoldSupportText();
    installCleanReplyAfterApply();
    installHeaderCMSSearch();
  }

  initBetterFreshdesk();
})();
