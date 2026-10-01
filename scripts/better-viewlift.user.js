// ==UserScript==
// @name         Better Viewlift
// @namespace    https://github.com/Pepperoni-mc/viewlift-userscripts
// @version      3.80.1
// @author       Happy
// @description  Unified ViewLift toolkit for Freshdesk and CMS: case actions, CMS email search, Set Agent, refund capture, reply cleanup, screenshots, session autofill, and workflow improvements.
// @match        https://viewlift.freshdesk.com/*
// @match        https://cms.viewlift.com/*
// @match        https://cms-gcp.viewlift.com/*
// @match        https://cms-qcp.viewlift.com/*
// @match        https://foxone.cms.viewlift.com/*
// @match        https://cms.monumentalsportsnetwork.com/*
// @match        https://claude.ai/*
// @match        https://docs.google.com/spreadsheets/d/1f6uuak92FiHwq3GFUJ98IKbN9lI6BmWRfC_qcLLrcrM/*
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
// @grant        GM_openInTab
// @grant        window.close
// @grant        window.focus
// @grant        unsafeWindow
// @connect      cms.viewlift.com
// @connect      cms-gcp.viewlift.com
// @connect      cms-qcp.viewlift.com
// @connect      foxone.cms.viewlift.com
// @connect      cms.monumentalsportsnetwork.com
// @connect      viewlift.com
// @connect      viewlift.freshdesk.com
// @connect      monumentalsportsnetwork.com
// @connect      docs.google.com
// ==/UserScript==

(function () {
  'use strict';

  const installMarker = document.documentElement;
  if (!installMarker || installMarker.hasAttribute('data-better-viewlift-installed')) return;
  // Read the real version out of the metadata block instead of a hardcoded
  // string, which had been stuck at 3.26.0 for dozens of releases. It is the
  // only way to answer "which version is actually loaded?" from the page -
  // Tampermonkey updates on its own schedule, so testing a fix without being
  // able to check this wastes a whole round of "it still does not work".
  let installedVersion = 'unknown';
  try {
    installedVersion = GM_info?.script?.version || 'unknown';
  } catch (error) {
    // GM_info is not available - the marker still records that we loaded.
  }
  installMarker.setAttribute('data-better-viewlift-installed', installedVersion);

  // The refund log (and a test copy) is the ONLY Google page this script is
  // matched on, and there it does one job - write the queued refund row -
  // and nothing else of the toolkit runs. Declared before the guard so the
  // writer never touches a const that is not initialised yet.
  const BV_SHEET_ROW_QUEUE_KEY = 'betterViewliftSheetRowQueue';
  if (location.hostname === 'docs.google.com') {
    bvRunRefundSheetWriter();
    return;
  }

  /* ----------------------------------------------------------
   * Refund log writer (Google Sheets side), 2026-09-30.
   *
   * Sheets draws its grid on a canvas, but takes a paste through its hidden
   * cell input (#waffle-rich-text-editor): a ClipboardEvent carrying the row
   * tab-separated lands across the columns exactly like Ctrl+V. Proven on a
   * test sheet: pasted into A2:G2, and gviz (the server's copy) counted it.
   *
   * Never overwrites: the target row must read empty on the server, the Name
   * Box must show exactly A<row> before the paste, and the server's row count
   * must go up by one afterwards - otherwise the row stays on the clipboard
   * and the banner says why.
   * ---------------------------------------------------------- */
  function bvRunRefundSheetWriter() {
    const QUEUE_TTL_MS = 15 * 60 * 1000;
    const BANNER_ID = 'bv-refund-sheet-banner';
    const sheetId = (location.pathname.match(/\/spreadsheets\/d\/([^/]+)/) || [])[1] || '';
    let busy = false;

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const currentGid = () => (location.hash.match(/gid=(\d+)/) || location.search.match(/gid=(\d+)/) || [])[1] || '0';

    async function waitUntil(test, timeout, pollMs = 250) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeout) {
        let value = null;
        try {
          value = test();
        } catch (error) {
          value = null;
        }
        if (value) return value;
        await sleep(pollMs);
      }
      return null;
    }

    function readQueue() {
      try {
        const value = GM_getValue(BV_SHEET_ROW_QUEUE_KEY, []);
        return Array.isArray(value) ? value : [];
      } catch (error) {
        return [];
      }
    }

    function removeEntry(entry) {
      const rest = readQueue().filter(item => !(item && item.nonce === entry.nonce));
      try {
        if (rest.length) GM_setValue(BV_SHEET_ROW_QUEUE_KEY, rest);
        else GM_deleteValue(BV_SHEET_ROW_QUEUE_KEY);
      } catch (error) {
        // Worst case it expires on its own (QUEUE_TTL_MS).
      }
    }

    function banner(message, kind) {
      let node = document.getElementById(BANNER_ID);
      if (!node) {
        node = document.createElement('div');
        node.id = BANNER_ID;
        node.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;max-width:640px;padding:10px 16px;border-radius:8px;color:#fff;font:600 13px/1.4 Arial,sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.25)';
        document.body.appendChild(node);
      }
      node.textContent = message;
      node.style.background = kind === 'error' ? '#991b1b' : (kind === 'ok' ? '#166534' : '#17324d');
    }

    // The server's copy, not the canvas: gviz reads what Google has saved.
    async function gviz(gid, extra) {
      const url = `/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}&${extra}`;
      const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('gviz http-' + response.status);
      return response.text();
    }

    async function rowIsEmpty(gid, row) {
      const text = await gviz(gid, `headers=0&range=A${row}:Z${row}`);
      return !text.replace(/[",\s]/g, '');
    }

    // The last row with anything in column A OR B (2026-09-30). "count(B) + 2"
    // was wrong whenever someone left B empty on a row - 12 such rows in
    // Altitude+, 9 in MSN B2C, 6 in RootSport - so it aimed at a row that was
    // already used and every write was refused. Rows can also be left with A
    // empty (FoxOne). gviz cannot report row numbers and drops empty rows from
    // its CSV (measured on the test sheet), so the one question it answers
    // reliably - "is there anything in A:B from row X down?" - is binary
    // searched instead (~15 small queries).
    async function findLastUsedRow(gid) {
      const END = 20000;
      // Counts only - numbers, never the cells themselves. A start past the
      // tab's grid answers invalid_range, which also means "nothing below".
      const hasDataFrom = async from => {
        let text;
        try {
          text = await gviz(gid, `headers=0&range=A${from}:B${END}&tq=` + encodeURIComponent('select count(A), count(B)'));
        } catch (error) {
          if (/http-400/.test(String(error && error.message))) return false;
          throw error;
        }
        if (/invalid_range/i.test(text)) return false;
        const line = text.trim().split('\n')[1] || '';
        return (line.match(/\d+/g) || []).map(Number).some(count => count > 0);
      };
      if (!await hasDataFrom(1)) return 1;
      let low = 1;          // invariant: something at or below `low`
      let high = END + 1;   // invariant: nothing at or below `high`
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        if (await hasDataFrom(mid)) low = mid;
        else high = mid;
      }
      return low;
    }

    // First row after the last used one whose A:Z is really empty - a row
    // with only later columns filled is stepped over, never written into.
    async function findTargetRow(gid) {
      let row = (await findLastUsedRow(gid)) + 1;
      for (let step = 0; step < 5; step += 1, row += 1) {
        if (await rowIsEmpty(gid, row)) return row;
      }
      throw new Error(`no empty row found after row ${row - 5}`);
    }

    async function write(entry) {
      const gid = String(entry.gid);
      const nameBox = await waitUntil(() => document.querySelector('#t-name-box'), 30000);
      const input = await waitUntil(() => document.getElementById('waffle-rich-text-editor'), 30000);
      if (!nameBox || !input) throw new Error('the sheet did not finish loading');

      const row = await findTargetRow(gid);
      if (entry.expectedRow && entry.expectedRow !== row) {
        // Someone added a row since the tab was opened - fine: the target is
        // re-found from the sheet itself and was just checked empty.
        console.info(`[BV Refund Sheet] Expected row ${entry.expectedRow}, writing row ${row}.`);
      }

      nameBox.focus();
      nameBox.value = `A${row}`;
      nameBox.dispatchEvent(new Event('input', { bubbles: true }));
      nameBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      const placed = await waitUntil(() => (nameBox.value === `A${row}` && document.activeElement === input ? true : null), 5000, 150);
      if (!placed) throw new Error(`could not put the cursor on A${row} (Name Box says ${nameBox.value})`);

      const transfer = new DataTransfer();
      transfer.setData('text/plain', entry.row.map(cell => String(cell == null ? '' : cell).replace(/[\t\r\n]+/g, ' ')).join('\t'));
      input.focus();
      input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));

      // Saved = that exact row now reads non-empty on the server.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await sleep(750);
        if (!await rowIsEmpty(gid, row)) return row;
      }
      throw new Error(`pasted on row ${row}, but Google never saved it`);
    }

    async function run() {
      if (busy) return;
      const now = Date.now();
      const entry = readQueue().find(item =>
        item && item.sheetId === sheetId && String(item.gid) === currentGid() &&
        Array.isArray(item.row) && now - Number(item.createdAt || 0) < QUEUE_TTL_MS);
      if (!entry) return;

      busy = true;
      // Taken off the queue BEFORE writing: a retry loop that re-pasted
      // could put the same refund in twice. A failure is reported instead.
      removeEntry(entry);
      banner(`Refund log: writing the ${entry.label || 'refund'} row...`, 'info');
      try {
        const row = await write(entry);
        banner(`Refund log: row ${row} saved${entry.label ? ` (${entry.label})` : ''}.`, 'ok');
        if (entry.closeWhenDone) {
          await sleep(2500);
          try {
            window.close();
          } catch (error) {
            // Tab stays open - harmless.
          }
        }
      } catch (error) {
        console.warn('[BV Refund Sheet] Not written.', error);
        banner(`Refund log: NOT written - ${String(error && error.message || error)}. The row is on your clipboard: put the cursor on the first empty row (column A) and press Ctrl+V.`, 'error');
        try {
          GM_setClipboard(entry.row.join('\t'), 'text');
        } catch (clipboardError) {
          // Nothing more to do; the banner already explains.
        }
      } finally {
        busy = false;
      }
    }

    function start() {
      if (!document.body) {
        setTimeout(start, 300);
        return;
      }
      setTimeout(run, 1500);
      try {
        GM_addValueChangeListener(BV_SHEET_ROW_QUEUE_KEY, (_name, _old, _value, remote) => {
          if (remote) run();
        });
      } catch (error) {
        // The interval below still picks it up.
      }
      setInterval(run, 4000);
      window.addEventListener('hashchange', () => setTimeout(run, 800));
    }

    start();
  }

  // foxone.cms.viewlift.com is FOX One's own CMS instance (user-confirmed
  // 2026-09-30). It sits on viewlift.com like the others but as a deeper
  // subdomain, so the cms(-gcp|-qcp) pattern never matched it - and this one
  // predicate is what gates snapshots, refund capture, credential capture and
  // the session keep-alive, so all of them were silently off on FOX tickets.
  function isCMSHost(hostname = location.hostname) {
    return /^(?:cms(?:-gcp|-qcp)?\.viewlift\.com|foxone\.cms\.viewlift\.com|cms\.monumentalsportsnetwork\.com)$/i.test(hostname);
  }

  // Tampermonkey hands userscripts a sandboxed `window` Proxy, and
  // `new PointerEvent(type, { view: window })` throws
  // "Failed to convert value to 'Window'" on it - killing whatever function was
  // dispatching the click, mid-sequence, with an exception nobody was catching.
  //
  // This is the real reason two earlier sessions concluded "this app ignores
  // synthetic clicks on MUI components" (see memory.md, 2026-08-12/13). The
  // clicks were never ignored - they were never constructed. Confirmed live on
  // 2026-08-14 from the refund workflow's own stack trace.
  //
  // unsafeWindow is the page's real Window. Verified by construction rather
  // than assumed, because whether it is proxied depends on the grants and the
  // Tampermonkey version; `undefined` is a valid view (it means null) and every
  // consumer here tolerates it, so omitting it is the safe last resort.
  const bvEventView = (function () {
    const candidates = [];
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) candidates.push(unsafeWindow);
    } catch (error) {
      // unsafeWindow is not reachable under this grant set.
    }
    candidates.push(window);

    for (const candidate of candidates) {
      try {
        new MouseEvent('mousedown', { view: candidate });
        return candidate;
      } catch (error) {
        // Not a real Window - try the next candidate.
      }
    }

    console.warn('[Better Viewlift] No usable event view; dispatching without one.');
    return undefined;
  })();

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
  // The organizations each shared CMS host serves, by the slug its v5
  // organization picker uses (data-value of the option, and the "site"
  // cookie once switched). Read off both pickers live on 2026-10-01.
  const BV_CMS_ORGANIZATIONS = [
    { key: 'lightning', label: 'Lightning', host: 'cms-gcp.viewlift.com' },
    { key: 'liv-golf', label: 'LIV Golf', host: 'cms-gcp.viewlift.com' },
    { key: 'schn', label: 'SCHN', host: 'cms-gcp.viewlift.com' },
    { key: 'altitude', label: 'Altitude', host: 'cms.viewlift.com' },
    { key: 'dirtvision', label: 'DIRTVision', host: 'cms.viewlift.com' },
    { key: 'vegas-golden-knights', label: 'KnightTime+ (VGK)', host: 'cms.viewlift.com' }
  ];

  function bvCmsOrganizationsForHost(host) {
    const name = String(host || '').toLowerCase();
    return BV_CMS_ORGANIZATIONS.filter(item => item.host === name);
  }
  // Freshdesk queues a case here, the claude.ai side takes it. Two tabs, two
  // different hosts, one script - same shape as the CMS snapshot queue.
  const BV_CASE_TO_CLAUDE_KEY = 'betterFreshdeskCaseToClaude';
  const BV_CASE_TO_CLAUDE_TTL_MS = 3 * 60 * 1000;
  // CMS Refund Assist queues its "cancelled + refunded" summary here and the
  // ticket's own Freshdesk tab pastes it into a private note.
  const BV_REFUND_ASSIST_NOTE_KEY = 'betterViewliftRefundAssistNote';
  const BV_REFUND_ASSIST_NOTE_TTL_MS = 60 * 60 * 1000;
  // After a clean run CMS asks the ticket's tab to come to the front, and
  // waits for it to answer before closing itself.
  const BV_FOCUS_TICKET_KEY = 'betterViewliftFocusTicket';
  const BV_FOCUS_TICKET_ACK_KEY = 'betterViewliftFocusTicketAck';

  /* ----------------------------------------------------------
   * The ticket's brand, read off the ticket RECORD (2026-09-30).
   *
   * The brand chip, the refund sheet and the CMS button all used to guess
   * the brand from page text - and in a combined filter view that text is
   * the view's, not the ticket's, so they guessed wrong. The ticket itself
   * says it twice, unambiguously:
   *   1. Client Name (cf_b2b_client_name) - Sebastian: "la más acertada";
   *   2. the support inbox it came in on (email_config_id), e.g.
   *      43000168570 = sc-appsupport@spacecityhn.com.
   * Both lists read live from /api/v2/ticket_fields and /api/v2/email_configs.
   * `context` is canonical text for the CMS button's existing routing (host,
   * CMS account, multi-brand tenant), so it sees one clean brand instead of
   * the whole page.
   * ---------------------------------------------------------- */
  const BV_TICKET_BRANDS = [
    { key: 'tbl', label: 'TBL', client: /^TBL\b/i, inboxes: [43000168233], context: 'TBL Tampa Bay Lightning tampabaylightning.com' },
    { key: 'livgolf', label: 'LIV', client: /^Liv\s*Golf/i, inboxes: [43000160250], context: 'LIV Golf livgolfplus.com' },
    { key: 'schn', label: 'SCHN', client: /^SCHN/i, inboxes: [43000168570], context: 'SCHN spacecityhn.com' },
    { key: 'msn', label: 'MSN', client: /^MSN\b|monumental/i, inboxes: [43000131225, 43000162164], context: 'MSN monumentalsports.com' },
    { key: 'altitude', label: 'ALTITUDE', client: /^Altitude/i, inboxes: [43000167226], context: 'Altitude altitudeplus.com' },
    { key: 'dirt', label: 'DIRT', client: /^DIRT\s*Vision/i, inboxes: [43000166896], context: 'DIRTVision dirtvision.com' },
    { key: 'vgk', label: 'VGK', client: /^VGK\b|knight\s*time/i, inboxes: [43000162317], context: 'VGK KnightTime knighttimeplus.com' },
    { key: 'chsn', label: 'CHSN', client: /^CHSN/i, inboxes: [43000167114], context: 'CHSN chsn.com' },
    { key: 'rootsport', label: 'ROOT', client: /^Root\s*Sports?/i, inboxes: [43000167550], context: 'Root Sports rootsportsnw.com' },
    { key: 'lnp', label: 'LNP', client: /^LNP\b/i, inboxes: [43000135748], context: 'LNP legapallacanestro.com' },
    { key: 'fox', label: 'FOX', client: /^FOX\s*One/i, inboxes: [43000168571], context: 'FOX One fox.com' },
    { key: 'motv', label: 'MOTV', client: /^MOTV/i, inboxes: [43000168408], context: 'MOTV myoutdoortv.com' }
  ];
  const BV_TICKET_BRAND_STORE_KEY = 'betterViewliftTicketBrands';
  const BV_TICKET_BRAND_STORE_MAX = 60;
  const bvTicketBrandMemory = new Map();
  const bvTicketBrandPending = new Map();

  // Client Name first; the inbox only when Client Name is empty or names
  // nothing known (e.g. "ViewLift Core").
  function bvBrandFromTicketRecord(ticket) {
    const client = String(ticket && ticket.custom_fields && ticket.custom_fields.cf_b2b_client_name || '').trim();
    if (client) {
      const byClient = BV_TICKET_BRANDS.find(brand => brand.client.test(client));
      if (byClient) return Object.assign({}, byClient, { source: `Client Name "${client}"` });
    }
    const inbox = Number(ticket && ticket.email_config_id);
    const byInbox = BV_TICKET_BRANDS.find(brand => brand.inboxes.includes(inbox));
    return byInbox ? Object.assign({}, byInbox, { source: 'support inbox' }) : null;
  }

  function bvCurrentFreshdeskTicketId() {
    if (location.hostname !== 'viewlift.freshdesk.com') return '';
    const match = location.pathname.match(/^\/a\/tickets\/(\d+)/i);
    return match ? match[1] : '';
  }

  function bvReadStoredTicketBrands() {
    try {
      const value = GM_getValue(BV_TICKET_BRAND_STORE_KEY, {});
      return value && typeof value === 'object' ? value : {};
    } catch (error) {
      return {};
    }
  }

  function bvStoreTicketBrand(ticketId, brand) {
    try {
      const store = bvReadStoredTicketBrands();
      store[ticketId] = { key: brand.key, source: brand.source, at: Date.now() };
      const ids = Object.keys(store).sort((a, b) => Number(store[b].at || 0) - Number(store[a].at || 0));
      ids.slice(BV_TICKET_BRAND_STORE_MAX).forEach(id => delete store[id]);
      GM_setValue(BV_TICKET_BRAND_STORE_KEY, store);
    } catch (error) {
      // Memory still has it for this page.
    }
  }

  function bvFetchTicketRecord(ticketId) {
    // Reads work on the Freshdesk session alone (measured); anywhere else the
    // agent's own API key is the only way in.
    if (location.hostname === 'viewlift.freshdesk.com') {
      // The UI's own internal endpoint first: same fields (under "ticket"),
      // and it is NOT part of the account-wide /api/v2 limit - measured
      // 2026-09-30, it answered 200 while /api/v2 was returning 429.
      const read = (url, unwrap) => fetch(url, { credentials: 'same-origin' }).then(response => {
        if (!response.ok) throw new Error('http-' + response.status);
        return response.json();
      }).then(unwrap);
      return read(`/api/_/tickets/${ticketId}`, data => (data && data.ticket) || data)
        .catch(() => read(`/api/v2/tickets/${ticketId}`, data => data));
    }
    return new Promise((resolve, reject) => {
      freshdeskApiRequest({
        path: `/api/v2/tickets/${ticketId}`,
        onDone: (error, data) => (error ? reject(error) : resolve(data))
      });
    });
  }

  function bvResolveTicketBrand(ticketId) {
    const id = String(ticketId || '');
    if (!/^\d+$/.test(id)) return Promise.resolve(null);
    if (bvTicketBrandPending.has(id)) return bvTicketBrandPending.get(id);
    const pending = bvFetchTicketRecord(id).then(ticket => {
      const brand = bvBrandFromTicketRecord(ticket);
      bvTicketBrandMemory.set(id, brand);
      if (brand) bvStoreTicketBrand(id, brand);
      // The chip is drawn by the toolbar; redraw it now that the answer is in.
      if (typeof window.__bvReconcileFreshdeskToolbar === 'function') {
        try {
          window.__bvReconcileFreshdeskToolbar();
        } catch (error) {
          // The next route tick redraws it anyway.
        }
      }
      return brand;
    }).catch(error => {
      // No retry storm: this page falls back to the old text heuristics.
      bvTicketBrandMemory.set(id, null);
      console.warn('[Better ViewLift] Could not read the ticket to find its brand; using page text.', error);
      return null;
    }).finally(() => bvTicketBrandPending.delete(id));
    bvTicketBrandPending.set(id, pending);
    return pending;
  }

  // Synchronous answer for the callers that cannot wait: what is already
  // known (this page, or stored by any tab), else null - and the lookup is
  // started so the next call has it.
  function bvGetTicketBrand(ticketId = bvCurrentFreshdeskTicketId()) {
    const id = String(ticketId || '');
    if (!/^\d+$/.test(id)) return null;
    if (bvTicketBrandMemory.has(id)) return bvTicketBrandMemory.get(id);
    const stored = bvReadStoredTicketBrands()[id];
    const known = stored && BV_TICKET_BRANDS.find(brand => brand.key === stored.key);
    if (known) {
      const brand = Object.assign({}, known, { source: stored.source || 'stored' });
      bvTicketBrandMemory.set(id, brand);
      return brand;
    }
    bvResolveTicketBrand(id);
    return null;
  }

  // Diagnostic channel for things worth knowing about (CMS session dying,
  // a lookup falling back to a worse method). Routed to the console -
  // see bvNotify below.

  // The on-screen toasts these used to render were removed per request -
  // they piled up in the top-right corner and got in the way. The messages
  // themselves are still worth keeping, so they go to the console instead:
  // nothing is lost, nothing is in the way. Signature is unchanged so the
  // ~15 existing call sites keep working untouched.
  function bvNotify(message, options = {}) {
    const level = options.level || 'warn';
    const log = level === 'error' ? console.error : (level === 'info' ? console.info : console.warn);

    try {
      log('[Better ViewLift] ' + message);
    } catch (error) {
      // Never let a logging failure break a caller.
    }

    return null;
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

  /* ----------------------------------------------------------
   * CMS API credentials, captured from the user's own live CMS
   * session rather than hardcoded.
   *
   * Every CMS search is really a POST to <brand-api-host>/v3.0/invoke
   * wrapping /v2/admin/identity/user-search, authenticated by two request
   * headers: a per-brand "xApiKey" and a per-user "Authorization" bearer
   * token that ROTATES ROUGHLY EVERY 12 HOURS. Hardcoding either would
   * mean the token dies twice a day and every brand's key has to be
   * hunted down by hand, so instead the CMS-side capture module below
   * reads them off the CMS app's own outgoing requests as the user works,
   * and stores them for the Freshdesk side to reuse.
   *
   * These values are the user's own session credentials: they are stored
   * only in this script's private GM storage, never logged, never shown
   * in a notification, and only ever sent back to the same CMS API they
   * were captured from. Everything degrades to the old open-the-search-
   * page behaviour when they are missing or stale.
   * ---------------------------------------------------------- */
  // The API host is PER CMS HOST, not one fixed domain: cms-gcp.viewlift.com
  // talks to cms-gcp.api.viewlift.com, and MSN has its own. Measured
  // 2026-08-13 - hardcoding cms.api.viewlift.com meant the capture never
  // matched a real request and the lookup would have queried the wrong
  // backend, so the origin is recorded per brand alongside its key instead
  // of being guessed here.
  const BV_CMS_API_PATH = '/v3.0/invoke';
  const BV_CMS_CREDS_KEY = 'betterViewliftCmsApiCreds';
  // Nothing here ever *refreshes* the session token - the CMS app owns that.
  // What happens instead is re-capture: whenever the app makes an API call,
  // the capture module overwrites the stored token with whatever the app is
  // currently using, so it stays current as a side effect of normal work.
  //
  // Validity is read from the token's own "exp" claim rather than guessed
  // from how long ago it was captured. An earlier version used a flat 11h
  // age limit, written when the lifetime was believed to be ~12h; the JWT
  // was then measured at 1440 minutes (24h), so that heuristic was throwing
  // away tokens with half their life left and dropping the button back to
  // the slow path for no reason. The age limit survives only as a fallback
  // for a token that isn't a readable JWT.
  const BV_CMS_CRED_MAX_AGE_MS = 11 * 60 * 60 * 1000;
  // Treat a token as gone slightly before it really expires, so a lookup
  // can't be issued into the gap and come back as a confusing 401.
  const BV_CMS_CRED_EXPIRY_MARGIN_MS = 2 * 60 * 1000;

  // Epoch ms this token expires, or 0 when that can't be determined.
  // Reads only the "exp" claim - the value itself is never logged or stored
  // anywhere beyond the credential record it came from.
  function bvTokenExpiresAt(token) {
    try {
      const raw = String(token || '').replace(/^Bearer\s+/i, '');
      const parts = raw.split('.');
      if (parts.length !== 3) return 0;

      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload && payload.exp ? Number(payload.exp) * 1000 : 0;
    } catch (error) {
      return 0;
    }
  }

  function bvCredsAreLive(auth) {
    if (!auth || !auth.value) return false;

    const expiresAt = bvTokenExpiresAt(auth.value);
    if (expiresAt) return Date.now() < expiresAt - BV_CMS_CRED_EXPIRY_MARGIN_MS;

    return Date.now() - Number(auth.capturedAt || 0) <= BV_CMS_CRED_MAX_AGE_MS;
  }

  function bvGetCmsCreds() {
    try {
      const raw = GM_getValue(BV_CMS_CREDS_KEY, '');
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object') return { sites: {}, hostSites: {} };
      parsed.sites = parsed.sites || {};
      parsed.hostSites = parsed.hostSites || {};
      return parsed;
    } catch (error) {
      return { sites: {}, hostSites: {} };
    }
  }

  function bvSaveCmsCreds(creds) {
    try {
      GM_setValue(BV_CMS_CREDS_KEY, JSON.stringify(creds));
    } catch (error) {
      // Storage failures are non-fatal - the lookup just falls back.
    }
  }

  function bvRecordCmsCreds({ site, xApiKey, authorization, host, apiOrigin, authSource }) {
    if (!xApiKey && !authorization) return;

    const creds = bvGetCmsCreds();
    const now = Date.now();

    if (authorization) {
      // Two sources feed this: the Authorization header lifted off the app's
      // own requests, and the session cookie. They carry the same token but
      // NOT necessarily the same formatting - a header may include a
      // "Bearer " prefix the cookie has no reason to. So:
      //
      //  - a genuinely newer token always wins (that's a re-login), and
      //  - on a tie the header wins, because that value is known-good: it is
      //    exactly what the app itself put on the wire. Letting the cookie
      //    overwrite it on equal expiry could quietly swap a working format
      //    for an untested one.
      const source = authSource || 'header';
      const incomingExpiry = bvTokenExpiresAt(authorization);
      const stored = creds.authorization;
      const storedExpiry = stored ? bvTokenExpiresAt(stored.value) : 0;

      const replace =
        !stored ||
        !storedExpiry ||
        !incomingExpiry ||
        incomingExpiry > storedExpiry ||
        (incomingExpiry === storedExpiry && source === 'header' && stored.source === 'cookie');

      if (replace) {
        creds.authorization = { value: authorization, capturedAt: now, source };
      }
    }
    if (site && xApiKey) {
      // apiOrigin is recorded per brand because each CMS host has its own
      // API host - see the note above.
      creds.sites[site] = { xApiKey, apiOrigin: apiOrigin || '', capturedAt: now };
    }
    // Remembering which brand slug a given CMS host last used lets the
    // Freshdesk side resolve a site for hosts whose brands aren't in the
    // explicit account mapping (the mapping only covers the GCP host).
    if (site && host) {
      creds.hostSites[host] = site;
    }

    bvSaveCmsCreds(creds);
  }

  function bvGetCmsCredForSite(site) {
    if (!site) return null;

    const creds = bvGetCmsCreds();
    const auth = creds.authorization;
    const siteEntry = creds.sites[site];

    if (!auth || !auth.value || !siteEntry || !siteEntry.xApiKey) return null;
    if (!siteEntry.apiOrigin) return null;
    if (!bvCredsAreLive(auth)) return null;

    return {
      xApiKey: siteEntry.xApiKey,
      authorization: auth.value,
      apiOrigin: siteEntry.apiOrigin
    };
  }

  function bvGetSiteForCmsHost(host) {
    return bvGetCmsCreds().hostSites[host] || '';
  }

  // Keeps the CMS session from lapsing by making a REAL authenticated
  // backend call, which is the part the old keep-alive never did.
  //
  // Measured 2026-08-13, which is why this exists: the session token is a
  // JWT with a 24h lifetime, so being logged out after minutes of
  // inactivity is NOT the token expiring - and /api/auth/verify (what the
  // old keep-alive pinged) returns {error, valid} and provably does not
  // rotate or extend either session cookie. That endpoint only ever
  // reported status, so nothing was actually being kept alive. The
  // remaining explanation is a server-side idle timeout, which only real
  // authenticated traffic can reset.
  //
  // Uses a deliberately empty, read-only user-search - the cheapest
  // genuine authenticated call available - and goes out with the captured
  // Authorization header rather than cookies, so it works from Freshdesk
  // without depending on cross-site cookie rules.
  const BV_KEEP_ALIVE_SEARCH_TERM = 'bv-keepalive-noop';

  function bvCmsApiKeepAlive(onDone) {
    const creds = bvGetCmsCreds();
    const sites = Object.keys(creds.sites || {}).filter(site => bvGetCmsCredForSite(site));

    if (!sites.length) {
      if (onDone) onDone('no-credentials');
      return;
    }

    let remaining = sites.length;
    let anyAlive = false;
    let anyUnauthorized = false;

    sites.forEach(site => {
      bvCmsUserSearch({
        site,
        searchTerm: BV_KEEP_ALIVE_SEARCH_TERM,
        limit: 1,
        onDone: function (error) {
          if (!error) anyAlive = true;
          else if (error.message === 'cms-unauthorized') anyUnauthorized = true;

          remaining -= 1;
          if (remaining === 0 && onDone) {
            onDone(anyAlive ? 'alive' : (anyUnauthorized ? 'needs-login' : 'error'));
          }
        }
      });
    });
  }

  // --- CMS button journey timing ---------------------------------------
  //
  // "The SCHN CMS is slow on the initial search" could not be pinned down
  // from outside the script (measured live 2026-08-20). Everything that was
  // reachable turned out to be fast: the classic search page paints results
  // in ~0.9s and its search API answers in ~200ms, and the CMS button took
  // the direct path, not the v5 account switch. The two remaining suspects
  // are both invisible from the page:
  //
  //   1. the LOOKUP_DEADLINE_MS wait, which burns up to 3.5s in the
  //      Freshdesk tab before anything is navigated at all, and
  //   2. the account detail route /users/search/<id>, which browser
  //      automation cannot even reach - its result rows need a genuinely
  //      trusted click (see memory.md, dead end #2).
  //
  // So the script times itself. The run is kept in GM storage rather than a
  // variable because the journey spans two tabs - the click happens on
  // Freshdesk, the arrival happens on a CMS page - and reading it back over
  // there is the only way to put a number on the account page.
  const BV_TIMING_FLAG = 'bvCmsTiming';
  const BV_TIMING_RUN_KEY = 'betterCmsTimingRun';
  const BV_TIMING_MAX_AGE_MS = 120000;

  function bvTimingEnabled() {
    // Same three channels as the refund debug flag, for the same reason:
    // Tampermonkey sandboxes this window, so a data attribute on <html> is
    // the only one DevTools can reach from the page side.
    try {
      if (document.documentElement.dataset[BV_TIMING_FLAG] === 'true') return true;
    } catch (error) {
      // No documentElement yet - fall through to the other channels.
    }
    if (window[`__${BV_TIMING_FLAG}`] === true) return true;
    try {
      return GM_getValue(BV_TIMING_FLAG, false) === true;
    } catch (error) {
      return false;
    }
  }

  function bvTimingSetEnabled(value) {
    const on = value === true;
    try { GM_setValue(BV_TIMING_FLAG, on); } catch (error) { /* storage optional */ }
    window[`__${BV_TIMING_FLAG}`] = on;
    try {
      if (on) document.documentElement.dataset[BV_TIMING_FLAG] = 'true';
      else delete document.documentElement.dataset[BV_TIMING_FLAG];
    } catch (error) {
      // Non-fatal - the GM value stays the source of truth.
    }
  }

  function bvTimingReadRun() {
    try {
      const raw = GM_getValue(BV_TIMING_RUN_KEY, '');
      if (!raw) return null;
      const run = JSON.parse(raw);
      if (!run || !run.startedAt || !Array.isArray(run.stages)) return null;
      // A stale run would otherwise attach the next CMS page it sees to a
      // click from an hour ago and report a nonsense total.
      if (Date.now() - Number(run.startedAt) > BV_TIMING_MAX_AGE_MS) return null;
      return run;
    } catch (error) {
      return null;
    }
  }

  function bvTimingWriteRun(run) {
    try { GM_setValue(BV_TIMING_RUN_KEY, JSON.stringify(run)); } catch (error) { /* optional */ }
  }

  function bvTimingClearRun() {
    try { GM_deleteValue(BV_TIMING_RUN_KEY); } catch (error) { /* optional */ }
  }

  // Marks are appended to the stored run AND logged as they happen, so a
  // journey that never arrives (blocked popup, tab closed, switch stranded)
  // still leaves a readable trail in the Freshdesk console.
  function bvTimingMark(label, detail) {
    if (!bvTimingEnabled()) return;
    const run = bvTimingReadRun();
    if (!run) return;
    const at = Date.now() - Number(run.startedAt);
    run.stages.push({ label, at, detail: detail === undefined ? '' : String(detail) });
    bvTimingWriteRun(run);
    console.log(`[BV CMS Timing] +${at}ms ${label}${detail ? ' - ' + detail : ''}`);
  }

  function bvTimingStart(email, site) {
    if (!bvTimingEnabled()) return;
    // The address is the only customer data in this journey, so only its
    // domain is stored - enough to tell two runs apart, nothing more.
    const domain = String(email || '').split('@')[1] || '(none)';
    bvTimingWriteRun({ startedAt: Date.now(), domain, site: site || '(unknown)', stages: [] });
    console.log(`[BV CMS Timing] run started - site ${site || '(unknown)'}, @${domain}`);
  }

  function bvTimingReport(finalLabel) {
    if (!bvTimingEnabled()) return;
    const opening = bvTimingReadRun();
    if (!opening) return;
    bvTimingMark(finalLabel || 'done');
    const run = bvTimingReadRun();
    const stages = (run && run.stages) || [];
    console.log(`[BV CMS Timing] journey for @${opening.domain} (${opening.site})`);
    try { console.table(stages); } catch (error) { console.log(stages); }
    const total = stages.length ? stages[stages.length - 1].at : 0;
    console.log(`[BV CMS Timing] TOTAL click -> ${finalLabel || 'done'}: ${total}ms`);
    bvTimingClearRun();
  }

  // No menu entry for this one: the flag's other two channels are the switch.
  // From DevTools on the page, document.documentElement.dataset.bvCmsTiming =
  // 'true' turns the journey log on for that tab.

  // The other half of the journey: whichever CMS page the button lands on
  // reports how long it took to get there, and how long that page's own API
  // calls then took. This is the only way to see the account detail route's
  // real cost, and it is why the run lives in shared storage.
  if (isCMSHost()) {
    (function bvReportCmsArrival() {
      if (!bvTimingEnabled()) return;
      if (!bvTimingReadRun()) return;

      bvTimingMark('cms-page-script-start', location.pathname);

      const markLoad = function () {
        bvTimingMark('cms-page-load-event', `${Math.round(performance.now())}ms into this page`);
      };
      if (document.readyState === 'complete') markLoad();
      else window.addEventListener('load', markLoad, { once: true });

      // Every backend call this page makes is marked rather than trying to
      // guess which one is "the" search - on the account route there is more
      // than one, and which of them is slow is exactly the open question.
      try {
        const observer = new PerformanceObserver(function (list) {
          list.getEntries().forEach(function (entry) {
            if (!/api\.viewlift|\/v3\.0\/invoke|graphql/.test(entry.name)) return;
            const path = String(entry.name).split('?')[0].split('/').slice(3).join('/');
            bvTimingMark('cms-api', `${path} ${Math.round(entry.duration)}ms`);
          });
        });
        observer.observe({ type: 'resource', buffered: true });
      } catch (error) {
        bvTimingMark('cms-api-observer-failed', String(error && error.message));
      }

      // One fixed report point, late enough to have caught the page settling.
      // A journey that redirects again (the v5 account switch) simply keeps
      // marking on the next page, because the run outlives the navigation.
      window.setTimeout(function () { bvTimingReport('cms-settled'); }, 8000);
    })();
  }

  // Runs the same user-search the CMS UI runs, straight from Freshdesk.
  // onDone(error, { count, users }) - users carry the real account id,
  // which is what makes opening an account directly possible.
  function bvCmsUserSearch({ site, searchTerm, limit = 10, onDone }) {
    const cred = bvGetCmsCredForSite(site);
    if (!cred) {
      onDone(new Error('no-cms-credentials'), null);
      return;
    }

    GM_xmlhttpRequest({
      method: 'POST',
      url: cred.apiOrigin + BV_CMS_API_PATH,
      headers: {
        'Content-Type': 'application/json',
        Authorization: cred.authorization,
        xApiKey: cred.xApiKey
      },
      data: JSON.stringify({
        url: '/v2/admin/identity/user-search',
        method: 'POST',
        role: 'Customer Support',
        auth: { site, isServerToken: true },
        query: { site, totalCount: true },
        body: { searchTerm, offset: 0, limit, type: 'all' }
      }),
      timeout: 12000,
      onload: function (response) {
        if (response.status === 401 || response.status === 403) {
          onDone(new Error('cms-unauthorized'), null);
          return;
        }
        if (response.status < 200 || response.status >= 300) {
          onDone(new Error('cms-http-' + response.status), null);
          return;
        }
        try {
          const parsed = JSON.parse(response.responseText || '{}');
          onDone(null, {
            count: Number(parsed.count || 0),
            users: Array.isArray(parsed.users) ? parsed.users : []
          });
        } catch (error) {
          onDone(error, null);
        }
      },
      onerror: function () { onDone(new Error('cms-network-error'), null); },
      ontimeout: function () { onDone(new Error('cms-timeout'), null); }
    });
  }

  // Freshdesk's public API limit is shared by the WHOLE account (every agent
  // and integration). Measured 2026-09-30: /api/v2 answered 429 with
  // Retry-After: 609 while the UI's own /api/_/ calls kept working. A short
  // wait is waited out (twice at most); a long one is reported as such, so
  // callers can fall back to doing the job through the Freshdesk UI.
  const BV_RATE_LIMIT_MAX_WAIT_S = 25;

  function bvRetryAfterSeconds(response) {
    const match = String(response && response.responseHeaders || '').match(/^retry-after:\s*(\d+)/im);
    return match ? Number(match[1]) : 0;
  }

  function bvRateLimitError(seconds) {
    const error = new Error('rate-limited');
    error.retryAfter = seconds;
    return error;
  }

  function freshdeskApiRequest({ method = 'GET', path, body, onDone, attempt = 0 }) {
    const apiKey = getFreshdeskApiKey();
    if (!apiKey) {
      onDone(new Error('no-api-key'), null);
      return;
    }

    GM_xmlhttpRequest({
      method,
      // Fixed origin, not location.hostname: CMS Refund Assist calls this from
      // a CMS tab, and the agent's key must only ever go to Freshdesk.
      url: `https://viewlift.freshdesk.com${path}`,
      headers: Object.assign(
        { Authorization: 'Basic ' + btoa(apiKey + ':X') },
        body ? { 'Content-Type': 'application/json' } : {}
      ),
      data: body ? JSON.stringify(body) : undefined,
      timeout: 15000,
      onload: function (response) {
        if (response.status === 429) {
          const wait = bvRetryAfterSeconds(response);
          if (wait && wait <= BV_RATE_LIMIT_MAX_WAIT_S && attempt < 2) {
            setTimeout(() => freshdeskApiRequest({ method, path, body, onDone, attempt: attempt + 1 }), wait * 1000 + 250);
            return;
          }
          onDone(bvRateLimitError(wait), null);
          return;
        }
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

  // Same as freshdeskApiRequest, for multipart bodies (a note with an image
  // attachment). No Content-Type header: GM_xmlhttpRequest sets the
  // multipart boundary itself from the FormData.
  function freshdeskApiMultipart({ path, formData, onDone, attempt = 0 }) {
    const apiKey = getFreshdeskApiKey();
    if (!apiKey) {
      onDone(new Error('no-api-key'), null);
      return;
    }

    GM_xmlhttpRequest({
      method: 'POST',
      url: `https://viewlift.freshdesk.com${path}`,
      headers: { Authorization: 'Basic ' + btoa(apiKey + ':X') },
      data: formData,
      timeout: 30000,
      onload: function (response) {
        if (response.status === 429) {
          const wait = bvRetryAfterSeconds(response);
          if (wait && wait <= BV_RATE_LIMIT_MAX_WAIT_S && attempt < 2) {
            setTimeout(() => freshdeskApiMultipart({ path, formData, onDone, attempt: attempt + 1 }), wait * 1000 + 250);
            return;
          }
          onDone(bvRateLimitError(wait), null);
          return;
        }
        if (response.status === 401 || response.status === 403) {
          onDone(new Error('unauthorized'), null);
          return;
        }
        if (response.status < 200 || response.status >= 300) {
          const httpError = new Error('http-' + response.status);
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

  /* ============================================================
   * CMS API credential capture (CMS hosts only)
   * Reads the xApiKey / Authorization headers off the CMS app's own
   * outgoing API calls so the Freshdesk side can reuse them (see the
   * long note on bvGetCmsCreds above for why these are captured rather
   * than hardcoded). Purely passive: every original call is still made,
   * unmodified, with its own result untouched.
   * ============================================================ */
  if (isCMSHost()) {
    (function () {
      'use strict';

      // Patching has to happen on the PAGE's own fetch/XMLHttpRequest, not
      // the userscript sandbox's copies, or the app's requests go straight
      // past us. unsafeWindow is that real window; fall back to the sandbox
      // one rather than throwing if it isn't available.
      const pageWindow = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;

      if (pageWindow.__bvCmsCredCaptureInstalled) return;
      pageWindow.__bvCmsCredCaptureInstalled = true;

      function readHeader(headers, name) {
        if (!headers) return '';
        const wanted = name.toLowerCase();
        try {
          if (typeof Headers !== 'undefined' && headers instanceof Headers) {
            return headers.get(name) || '';
          }
          if (Array.isArray(headers)) {
            const hit = headers.find(pair => String(pair[0]).toLowerCase() === wanted);
            return hit ? hit[1] : '';
          }
          if (typeof headers === 'object') {
            const key = Object.keys(headers).find(k => k.toLowerCase() === wanted);
            return key ? headers[key] : '';
          }
        } catch (error) {
          // Unknown header container - treat as absent.
        }
        return '';
      }

      function siteFromRequestBody(body) {
        try {
          const parsed = typeof body === 'string' ? JSON.parse(body) : null;
          if (!parsed) return '';
          return (parsed.auth && parsed.auth.site) || (parsed.query && parsed.query.site) || '';
        } catch (error) {
          return '';
        }
      }

      // The request body isn't always readable (a Request object's body is
      // a stream, and not every call carries a site anyway), but the CMS
      // page always knows which brand it is currently on - it keeps it in
      // its own "site" cookie. Far more reliable than parsing bodies.
      function siteFromPage() {
        const match = document.cookie.match(/(?:^|;\s*)site=([^;]*)/);
        return match ? decodeURIComponent(match[1]).trim() : '';
      }

      function capture(url, headers, body) {
        try {
          const href = String(url || '');
          // Any of ViewLift's API hosts, not one fixed domain - the GCP CMS
          // uses cms-gcp.api.viewlift.com, MSN has its own, and the same
          // credentials ride along on both the /v3.0/invoke and the
          // /management/graphql calls.
          if (!/\bapi\.viewlift\.com/i.test(href)) return;

          const xApiKey = readHeader(headers, 'xApiKey');
          const authorization = readHeader(headers, 'Authorization');
          if (!xApiKey && !authorization) return;

          const site = siteFromRequestBody(body) || siteFromPage();
          let apiOrigin = '';
          try { apiOrigin = new URL(href, location.href).origin; } catch (error) { /* keep empty */ }

          bvRecordCmsCreds({
            site,
            xApiKey,
            authorization,
            host: location.hostname,
            apiOrigin
          });

          // Page-visible counters so "is capture actually recording?" can be
          // answered without digging into GM storage. Deliberately only
          // counts and a brand slug - never the credentials themselves.
          pageWindow.__bvCmsCredCaptureCount = (pageWindow.__bvCmsCredCaptureCount || 0) + 1;
          pageWindow.__bvCmsCredLastSite = site || '(no site in body)';
          pageWindow.__bvCmsCredLastHad = (xApiKey ? 'key' : '') + (authorization ? '+auth' : '');
          pageWindow.__bvCmsCredLastApiOrigin = apiOrigin;
        } catch (error) {
          pageWindow.__bvCmsCredCaptureError = String(error && error.message || error);
        }
      }

      try {
        const originalFetch = pageWindow.fetch;
        if (typeof originalFetch === 'function') {
          pageWindow.fetch = function (input, init) {
            try {
              const isRequestObject = input && typeof input === 'object' && input.url;
              const url = isRequestObject ? input.url : input;
              // fetch(url, init) puts the headers on init, but
              // fetch(new Request(url, {headers})) carries them on the
              // Request itself - miss that second form and nothing is ever
              // captured even though the patch is installed.
              const headers = (init && init.headers) || (isRequestObject ? input.headers : null);
              const body = (init && init.body) || null;
              capture(url, headers, body);
            } catch (error) { /* never block the request */ }
            return originalFetch.apply(this, arguments);
          };
        }
      } catch (error) {
        console.warn('[CMS API] Could not observe fetch for credential capture.', error);
      }

      try {
        const xhrProto = pageWindow.XMLHttpRequest && pageWindow.XMLHttpRequest.prototype;
        if (xhrProto) {
          const originalOpen = xhrProto.open;
          const originalSetHeader = xhrProto.setRequestHeader;
          const originalSend = xhrProto.send;

          xhrProto.open = function (method, url) {
            try {
              this.__bvUrl = url;
              this.__bvHeaders = {};
            } catch (error) { /* ignore */ }
            return originalOpen.apply(this, arguments);
          };

          xhrProto.setRequestHeader = function (name, value) {
            try {
              if (this.__bvHeaders) this.__bvHeaders[name] = value;
            } catch (error) { /* ignore */ }
            return originalSetHeader.apply(this, arguments);
          };

          xhrProto.send = function (body) {
            try {
              capture(this.__bvUrl, this.__bvHeaders, body);
            } catch (error) { /* never block the request */ }
            return originalSend.apply(this, arguments);
          };
        }
      } catch (error) {
        console.warn('[CMS API] Could not observe XHR for credential capture.', error);
      }

      // Read the session token straight from the live session instead of
      // only ever waiting to intercept it on an outgoing request.
      //
      // Why this matters: intercepting is passive, so the stored copy is
      // only ever as current as the last request we happened to catch - and
      // on some routes the app binds its fetch reference before this script
      // is injected, so we catch nothing at all there. Reading the cookie
      // means the stored token matches the real session from the moment any
      // CMS page loads, and updates immediately after a re-login rather than
      // leaving a superseded token in place.
      //
      // This does NOT extend anything: only the server can mint a token, and
      // this session's access and refresh tokens were measured expiring at
      // the same instant, so there is nothing here that could be refreshed.
      // It only keeps our copy honest.
      function captureTokenFromCookie() {
        try {
          const match = document.cookie.match(/(?:^|;\s*)vl-accessToken=([^;]*)/);
          if (!match) return;

          const token = decodeURIComponent(match[1]).trim();
          // Only accept something that really is a JWT with an expiry -
          // bvRecordCmsCreds compares expiries to decide what to keep, and a
          // value it can't read would look infinitely old to that comparison.
          if (!bvTokenExpiresAt(token)) return;

          bvRecordCmsCreds({
            site: siteFromPage(),
            authorization: token,
            host: location.hostname,
            authSource: 'cookie'
          });
        } catch (error) {
          // Never let credential housekeeping disturb the page.
        }
      }

      captureTokenFromCookie();
      onRouteChange(captureTokenFromCookie);
    })();
  }

  (function () {
/* ============================================================
 * Feature 1: Refund Capture Tool Enhanced
 * Source: Refund Capture Tool Enhanced 2.8
 * ============================================================ */

(function () {
  'use strict';

  // claude.ai is a matched host now (Feature 11 delivers cases into a chat
  // there), and this feature has no business running on it. Guarding here
  // rather than at the @match keeps the one script.
  if (location.hostname !== 'viewlift.freshdesk.com' && !isCMSHost()) return;
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

  const REFUND_SHEET_ID = '1f6uuak92FiHwq3GFUJ98IKbN9lI6BmWRfC_qcLLrcrM';

  // Every client tab starts with the same eight columns and then diverges.
  // Read off the live sheet on 2026-08-22, tab by tab - there are THREE
  // shapes, not two, and the old code had schn in the wrong one, so its
  // date landed a column to the right of "Date/Week of".
  const REFUND_ROW_BASE = [
    'email', 'freshdesk', 'cms', 'payment', 'reason', 'tag', 'amount', 'refunder'
  ];

  const REFUND_LAYOUT_COMMENTS_DATE = REFUND_ROW_BASE.concat(['comments', 'date']);
  const REFUND_LAYOUT_DATE_COMMENTS = REFUND_ROW_BASE.concat(['date', 'comments']);
  const REFUND_LAYOUT_DATE_ONLY = REFUND_ROW_BASE.concat(['date']);

  const REFUND_SHEETS = {
    tbl:       { gid: '469886271',  columns: REFUND_LAYOUT_COMMENTS_DATE },
    schn:      { gid: '273386395',  columns: REFUND_LAYOUT_DATE_ONLY },
    altitude:  { gid: '716064238',  columns: REFUND_LAYOUT_COMMENTS_DATE },
    msn:       { gid: '291960457',  columns: REFUND_LAYOUT_DATE_COMMENTS },
    vgk:       { gid: '1160085053', columns: REFUND_LAYOUT_DATE_COMMENTS },
    chsn:      { gid: '1893212316', columns: REFUND_LAYOUT_DATE_COMMENTS },
    fox:       { gid: '1677210455', columns: REFUND_LAYOUT_DATE_COMMENTS },
    rootsport: { gid: '285382536',  columns: REFUND_LAYOUT_COMMENTS_DATE },
    livgolf:   { gid: '133679065',  columns: REFUND_LAYOUT_COMMENTS_DATE },
    dirt:      { gid: '735614001',  columns: REFUND_LAYOUT_COMMENTS_DATE },
    lnp:       { gid: '0',          columns: REFUND_LAYOUT_COMMENTS_DATE }
  };

  // The test-sheet mode used while building the sheet writer was removed on
  // request (2026-09-30); its stored flag is cleared so it can never linger.
  try {
    GM_deleteValue('bvRefundSheetTestMode');
  } catch (error) {
    // Nothing stored - fine.
  }

  function getRefundSheetTarget(sheetKey) {
    const sheet = REFUND_SHEETS[sheetKey] || REFUND_SHEETS.tbl;
    return { sheetId: REFUND_SHEET_ID, gid: sheet.gid, test: false };
  }

  function refundSheetUrl(sheetKey) {
    const target = getRefundSheetTarget(sheetKey);
    return 'https://docs.google.com/spreadsheets/d/' + target.sheetId +
      '/edit?gid=' + target.gid + '#gid=' + target.gid;
  }

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

  const CMS_USER_ID_RE = /\/users\/(?:search\/)?([0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|apple-\d{6}\.[0-9a-f]{32}\.\d{4}(?:-[a-z0-9-]+)?)/i;
  const CMS_USER_URL_RE = /https:\/\/(?:cms(?:-gcp|-qcp)?\.viewlift\.com|foxone\.cms\.viewlift\.com|cms\.monumentalsportsnetwork\.com)\/users\/(?:search\/)?(?:[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|apple-\d{6}\.[0-9a-f]{32}\.\d{4}(?:-[a-z0-9-]+)?)(?:[^\s"'<>]*)?/ig;
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
    if (/foxone|fox\s*one|fox sports|fox\.com|\bfox\b/i.test(context)) return 'fox';
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
    const recordBrand = getActiveTicketBrand();
    const clientKey = recordBrand && REFUND_SHEETS[recordBrand.key]
      ? recordBrand.key
      : detectRefundClientKeyFromText(getRefundClientContextText());

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

  // Values by field name, so the row can be laid out in whatever order the
  // client tab actually uses.
  function readRefundFields() {
    const value = id => document.getElementById(id)?.value || '';

    return {
      email: value('refund-email'),
      freshdesk: value('refund-freshdesk'),
      cms: value('refund-cms'),
      payment: value('refund-payment'),
      reason: value('refund-reason'),
      tag: value('refund-tag') || 'yes',
      amount: value('refund-amount'),
      refunder: value('refund-refunder') || 'Sebastian',
      date: value('refund-date') || getTodayShortDate(),
      // Never filled in by the tool - it is there so the columns after it
      // line up with the sheet.
      comments: ''
    };
  }

  function buildRefundRow(sheetKey) {
    const sheet = REFUND_SHEETS[sheetKey] || REFUND_SHEETS.tbl;
    const fields = readRefundFields();
    return sheet.columns.map(name => fields[name] ?? '');
  }

  // The brand of the ticket this refund is for, from the ticket record:
  // on Freshdesk the open ticket, on CMS the stored Freshdesk ticket.
  function getActiveTicketBrand() {
    const ticketId = bvCurrentFreshdeskTicketId() ||
      (String(getFreshdeskTicketURL() || '').match(/\/tickets\/(\d+)/i) || [])[1] || '';
    return ticketId ? bvGetTicketBrand(ticketId) : null;
  }

  function getRefundSheetKey() {
    const recordBrand = getActiveTicketBrand();
    if (recordBrand && REFUND_SHEETS[recordBrand.key]) {
      forceSet(STORAGE_KEYS.client, recordBrand.key);
      return recordBrand.key;
    }

    const detected = detectRefundClientKeyFromText(getRefundClientContextText());
    if (detected && REFUND_SHEETS[detected]) {
      forceSet(STORAGE_KEYS.client, detected);
      return detected;
    }

    const stored = safeGet(STORAGE_KEYS.client, '').toLowerCase();
    return REFUND_SHEETS[stored] ? stored : 'tbl';
  }

  // The first free row of the client tab, so the sheet opens ON it.
  //
  // It used to be `count(B) + 2`, which is only right when no row has B
  // empty - measured 2026-09-30: Altitude+ aimed at 1405 (used) for a real
  // end of 1407, MSN 577 for 579, RootSport 265 for 266, CHSN 163 for 163.
  // Now: the last row with anything in column A or B, found by binary search
  // on "is there anything in A:B from row X down?" (gviz drops empty rows, so
  // it cannot report positions). Still counts only - no customer data leaves
  // the sheet for this. The sheet-side writer re-finds the row before pasting.
  function fetchNextRefundRow(sheetKey, onDone) {
    const target = getRefundSheetTarget(sheetKey);
    const END = 20000;
    const base = 'https://docs.google.com/spreadsheets/d/' + target.sheetId +
      '/gviz/tq?tqx=out:csv&gid=' + target.gid + '&headers=0';

    const hasDataFrom = from => new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: base + '&range=A' + from + ':B' + END + '&tq=' + encodeURIComponent('select count(A), count(B)'),
        timeout: 8000,
        onload: function (response) {
          const text = String(response.responseText || '');
          if (/invalid_range/i.test(text)) { resolve(false); return; }
          if (response.status < 200 || response.status >= 300) { reject(new Error('http-' + response.status)); return; }
          const line = text.trim().split('\n')[1] || '';
          resolve((line.match(/\d+/g) || []).map(Number).some(count => count > 0));
        },
        onerror: function () { reject(new Error('network-error')); },
        ontimeout: function () { reject(new Error('timeout')); }
      });
    });

    (async function () {
      if (!await hasDataFrom(1)) return 2;
      let low = 1;
      let high = END + 1;
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        if (await hasDataFrom(mid)) low = mid;
        else high = mid;
      }
      return low + 1;
    })().then(onDone, function (error) {
      console.warn('[Refund] Could not find the first free row.', error);
      onDone(0);
    });
  }

  function getRefundSheetRow() {
    runCapture(false);

    const paymentField = document.getElementById('refund-payment');
    if (paymentField && isBadPaymentValue(paymentField.value)) {
      paymentField.value = '';
      safeDelete(STORAGE_KEYS.payment);
    }

    const sheetKey = getRefundSheetKey();
    return { sheetKey, row: buildRefundRow(sheetKey) };
  }

  // Hands the row to the writer that runs on the sheet itself
  // (bvRunRefundSheetWriter): it pastes it there, checked, on its own.
  function queueRefundSheetRow(sheetKey, row, expectedRow, { closeWhenDone = false } = {}) {
    const target = getRefundSheetTarget(sheetKey);
    try {
      const queue = GM_getValue(BV_SHEET_ROW_QUEUE_KEY, []);
      const list = (Array.isArray(queue) ? queue : []).filter(item =>
        item && Date.now() - Number(item.createdAt || 0) < 15 * 60 * 1000);
      list.push({
        sheetId: target.sheetId,
        gid: target.gid,
        row,
        expectedRow: expectedRow || 0,
        label: sheetKey.toUpperCase() + (target.test ? ' - TEST SHEET' : ''),
        closeWhenDone,
        createdAt: Date.now(),
        nonce: Date.now() + '-' + Math.random().toString(36).slice(2)
      });
      GM_setValue(BV_SHEET_ROW_QUEUE_KEY, list.slice(-5));
      return true;
    } catch (error) {
      console.warn('[Refund] Could not queue the sheet row.', error);
      return false;
    }
  }

  // background: opened behind the current tab and closed once written -
  // Refund Assist's mode, so the agent lands on the ticket, not the sheet.
  function copyForRefundSheet({ background = false } = {}) {
    const result = getRefundSheetRow();
    const sheetUrl = refundSheetUrl(result.sheetKey);
    const client = result.sheetKey.toUpperCase();

    GM_setClipboard(result.row.join('\t'));
    markAllFieldStates();

    // Refund Assist: no row lookup here at all - the writer on the sheet
    // finds the first free row itself before it pastes (it always re-checked
    // anyway), so this side just queues and opens. That lookup was ~15
    // sequential queries spent before anything else could happen.
    if (background) {
      const queued = queueRefundSheetRow(result.sheetKey, result.row, 0, { closeWhenDone: true });
      if (queued) GM_openInTab(sheetUrl, { active: false, insert: true });
      setStatus(queued ? 'Sent to ' + client + ' - the sheet tab writes it on the first free row.' : 'Copied for ' + client + '.');
      return Promise.resolve({ sheetKey: result.sheetKey, row: 0, queued });
    }
    setStatus('Copied for ' + client + '. Finding the next free row...');

    // GM_openInTab rather than window.open: the row count is fetched first,
    // so by the time the tab is opened the click that started this is no
    // longer a fresh user gesture and a popup blocker would eat it.
    return new Promise(resolve => fetchNextRefundRow(result.sheetKey, function (nextRow) {
      if (nextRow) {
        const queued = queueRefundSheetRow(result.sheetKey, result.row, nextRow, { closeWhenDone: background });
        GM_openInTab(sheetUrl + '&range=A' + nextRow, { active: !background, insert: true });
        setStatus(queued
          ? 'Opened ' + client + ' row ' + nextRow + ' - the row is pasted there automatically (also on your clipboard).'
          : 'Copied for ' + client + '. Opened row ' + nextRow + ' - just press Ctrl+V.');
        resolve({ sheetKey: result.sheetKey, row: nextRow, queued });
        return;
      }

      // Could not read the length (offline, or the sheet moved): fall back to
      // the old landing spot, which needs Ctrl+Up + ArrowDown by hand.
      // Never auto-pasted here: with no row count there is no way to check
      // the target row is empty.
      GM_openInTab(sheetUrl + '&range=B1048576', { active: true, insert: true });
      setStatus('Copied for ' + client + '. Row count unavailable - in column B press Ctrl+Up, ArrowDown, then Ctrl+V.');
      resolve({ sheetKey: result.sheetKey, row: 0, queued: false });
    }));
  }

  // Refund Assist (CMS Feature 3b) fills the panel from the refunds it just
  // issued and sends the row the same way the panel's own button does.
  // Values go through the panel's inputs AND storage, so the row is built by
  // the one buildRefundRow() the button uses - same columns per client tab.
  window.__bvRefundSheet = {
    fillAndSend(fields) {
      const set = (id, key, value) => {
        const clean = cleanText(value);
        if (!clean) return;
        const input = document.getElementById(id);
        if (input) input.value = clean;
        if (key) forceSet(key, clean);
      };
      set('refund-email', STORAGE_KEYS.email, fields.email);
      set('refund-freshdesk', STORAGE_KEYS.freshdesk, fields.freshdesk);
      set('refund-cms', STORAGE_KEYS.cms, normalizeCMSUrl(fields.cms) || fields.cms);
      set('refund-payment', STORAGE_KEYS.payment, findPaymentHandlerInText(fields.payment) || fields.payment);
      set('refund-amount', STORAGE_KEYS.amount, fields.amount);
      if (!document.getElementById('refund-email')) {
        return Promise.resolve({ queued: false, row: 0, reason: 'the refund panel is not on this page' });
      }
      return copyForRefundSheet({ background: true });
    },
    // The old panel, on demand (Refund Assist header button).
    showPanel() {
      const panel = document.getElementById('refund-capture-panel');
      if (!panel) return false;
      panel.removeAttribute('data-bv-hidden-here');
      panel.removeAttribute('aria-hidden');
      panel.dataset.bvOpenedFromAssist = 'yes';
      applyPanelState(panel, false);
      runCapture(true, isCMSHost() ? 'Captured from this CMS tab.' : 'Refreshed from stored data.');
      return true;
    }
  };

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

    // Same builder as the "open the sheet" button. These two used to lay the
    // row out by different rules - one keyed on schn/livgolf, the other on a
    // date-first set - so the same client could get two different rows.
    const sheetKey = getRefundSheetKey();
    GM_setClipboard(buildRefundRow(sheetKey).join('\t'));
    setStatus('Copied for the ' + sheetKey.toUpperCase() + ' sheet layout.');
    markAllFieldStates();

    window.setTimeout(function () {
      const panel = document.getElementById('refund-capture-panel');
      if (panel) applyPanelState(panel, true);
    }, 700);
  }

  // A human-readable block for a note or Slack message - "Copy Row" above
  // is tab-separated for pasting into the refund sheet, not for reading.

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
          <option>Erick</option>
          <option>Esteban</option>
          <option>Julio</option>
        </select>

        <label for="refund-date">Date/Week of</label>
        <input id="refund-date" autocomplete="off" value="${getTodayShortDate()}">

        <div class="refund-grid-2">
          <button id="refund-clear" class="refund-action-button" type="button">Clear Stored Data</button>
          <button id="refund-refresh" class="refund-action-button" type="button">Refresh</button>
        </div>

        <button id="refund-copy" class="refund-action-button" type="button" style="margin-top:8px;">Copy Row</button>
        <button id="refund-copy-sheet" class="refund-action-button" type="button" style="margin-top:8px;">Open Refund Sheet</button>

        <div id="refund-status"></div>
      </div>
    `;

    // Obsolete as its own tool (Sebastian, 2026-09-30): Refund Assist does
    // its job. It is still BUILT everywhere - it keeps capturing in the
    // background, syncs the ticket to CMS, and Refund Assist fills it to
    // build the refund-log row - but never shown unless opened on purpose
    // from Refund Assist's header (window.__bvRefundSheet.showPanel()).
    panel.setAttribute('data-bv-hidden-here', 'true');
    panel.setAttribute('aria-hidden', 'true');
    GM_addStyle('#refund-capture-panel[data-bv-hidden-here]{display:none !important}' +
      // Opened from Refund Assist: above that panel, not hidden behind it.
      '#refund-capture-panel[data-bv-opened-from-assist]{z-index:1000003 !important}');

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
      // Opened from Refund Assist: minimizing puts it away again rather than
      // leaving its old $ float on screen.
      if (panel.dataset.bvOpenedFromAssist === 'yes') {
        delete panel.dataset.bvOpenedFromAssist;
        panel.setAttribute('data-bv-hidden-here', 'true');
        panel.setAttribute('aria-hidden', 'true');
      }
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
 * This keeps Sebastian/Erick/Esteban/Julio persistent across page refreshes and new CMS users.
 */
(function () {
  'use strict';

  // claude.ai is a matched host now (Feature 11 delivers cases into a chat
  // there), and this feature has no business running on it. Guarding here
  // rather than at the @match keeps the one script.
  if (location.hostname !== 'viewlift.freshdesk.com' && !isCMSHost()) return;
  const REFUNDER_PREF_KEY = 'Better CMS Preferred Refunder';
  const REFUNDER_SELECT_ID = 'refund-refunder';
  // "Erick", not "Eric" (corrected 2026-09-30).
  const VALID_REFUNDERS = ['Sebastian', 'Erick', 'Esteban', 'Julio'];

  function safeGetPreferredRefunder() {
    try {
      const stored = GM_getValue(REFUNDER_PREF_KEY, '');
      // A preference saved under the old misspelling would otherwise be
      // rejected by VALID_REFUNDERS and silently fall back to Sebastian.
      if (stored === 'Eric') {
        GM_setValue(REFUNDER_PREF_KEY, 'Erick');
        return 'Erick';
      }
      return stored;
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
 * Feature 1b: CMS Session Status Check (same tab)
 * NOTE: despite the original name, this only ever DETECTED an expired
 * session - measured 2026-08-13, /api/auth/verify returns {error, valid}
 * and does not rotate or extend either session cookie, so it never kept
 * anything alive. The call that actually holds the session open is
 * bvCmsApiKeepAlive(), driven from the Freshdesk tab (Feature 1b2), since
 * a backgrounded CMS tab has its timers frozen by Chrome anyway.
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
        'https://foxone.cms.viewlift.com/api/auth/verify',
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

    // The session-extending call below is gated on the agent actually being
    // at their desk. An idle timeout is a real security control on a system
    // holding customer data and refund powers, so this bridges the gap it
    // gets wrong - "working in Freshdesk with CMS in a background tab" - and
    // deliberately does NOT keep a session alive for someone who has walked
    // away: stop touching the keyboard for this long and it lapses normally.
    const PRESENCE_WINDOW_MS = 30 * 60 * 1000;
    let lastUserActivityAt = Date.now();

    ['mousemove', 'keydown', 'click', 'scroll'].forEach(eventName => {
        document.addEventListener(eventName, () => { lastUserActivityAt = Date.now(); }, { passive: true, capture: true });
    });

    function agentIsPresent() {
        return Date.now() - lastUserActivityAt < PRESENCE_WINDOW_MS;
    }

    function pingAllCMSHosts(onComplete) {
        // Only bother while Freshdesk is actually the tab being looked at -
        // if neither tab is active there is nothing useful to keep alive.
        if (document.visibilityState !== 'visible') {
            onComplete?.();
            return;
        }

        // /api/auth/verify is a status check only (measured - it does not
        // extend anything), so it still drives the toolbar's session dot
        // while the API call below is what actually holds the session open.
        if (agentIsPresent()) {
            bvCmsApiKeepAlive(status => {
                if (status === 'needs-login') {
                    console.debug('[Better ViewLift] CMS API keep-alive: session needs login again.');
                }
            });
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
    // Only this host's organizations: cms-gcp and cms.viewlift.com each have
    // their own picker with their own brands.
    const ORGANIZATIONS = bvCmsOrganizationsForHost(location.hostname);
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

    // Which brand this CMS session is currently on. The app keeps it in its
    // own "site" cookie (a brand slug, not a credential), which is a far
    // more reliable "did the switch land yet?" signal than a fixed timer.
    function currentSessionSite() {
        const match = document.cookie.match(/(?:^|;\s*)site=([^;]*)/);
        return match ? decodeURIComponent(match[1]).trim().toLowerCase() : '';
    }

    // Finishes a pending switch from WHEREVER the app happens to land.
    //
    // Selecting an organization makes the v5 app do a full page navigation
    // of its own (measured 2026-08-13: it lands on /content). The old code
    // waited a fixed 1200ms and then redirected, which raced that
    // navigation - when the app won, the redirect never happened and the
    // journey just stopped there, which is exactly the "it gets stuck and
    // never runs the search" report. Completing on page load instead of on
    // a timer removes the race: whatever page the app ends up on, this runs
    // there and continues to the real destination.
    function completePendingSwitchIfReady() {
        const pending = safeGetPending();
        if (!pending || !pending.key || !pending.returnUrl) return false;

        if (Date.now() - Number(pending.startedAt || 0) > 60000) {
            clearPending();
            return false;
        }

        // A switch queued for the other CMS host is not this page's to finish.
        let pendingHost = '';
        try { pendingHost = new URL(pending.returnUrl).hostname; } catch (error) { pendingHost = ''; }
        if (pendingHost && pendingHost !== location.hostname) return false;

        if (currentSessionSite() !== String(pending.key).toLowerCase()) {
            // Landed straight on the classic page (the Freshdesk side thought
            // the session was already on this brand - its record of that can
            // lag) but the session is on another one: an account page would
            // show an empty shell, so do the switch now, once.
            if (isClassicCMSPage() && !pending.viaV5 && ORGANIZATIONS.some(item => item.key === pending.key)) {
                safeSetPending(Object.assign({}, pending, { viaV5: true, startedAt: Date.now() }));
                location.replace(`${location.origin}/v5/overview?betterSwitch=${encodeURIComponent(pending.key)}`);
                return true;
            }
            return false;
        }

        clearPending();

        // Already at the destination - nothing left to do.
        if (location.href === pending.returnUrl) return true;

        location.replace(pending.returnUrl);
        return true;
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
            // The Freshdesk button already stored a pending entry with the
            // real destination (often a direct account URL). Rebuilding one
            // from this page's query string would overwrite it with a bare
            // search page, throwing away the account id the lookup just
            // found - which stranded every cross-brand jump on an empty
            // search screen. Only build one when nothing usable is pending.
            const existing = safeGetPending();
            const existingIsUsable = existing &&
                String(existing.key || '').toLowerCase() === key &&
                existing.returnUrl &&
                Date.now() - Number(existing.startedAt || 0) < 60000;

            if (existingIsUsable) return;

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

            // Deliberately does NOT clear the pending switch or redirect on a
            // timer: selecting an organization makes the app navigate itself,
            // and racing that navigation is what used to strand the journey
            // half-way. The pending entry is left in place so that whichever
            // page the app lands on finishes it via
            // completePendingSwitchIfReady(). This poll is only a fallback
            // for the case where the app re-renders without navigating - it
            // watches for the session's brand to actually flip rather than
            // guessing at a fixed delay, so it fires as soon as it is ready.
            let waited = 0;
            const settleTimer = window.setInterval(() => {
                waited += 250;
                if (completePendingSwitchIfReady() || waited > 15000) {
                    window.clearInterval(settleTimer);
                    switchRunning = false;
                }
            }, 250);
        }, 500);
    }

    captureQuerySwitchRequest();
    // Runs first, and on every CMS page: if a switch was requested earlier
    // and the session is now on that brand, continue straight to the real
    // destination no matter which page the app dropped us on.
    completePendingSwitchIfReady();
    installClassicButton();
    continueFromLogout();
    runV5Switch();
    onRouteChange(() => {
        completePendingSwitchIfReady();
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
        'Julio Fernando Fernando Piovano',
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
                border: 1px solid #cfd7df !important;
                border-radius: 4px !important;
                background: #ffffff !important;
                color: #12344d !important;
                font-size: 13px !important;
                font-weight: 600 !important;
                line-height: 30px !important;
                white-space: nowrap !important;
                cursor: pointer !important;
                box-shadow: none !important;
                transition: background 120ms ease, border-color 120ms ease !important;
            }

            #${BUTTON_ID}:hover {
                background: #f5f7f9 !important;
                border-color: #b9c3cd !important;
            }

            #${BUTTON_ID}:active {
                background: #ebeff3 !important;
            }

            #${BUTTON_ID}[data-configured="no"] {
                border-color: #e3b04b !important;
                background: #fdf6e7 !important;
                color: #7a5312 !important;
            }

            #${BUTTON_ID}[data-configured="no"]:hover {
                background: #faedd2 !important;
            }

            #${BUTTON_ID}[data-busy="yes"] {
                opacity: .6 !important;
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
    // How long React gets to accept a value written straight onto the MUI
    // Select's hidden native input before we stop waiting and go clicking.
    const REASON_WRITE_SETTLE_MS = 700;
    const REASON_WRITE_RETRY_MS = 1400;
    // How long the run waits to recognise ANYTHING refund-shaped (a Refund
    // button, the percentage menu item, or the dialog) before concluding the
    // click it started from had nothing to do with refunds.
    const NO_PROGRESS_MS = 6000;
    const DEBUG_KEY = 'bvRefundDebug';
    const DRY_RUN_KEY = 'bvRefundDryRun';

    let workflowActive = false;
    let workflowStartedAt = 0;
    let percentageOptionClicked = false;
    let percentageFilled = false;
    let reasonSelected = false;
    let commentsFilled = false;
    let internalClick = false;
    let lastRefundTriggerClickAt = 0;
    let lastReasonTriggerClickAt = 0;
    let reasonNativeWriteAt = 0;
    let sawProgress = false;
    let missingTicketId = false;
    let runTimer = null;
    let lastDebugLine = '';
    // Set only when Refund Assist drives this workflow (see startWorkflow).
    // expectedOrder pins the run to one transaction: the Refund button is not
    // touched until the open detail drawer shows that order number, so a stale
    // drawer from the previous charge can never be refunded twice.
    let expectedOrder = '';
    let finishCallback = null;

    function readFlag(key) {
        // Also read the flag off <html data-bv-refund-dry-run="true">, because
        // Tampermonkey hands this script a sandboxed window: neither the page's
        // own console nor browser automation can reach window.__bvRefundDryRun
        // from outside. A data attribute is the one channel both sides see,
        // which is what makes a dry run settable from DevTools.
        try {
            if (document.documentElement.dataset[key] === 'true') return true;
        } catch (error) {
            // No documentElement yet - fall through to the other sources.
        }
        return window[`__${key}`] === true;
    }

    function writeFlag(key, value) {
        window[`__${key}`] = value === true;
        // Mirrored so the state is visible (and clearable) from DevTools.
        try {
            if (value === true) document.documentElement.dataset[key] = 'true';
            else delete document.documentElement.dataset[key];
        } catch (error) {
            // Non-fatal - the GM value stays the source of truth.
        }
    }

    // Off by default: this runs on every CMS page and the per-tick state dump
    // would bury the console. Turn it on from the Tampermonkey menu (or
    // window.__bvRefundDebug = true) when a refund does not auto-fill, which
    // is the only time anyone needs it.
    function debugLog(message, detail) {
        if (!readFlag(DEBUG_KEY)) return;
        if (detail === undefined) console.log(`[BV Refund] ${message}`);
        else console.log(`[BV Refund] ${message}`, detail);
    }

    // Same as debugLog but collapses the identical line repeating every tick -
    // the workflow polls every ~150ms and the interesting part is when the
    // state CHANGES.
    function debugState(message, detail) {
        if (!readFlag(DEBUG_KEY)) return;
        if (message === lastDebugLine) return;
        lastDebugLine = message;
        debugLog(message, detail);
    }

    function cleanText(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            // MUI renders an empty Select as a zero-width space inside a
            // <span class="notranslate">. Those are not \s, so without this an
            // EMPTY reason field reads as if it had content.
            .replace(/[\u200b-\u200d\ufeff]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
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

    // Live CMS (2026-08-14) renders this as a plain MUI Button - a MoreHoriz
    // icon plus the word "Refund" - with NO aria-haspopup and NO data-slot.
    // The old selector demanded one of those attributes, so it never found the
    // button and the whole chain died at step one: that is why clicking the eye
    // "did nothing". Identity is the exact text: "Confirm Refund" and "Issue
    // percentage refund" must not match, so equality, not includes().
    function getRefundTrigger() {
        return Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(isVisible)
            .find(button => getText(button).toLowerCase() === 'refund') || null;
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
                element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true, view: bvEventView }));
                element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, view: bvEventView }));
                element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: bvEventView, button: 0 }));
            }
            element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: bvEventView }));
            element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: bvEventView }));
            if (typeof window.PointerEvent === 'function') {
                element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: bvEventView, button: 0 }));
            }
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: bvEventView }));
            element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: bvEventView }));
        } catch (error) {
            // A throwing constructor used to escape here and kill the whole
            // workflow silently, mid-sequence - which is how the Refund button
            // "did nothing" with no message of any kind. Never let that happen
            // again: fall back to the element's own click() and say so.
            console.warn('[Better CMS Refund] Synthetic click sequence failed; falling back to element.click().', error);
            try {
                element.click();
            } catch (clickError) {
                console.warn('[Better CMS Refund] element.click() failed too.', clickError);
                internalClick = false;
                return false;
            }
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
            // h4-h6 matter: the live dialog titles this with MUI's
            // <h6 class="MuiTypography-h6">Issue percentage refund</h6>, so an
            // h1-h3 lookup found nothing and dialog detection was silently
            // falling through to the placeholder heuristic below every time.
            const title = getText(element.querySelector(
                '[data-slot="dialog-title"], h1, h2, h3, h4, h5, h6'
            )).toLowerCase();
            return title.includes('refund') &&
                (title.includes('issue') || title.includes('percentage'));
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
            // MUI's <InputLabel>Reason</InputLabel> is a SIBLING of the
            // Select, not an ancestor one level up - element.parentElement
            // alone missed it. Walk up to the nearest field/form wrapper
            // instead, matching the broader-context pattern already used
            // elsewhere in this file (e.g. Feature 2's getNearbyText).
            const container = element.closest(
                '.MuiFormControl-root, .MuiGrid-root, [role="dialog"] > div, form'
            ) || element.parentElement;
            const context = cleanText(container?.innerText).toLowerCase();
            return text.includes('reason') || context.includes('reason');
        }) || null;
    }

    // MUI Select keeps its real value on a hidden native <input> sibling
    // (class="MuiSelect-nativeInput") specifically so it's readable/
    // writable without going through the visible combobox's click-driven
    // portal listbox - reading it (or the visible combobox's own text as a
    // fallback) tells us the CURRENT selection without needing to open
    // anything, which is what actually matters: MUI defaults this field to
    // "ROTH - Other/Did not say" already on some CMS accounts, and the
    // workflow was stalling forever trying to re-select a value that was
    // already correct instead of just recognizing it.
    function getReasonCurrentText(dialog) {
        const nativeInput = dialog?.querySelector('.MuiSelect-nativeInput, select');
        if (nativeInput && nativeInput.value) return cleanText(nativeInput.value);

        const combobox = dialog?.querySelector('[role="combobox"]');
        return combobox ? getText(combobox) : '';
    }

    function isReasonAlreadyROTH(dialog) {
        const current = getReasonCurrentText(dialog).toUpperCase();
        return current === REFUND_REASON_VALUE || current.startsWith(REFUND_REASON_VALUE + ' ') ||
            current.includes('ROTH');
    }

    function getReasonNativeInput(dialog) {
        return dialog?.querySelector('input.MuiSelect-nativeInput') || null;
    }

    // The one that actually works, and the reason this feature kept failing.
    //
    // MUI's non-native Select renders a hidden <input class="MuiSelect-nativeInput">
    // whose onChange handler looks the written value up among the MenuItem
    // `value` props and, on a hit, selects that item - it exists precisely so
    // browser autofill can drive the field. So the value can be set WITHOUT
    // opening the portal listbox, which matters twice over here: this app has
    // already been observed (twice, 2026-08-12/13) ignoring synthetic clicks on
    // MUI components, and the listbox is portalled outside the dialog anyway.
    //
    // Value must match a MenuItem's value exactly or MUI's handler bails with
    // index -1 and nothing happens - hence the read-back verification by the
    // caller rather than trusting the write.
    function writeReasonNativeValue(dialog, value) {
        const nativeInput = getReasonNativeInput(dialog);
        if (!nativeInput) {
            debugLog('No hidden MuiSelect-nativeInput in the dialog - cannot set the reason without the menu.');
            return false;
        }

        const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        const previousValue = nativeInput.value;
        if (descriptor?.set) descriptor.set.call(nativeInput, value);
        else nativeInput.value = value;
        if (nativeInput._valueTracker) nativeInput._valueTracker.setValue(previousValue);
        nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
        nativeInput.dispatchEvent(new Event('change', { bubbles: true }));
        debugLog(`Wrote "${value}" onto the hidden reason input; verifying on the next tick.`);
        return true;
    }

    // Only called when the write path failed - dumps what the listbox actually
    // offers so a wording/value mismatch is visible instead of guessed at.
    function debugDumpReasonOptions() {
        if (!readFlag(DEBUG_KEY)) return;
        const options = Array.from(document.querySelectorAll(
            '[data-slot="select-item"], [data-slot="dropdown-menu-item"], [role="option"], [role="menuitem"], [data-radix-collection-item]'
        ));
        if (!options.length) {
            debugLog('Reason listbox is not open (no option nodes anywhere in the document).');
            return;
        }
        debugLog('Reason options currently rendered:', options.map(option => ({
            dataValue: option.getAttribute('data-value'),
            text: getText(option),
            visible: isVisible(option)
        })));
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
        // MUI names its own icons, so the testid is the stable identity of the
        // eye button; the path-data comparison below stays as a fallback for
        // builds that render the same glyph without a testid. Matching the
        // whole button (not just the <path>) also catches clicks that land on
        // the ripple span or the button's padding rather than the glyph itself.
        const button = target?.closest?.('button');
        if (button?.querySelector('svg[data-testid="VisibilityIcon"]')) return true;
        if (target?.closest?.('svg[data-testid="VisibilityIcon"]')) return true;

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

    // Returns true only when the field VERIFIABLY reads ROTH - never merely
    // because an event was dispatched at it. The old code set reasonSelected
    // from realClick()'s return value, which only reports "events were sent",
    // so a silently-ignored click counted as success.
    function ensureReasonSelected(dialog) {
        if (isReasonAlreadyROTH(dialog)) {
            debugState('Reason is ROTH.', getReasonCurrentText(dialog));
            return true;
        }

        // A genuine <select> (older CMS builds) is unambiguous - try it first.
        if (selectNativeROTH(dialog) && isReasonAlreadyROTH(dialog)) return true;

        // Preferred path: write straight to MUI's hidden native input, then let
        // the next tick confirm React accepted it.
        const sinceWrite = reasonNativeWriteAt ? Date.now() - reasonNativeWriteAt : Infinity;
        if (sinceWrite > REASON_WRITE_RETRY_MS) {
            if (writeReasonNativeValue(dialog, REFUND_REASON_VALUE)) {
                reasonNativeWriteAt = Date.now();
                return false;
            }
        } else if (sinceWrite < REASON_WRITE_SETTLE_MS) {
            debugState('Waiting for React to accept the written reason value.');
            return false;
        }

        // Fallback: the click-driven path. Reached when the hidden input is
        // missing, or when MUI rejected the written value because the real
        // MenuItem value is not literally "ROTH" - in which case the option
        // dump below is what identifies the correct value.
        const option = getReasonOption();
        if (option) {
            realClick(option, '[Better CMS Refund] Reason option clicked.');
            return isReasonAlreadyROTH(dialog);
        }

        const trigger = getReasonTrigger(dialog);
        if (!trigger) {
            debugState('No reason trigger found inside the dialog.');
            return false;
        }
        if (trigger.getAttribute('aria-expanded') === 'true') {
            debugState('Reason listbox reports open but no matching option was found.');
            debugDumpReasonOptions();
            return false;
        }
        if (Date.now() - lastReasonTriggerClickAt > 500) {
            lastReasonTriggerClickAt = Date.now();
            realClick(trigger, '[Better CMS Refund] Reason menu opened.');
        }
        return false;
    }

    function scheduleRun(delay = 100) {
        window.clearTimeout(runTimer);
        runTimer = window.setTimeout(runWorkflow, delay);
    }

    // Reports how a run ended to whoever started it (Refund Assist). Called
    // once per run: 'submitted', 'dry-run' or 'failed'.
    function finishWorkflow(outcome, detail = '') {
        workflowActive = false;
        const callback = finishCallback;
        finishCallback = null;
        expectedOrder = '';
        if (typeof callback === 'function') {
            try {
                callback({ outcome, detail });
            } catch (error) {
                console.warn('[Better CMS Refund] Refund Assist callback threw.', error);
            }
        }
    }

    function triggerMatchesExpectedOrder(trigger) {
        if (!expectedOrder) return true;
        const scope = trigger?.closest?.('.MuiDrawer-paper, .MuiDrawer-root, [role="presentation"]');
        return Boolean(scope && textHasOrder(cleanText(scope.innerText || scope.textContent), expectedOrder));
    }

    // The WHOLE order number, not a substring of a longer one: Google Play
    // renewals are prefixes of each other (GPA.3303-1537-6618-70405 and
    // GPA.3303-1537-6618-70405..0, live 2026-10-01), so "includes" let one
    // charge's drawer pass for the other's when several were refunded. Only
    // the END is anchored: the drawer's text runs "Order NumberGPA..." with
    // no separator in front.
    function textHasOrder(text, order) {
        const escaped = String(order).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`${escaped}(?![\\w.])`).test(String(text || ''));
    }

    function runWorkflow() {
        if (!workflowActive) return;

        if (Date.now() - workflowStartedAt > WORKFLOW_TIMEOUT_MS) {
            const missing = [
                !percentageFilled && 'percentage',
                !reasonSelected && 'reason',
                !commentsFilled && 'comments'
            ].filter(Boolean);
            console.warn('[Better CMS Refund] Timed out before all fields were prepared. Missing:', missing);
            if (!reasonSelected) {
                const timedOutDialog = getIssueRefundDialog();
                console.warn(
                    '[Better CMS Refund] Reason field still reads:',
                    JSON.stringify(getReasonCurrentText(timedOutDialog)),
                    '- turn on the Tampermonkey menu\'s "Refund: debug logging" and retry to see the option list.'
                );
                debugDumpReasonOptions();
            }
            bvNotify(
                missingTicketId
                    ? 'Refund auto-fill stopped: no Freshdesk ticket ID stored, and Additional Comments is required. Set the ID in the refund sheet ($) and click the eye again.'
                    : `Refund auto-fill stopped - could not set: ${missing.join(', ') || 'unknown field'}. Fill it in by hand and submit manually.`,
                { level: 'warn', ttl: 10000 }
            );
            finishWorkflow('failed', missingTicketId
                ? 'no Freshdesk ticket ID stored'
                : `could not set: ${missing.join(', ') || 'unknown field'}`);
            return;
        }

        const openDialog = getIssueRefundDialog();
        if (openDialog) {
            percentageOptionClicked = true;
            sawProgress = true;
        }

        if (!percentageOptionClicked) {
            const option = getPercentageRefundOption();
            if (option) {
                sawProgress = true;
                percentageOptionClicked = realClick(option, '[Better CMS Refund] Percentage selected.');
                scheduleRun(150);
                return;
            }

            const trigger = getRefundTrigger();
            if (trigger && !triggerMatchesExpectedOrder(trigger)) {
                debugState(`Refund button found, but the open drawer is not order ${expectedOrder} - waiting.`);
            } else if (trigger) {
                sawProgress = true;
                // This button carries no aria-expanded, so there is no way to
                // read whether its menu is open - the 1.2s spacing is what
                // keeps a second click from closing a menu that just opened.
                if (trigger.getAttribute('aria-expanded') !== 'true' &&
                    Date.now() - lastRefundTriggerClickAt > 1200) {
                    lastRefundTriggerClickAt = Date.now();
                    realClick(trigger, '[Better CMS Refund] Refund menu opened.');
                }
            } else {
                debugState('Waiting for a Refund button to appear.');
            }

            // CMS uses MUI's Visibility icon for more than refunds. Without
            // this, an eye click anywhere else would sit for the full 20s and
            // then warn about a refund the user never started. Nothing
            // recognised within a few seconds means this was not a refund.
            if (!sawProgress && Date.now() - workflowStartedAt > NO_PROGRESS_MS) {
                debugLog('Nothing refund-shaped appeared - that was not a refund action. Standing down quietly.');
                finishWorkflow('failed', expectedOrder
                    ? `no Refund button for order ${expectedOrder}`
                    : 'no Refund button appeared');
                return;
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
            } else if (textarea && !ticketURL) {
                // Additional Comments is required by the dialog, so with no
                // ticket id there is nothing valid to put there and the run can
                // never finish. Say so instead of spinning to the timeout with
                // a generic message - and do NOT invent a comment: the ticket
                // link is the audit trail for the refund.
                missingTicketId = true;
                debugState('No Freshdesk ticket id stored - cannot fill the required Comments field.');
            }
        }

        if (!reasonSelected) {
            reasonSelected = ensureReasonSelected(dialog);
        }

        debugState(
            `state percentage=${percentageFilled} reason=${reasonSelected} comments=${commentsFilled}`,
            { reason: getReasonCurrentText(dialog) }
        );

        if (percentageFilled && reasonSelected && commentsFilled) {
            const submitButton = getIssueRefundButton(dialog);
            if (submitButton) {
                // Dry run exists so this workflow can be debugged live without
                // moving real money on a real customer's subscription.
                if (readFlag(DRY_RUN_KEY)) {
                    console.log('[BV Refund] DRY RUN - all fields are set; NOT clicking', JSON.stringify(getText(submitButton)));
                    bvNotify('Refund dry run: fields filled, submit skipped. Review and confirm by hand.', { level: 'info', ttl: 8000 });
                    finishWorkflow('dry-run');
                    return;
                }
                const clicked = realClick(submitButton, '[Better CMS Refund] Issue Refund clicked automatically.');
                finishWorkflow(clicked ? 'submitted' : 'failed', clicked ? '' : 'Confirm Refund click failed');
                return;
            }
            debugState('All fields set but no enabled Issue/Confirm Refund button found yet.');
        }

        scheduleRun(150);
    }

    // The eye does NOT open the refund dialog - it opens the transaction's
    // detail view, where the Refund button and its "Issue percentage refund"
    // item still have to be driven from here. So the eye starts a run with
    // nothing done yet (3.44.0 wrongly had it wait for a dialog that only
    // appears two clicks later, and stood down before ever getting there).
    //
    // percentageChosen: the user picked "Issue percentage refund" themselves.
    // triggerClicked: the user clicked Refund themselves - that only suppresses
    // an immediate re-click, which would close the menu they just opened.
    function startWorkflow({ percentageChosen = false, triggerClicked = false, order = '', onFinish = null } = {}) {
        debugLog(`Workflow started (percentage chosen: ${percentageChosen}, refund menu already clicked: ${triggerClicked}${order ? `, order ${order}` : ''}).`);
        // A run started by hand replaces any Refund Assist run still pending -
        // tell its owner instead of leaving it waiting forever.
        if (finishCallback) finishWorkflow('failed', 'replaced by another refund run');
        expectedOrder = cleanText(order);
        finishCallback = typeof onFinish === 'function' ? onFinish : null;
        lastDebugLine = '';
        reasonNativeWriteAt = 0;
        sawProgress = percentageChosen || triggerClicked;
        missingTicketId = false;
        workflowActive = true;
        workflowStartedAt = Date.now();
        percentageOptionClicked = percentageChosen;
        percentageFilled = false;
        reasonSelected = false;
        commentsFilled = false;
        lastRefundTriggerClickAt = triggerClicked ? Date.now() : 0;
        lastReasonTriggerClickAt = 0;
        scheduleRun(80);
    }

    // Refund Assist (next feature) opens the eye itself and then calls start()
    // with the order it expects, so its own clicks must not ALSO start an
    // unpinned run from the listener below.
    window.__bvRefundWorkflow = {
        start: options => startWorkflow(options || {}),
        isActive: () => workflowActive,
        isDryRun: () => readFlag(DRY_RUN_KEY),
        getTicketURL: () => getFreshdeskTicketURL()
    };

    document.addEventListener('click', function (event) {
        if (internalClick) return;
        if (window.__bvRefundAssistDriving === true) return;

        if (isRefundActionIconClick(event.target)) {
            debugLog('Refund eye clicked - will drive Refund then Issue percentage refund.');
            startWorkflow();
            return;
        }

        if (isRefundTrigger(event.target)) {
            startWorkflow({ triggerClicked: true });
            return;
        }

        if (isPercentageRefundOption(event.target)) {
            startWorkflow({ percentageChosen: true });
        }
    }, true);

    const observer = new MutationObserver(function () {
        if (workflowActive) scheduleRun(60);
    });

    // The debug / dry-run menu commands were removed on request
    // (2026-09-30). Their flags are now read from the page attribute only
    // (<html data-bv-refund-dry-run="true">, for testing without money), and
    // anything an older version STORED is cleared - with the menu gone, a
    // stored dry run would otherwise stay on invisibly and no refund would
    // ever be confirmed.
    function clearStoredFlags() {
        try {
            GM_deleteValue(DEBUG_KEY);
            GM_deleteValue(DRY_RUN_KEY);
        } catch (error) {
            // Nothing stored - fine.
        }
    }

    function init() {
        if (!document.body) {
            window.setTimeout(init, 250);
            return;
        }

        observer.observe(document.body, { childList: true, subtree: true });
        clearStoredFlags();
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
 * Feature 3b: Refund Assist - Cancel Now, then refund the charges picked
 * A "Refund Assist" dropdown on BILLING & PURCHASE > SUBSCRIPTION PLANS AND
 * ENTITLEMENTS lists the account's charges with checkboxes. After an explicit
 * confirm step it:
 *   1. cancels the subscription with CANCEL NOW (ticket link as Comments),
 *      so the customer cannot be charged again while the refunds go through;
 *   2. refunds each selected charge at 100% by driving Feature 3's own
 *      eye > Refund > Issue percentage refund chain, pinned to that charge's
 *      order number;
 *   3. copies a summary and queues it for the ticket's Freshdesk tab, which
 *      pastes it into a private note (not sent - the agent reviews it).
 * Stops at the first failure: a failed cancel refunds nothing, a failed
 * refund leaves the rest untouched. Honors Feature 3's dry run everywhere -
 * with it on, dialogs get filled and closed, nothing is submitted.
 * ============================================================ */

if (isCMSHost()) {

(function () {
    'use strict';

    if (window.__bvRefundAssistInstalled) return;
    window.__bvRefundAssistInstalled = true;

    const BUTTON_ID = 'bv-refund-assist-button';
    const PANEL_ID = 'bv-refund-assist-panel';
    const STYLE_ID = 'bv-refund-assist-style';
    const STEP_TIMEOUT_MS = 15000;
    const SUBMIT_SETTLE_MS = 20000;
    const WORKFLOW_BACKSTOP_MS = 35000;
    const PANEL_SIZE_KEY = 'bvRefundAssistPanelSize';

    let running = false;
    let view = 'select';
    let charges = [];
    let selected = new Set();
    let cancelFirst = true;
    let steps = [];
    let lastNoteText = '';
    // REFUND rows already in the table when the panel opened - a refund the
    // run issues is a row that is NOT in here (see attachRefundRows).
    let initialRefundKeys = new Set();
    let plannedSteps = 0;
    let runClaimedRefundKeys = new Set();
    // Set when Cancel Now went through the API: CMS does not refresh the plan
    // card after it, so the card's status is stale - this is the real one.
    let lastCancelStatus = '';
    let runBillingRecords = null;
    // What the last run did and left undone - Recheck picks it up from here.
    let lastRun = null;
    let runStartedAt = 0;
    let mountTimer = null;

    function cleanText(value) {
        return String(value || '')
            .replace(/ /g, ' ')
            .replace(/[​-‍﻿]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function lower(element) {
        return cleanText(element?.textContent).toLowerCase();
    }

    function isVisible(element) {
        if (!element || !element.getBoundingClientRect) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 &&
            style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function sleep(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }

    function isOwnUi(element) {
        return Boolean(element?.closest?.(`#${PANEL_ID}, #${BUTTON_ID}`));
    }

    // Same event sequence as Feature 3's realClick (bvEventView, not the
    // sandboxed window - see memory.md 3.46.0), with element.click() as the
    // fallback when a constructor throws.
    function realClick(element) {
        if (!element || !isVisible(element)) return false;
        try {
            if (typeof window.PointerEvent === 'function') {
                element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: bvEventView, button: 0 }));
            }
            element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: bvEventView }));
            if (typeof window.PointerEvent === 'function') {
                element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: bvEventView, button: 0 }));
            }
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: bvEventView }));
            element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: bvEventView }));
        } catch (error) {
            try {
                element.click();
            } catch (clickError) {
                console.warn('[BV Refund Assist] Click failed.', clickError);
                return false;
            }
        }
        return true;
    }

    function setControlledValue(element, value) {
        if (!element) return false;
        const previousValue = element.value;
        const prototype = element.tagName.toLowerCase() === 'textarea'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        if (descriptor?.set) descriptor.set.call(element, value);
        else element.value = value;
        if (element._valueTracker) element._valueTracker.setValue(previousValue);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return element.value === value;
    }

    // textContent, not innerText: CMS uppercases its tabs with CSS, and
    // innerText reports the transformed text.
    function findButtonByText(text, root = document) {
        const wanted = text.toLowerCase();
        return Array.from(root.querySelectorAll('button, [role="button"]'))
            .filter(element => !isOwnUi(element) && isVisible(element))
            .find(element => lower(element) === wanted) || null;
    }

    function getBridge() {
        return window.__bvRefundWorkflow || null;
    }

    // Whole order number only - see textHasOrder in Feature 3 (GPA renewals
    // are prefixes of each other; only the end is anchored).
    function textHasOrder(text, order) {
        const escaped = String(order).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`${escaped}(?![\\w.])`).test(String(text || ''));
    }

    function isDryRun() {
        return Boolean(getBridge()?.isDryRun?.());
    }

    function getTicketURL() {
        return cleanText(getBridge()?.getTicketURL?.() || '');
    }

    function getTicketNumber(url) {
        const match = String(url || '').match(/\/tickets\/(\d+)/i);
        return match ? match[1] : '';
    }

    /* ---------------- charges table ---------------- */

    function getTableHeaders(table) {
        return Array.from(table.querySelectorAll('thead th')).map(th => lower(th));
    }

    function isChargesTable(table) {
        const headers = getTableHeaders(table);
        return headers.includes('order number') && headers.includes('transaction type') &&
            headers.includes('total amount');
    }

    function getChargesTable() {
        return Array.from(document.querySelectorAll('table'))
            .filter(isVisible)
            .find(isChargesTable) || null;
    }

    function scrapeCharges(table) {
        if (!table) return [];
        const headers = getTableHeaders(table);
        return Array.from(table.querySelectorAll('tbody tr')).map(row => {
            const cells = Array.from(row.children);
            const cell = name => {
                const index = headers.indexOf(name);
                return index >= 0 ? cleanText(cells[index]?.textContent) : '';
            };
            return {
                date: cell('date'),
                title: cell('title'),
                type: cell('transaction type'),
                order: cell('order number'),
                amount: cell('total amount'),
                handler: cell('payment handler'),
                offer: cell('offer'),
                hasEye: Boolean(row.querySelector('svg[data-testid="VisibilityIcon"]'))
            };
        }).filter(charge => charge.order);
    }

    function isRefundable(charge) {
        // A "N/A" order or a zero amount is a placeholder row (a free / USD 0
        // period, live 2026-10-01) - nothing to refund there.
        const amount = parseAmount(charge.amount);
        return charge.type.toUpperCase() === 'CHARGE' && charge.hasEye && !charge.refundedBy &&
            !/^n\/?a$/i.test(cleanText(charge.order)) && !(amount && amount.value <= 0);
    }

    // A refunded charge stays a CHARGE row; the refund shows up as its own
    // REFUND row (live 2026-09-30: ch_3ULBgIJtJXFjDDk50HJk2L25 refunded as
    // re_3ULBgIJtJXFjDDk50gHhfbdI). Stripe gives both ids the same
    // payment-intent prefix, so a shared 16-character core ties them together
    // - without this the charge stayed selectable for a second refund. The
    // first 6 characters differ between payments; the rest is the account.
    const REFUND_MATCH_CHARS = 16;

    // Two pairings, both read live on 2026-09-30:
    //   * Google Play (ANDROID) gives the REFUND row the SAME order number as
    //     its charge (GPA.3393-7153-0266-92083..5 on both);
    //   * Stripe gives it a different id sharing the payment-intent core.
    // The pairing stores the REFUND row itself, because with Google Play
    // looking a refund up by order number alone finds the charge again.
    function markRefundedCharges(list) {
        const core = order => cleanText(order).replace(/^[a-z]+_/i, '').slice(0, REFUND_MATCH_CHARS);
        const refunds = list.filter(charge => charge.type.toUpperCase() === 'REFUND');
        for (const charge of list) {
            if (charge.type.toUpperCase() !== 'CHARGE') continue;
            // The core rule is Stripe-only (re_ against ch_/py_): Google
            // Play ids of one subscription share far more than 16 leading
            // characters (GPA.3393-7153-0266-92083..4 / ..5), so applying it
            // there would mark every charge of the plan as refunded.
            const isStripeCharge = /^(ch|py)_/i.test(charge.order);
            const match = refunds.find(refund => refund.order === charge.order) ||
                (isStripeCharge && refunds.find(refund => /^re_/i.test(refund.order) &&
                    core(refund.order).length === REFUND_MATCH_CHARS &&
                    core(refund.order) === core(charge.order)));
            if (match) {
                charge.refundedBy = match.order;
                charge.refundedRow = match;
            }
        }
        return list;
    }

    function findChargeRow(order) {
        const table = getChargesTable();
        if (!table) return null;
        const headers = getTableHeaders(table);
        const index = headers.indexOf('order number');
        const typeIndex = headers.indexOf('transaction type');
        // The CHARGE row, never its REFUND twin: Google Play reuses the order
        // number, so matching the number alone could open the refund row.
        return Array.from(table.querySelectorAll('tbody tr')).find(row =>
            cleanText(row.children[index]?.textContent) === order &&
            (typeIndex < 0 || cleanText(row.children[typeIndex]?.textContent).toUpperCase() === 'CHARGE')) || null;
    }

    // "USD 19.99" -> { currency: 'USD', value: 19.99 }. Currency stays
    // separate so a mixed list never adds USD to CAD.
    function parseAmount(text) {
        const match = cleanText(text).match(/([A-Z]{3})?\s*[$€£]?\s*(-?\d[\d,]*(?:\.\d+)?)/);
        if (!match) return null;
        const value = Number(match[2].replace(/,/g, ''));
        return Number.isFinite(value) ? { currency: match[1] || '', value } : null;
    }

    // The refund log's "Amount Refunded" the way the team has always typed it
    // by hand for repeat charges (Sebastian, 2026-09-30): "USD 19.99 x2".
    // Different amounts are listed side by side, never summed into a figure
    // nobody actually charged: "USD 19.99 x2 + USD 9.99".
    function formatRefundAmount(list) {
        const counts = new Map();
        for (const charge of list) {
            const amount = cleanText(charge.amount);
            if (!amount) continue;
            counts.set(amount, (counts.get(amount) || 0) + 1);
        }
        return Array.from(counts.entries())
            .map(([amount, times]) => (times > 1 ? `${amount} x${times}` : amount))
            .join(' + ');
    }

    function formatTotal(list) {
        const totals = new Map();
        for (const charge of list) {
            const amount = parseAmount(charge.amount);
            if (!amount) continue;
            totals.set(amount.currency, (totals.get(amount.currency) || 0) + amount.value);
        }
        return Array.from(totals.entries())
            .map(([currency, value]) => `${currency ? currency + ' ' : ''}${value.toFixed(2)}`)
            .join(' + ');
    }

    /* ---------------- navigation ---------------- */

    function getTabButton(name) {
        // The tab row is the one that has BILLING & PURCHASE in it; looking
        // there first keeps "Account" from matching some other control.
        const billing = findButtonByText('billing & purchase');
        const scoped = billing?.parentElement ? findButtonByText(name, billing.parentElement) : null;
        return scoped || findButtonByText(name);
    }

    async function openSubscriptionCharges() {
        let sub = findButtonByText('subscription plans and entitlements');
        if (!sub) {
            const billing = getTabButton('billing & purchase');
            if (!billing) return null;
            realClick(billing);
            sub = await waitFor(() => findButtonByText('subscription plans and entitlements'),
                { timeout: STEP_TIMEOUT_MS, pollMs: 100 });
            if (!sub) return null;
        }
        // Always clicked: One-Time Purchases uses the same table headers, so
        // "a charges table is on screen" does not say which tab it is.
        realClick(sub);
        await sleep(400);
        return waitFor(() => {
            const table = getChargesTable();
            return table && scrapeCharges(table).length ? table : null;
        }, { timeout: STEP_TIMEOUT_MS, pollMs: 150 });
    }

    function isPlanNameLabel(element) {
        return element.children.length === 0 && cleanText(element.textContent) === 'Plan Name';
    }

    function getPlanCards() {
        const cards = [];
        const labels = Array.from(document.querySelectorAll('p, span, div, h6, dt, label'))
            .filter(element => isPlanNameLabel(element) && isVisible(element));
        for (const label of labels) {
            let card = label.parentElement;
            for (let depth = 0; card && depth < 8; depth += 1, card = card.parentElement) {
                const hasCardButton = Array.from(card.querySelectorAll('button'))
                    .some(button => /^(cancel|revert|apply)$/.test(lower(button)));
                if (hasCardButton) break;
            }
            if (card && !cards.includes(card)) cards.push(card);
        }
        return cards;
    }

    function readPlanCard(card) {
        const lines = String(card?.innerText || card?.textContent || '')
            .split('\n').map(cleanText).filter(Boolean);
        const valueAfter = label => {
            const index = lines.findIndex(line => line.toLowerCase() === label);
            return index >= 0 ? (lines[index + 1] || '') : '';
        };
        const cancelButton = Array.from(card?.querySelectorAll('button') || [])
            .find(button => lower(button) === 'cancel' && !button.disabled && isVisible(button)) || null;
        // The card opens with a bare billing-cycle heading ("Monthly",
        // "Annual") above its CANCEL/REVERT buttons - the same heading the
        // snapshot's subscription details report as "Billing Cycle".
        const cycle = /^(?:daily|weekly|bi-?weekly|monthly|bi-?monthly|quarterly|semi-?annual(?:ly)?|annual(?:ly)?|yearly|lifetime|one[- ]time|free\s+trial)$/i
            .test(lines[0] || '') ? lines[0] : '';
        return {
            name: valueAfter('plan name') || lines[0] || 'Subscription',
            cycle,
            price: valueAfter('price'),
            paymentHandler: valueAfter('payment handler'),
            status: valueAfter('status'),
            endDate: valueAfter('end date'),
            cancelButton
        };
    }

    // ACCOUNT > Personal Information holds the account's own Name and Email
    // as plain inputs (#name, #email - read live 2026-09-30). They are what
    // the customer reply is checked against: the email the refund was for,
    // and the first name for the greeting.
    // The account's email and name straight from CMS's identity record -
    // no trip to ACCOUNT > Personal Information. Field names are looked for
    // rather than assumed; anything not found falls back to the screen.
    async function readAccountContactViaApi(ctx) {
        const parsed = await cmsInvoke(ctx, {
            url: `v2/admin/identity/${ctx.userId}`,
            method: 'GET',
            role: 'Customer Support',
            auth: { site: ctx.site, userId: ctx.userId },
            query: { site: ctx.site },
            body: {}
        });
        const found = {};
        (function walk(node, depth) {
            if (!node || typeof node !== 'object' || depth > 3) return;
            for (const [key, value] of Object.entries(node)) {
                if (typeof value === 'string') {
                    if (!found.email && /^e-?mail$/i.test(key) && /@/.test(value)) found.email = value;
                    if (!found.name && /^(name|fullName|displayName)$/i.test(key)) found.name = value;
                    if (!found.first && /^first_?name$/i.test(key)) found.first = value;
                } else if (value && typeof value === 'object') {
                    walk(value, depth + 1);
                }
            }
        })(parsed, 0);
        const email = cleanText(found.email || '').toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
        return { email, firstName: firstNameOf(found.first || found.name || '') };
    }

    async function readAccountContact() {
        const account = getTabButton('account');
        if (account) realClick(account);
        const nav = await waitFor(() => Array.from(document.querySelectorAll('p[role="button"], [role="button"], button'))
            .filter(element => !isOwnUi(element) && isVisible(element))
            .find(element => lower(element) === 'personal information') || null,
        { timeout: STEP_TIMEOUT_MS, pollMs: 100 });
        if (nav) realClick(nav);
        const inputs = await waitFor(() => {
            const email = document.querySelector('input#email');
            return email && !isOwnUi(email) ? { email, name: document.querySelector('input#name') } : null;
        }, { timeout: 8000, pollMs: 150 });
        const email = cleanText(inputs?.email?.value || '').toLowerCase();
        return {
            email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
            firstName: firstNameOf(inputs?.name?.value || '')
        };
    }

    // "John Vera" -> "John". Nothing that does not look like a name - an
    // email pasted into the field, digits, an empty value - so the greeting
    // is left as the scenario wrote it.
    function firstNameOf(fullName) {
        const first = cleanText(fullName).split(' ')[0] || '';
        return /^[\p{L}][\p{L}'-]*$/u.test(first) && first.length > 1 ? first : '';
    }

    async function openSubscriptionPlans() {
        const account = getTabButton('account');
        if (account) realClick(account);
        const nav = await waitFor(() => Array.from(document.querySelectorAll('p[role="button"], [role="button"], button'))
            .filter(element => !isOwnUi(element) && isVisible(element))
            .find(element => lower(element) === 'subscription plans') || null,
        { timeout: STEP_TIMEOUT_MS, pollMs: 100 });
        if (!nav) return false;
        realClick(nav);
        return Boolean(await waitFor(() => getPlanCards().length ? true : null,
            { timeout: STEP_TIMEOUT_MS, pollMs: 150 }));
    }

    /* ---------------- dialogs and drawers ---------------- */

    function getCancelDialog() {
        return Array.from(document.querySelectorAll('[role="dialog"]'))
            .filter(isVisible)
            .find(dialog => /cancel subscription/i.test(cleanText(dialog.textContent))) || null;
    }

    function getRefundModal() {
        const title = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
            .filter(isVisible)
            .find(element => /issue (percentage|fixed amount) refund/i.test(cleanText(element.textContent)));
        return title ? (title.closest('.MuiModal-root, [role="dialog"], [role="presentation"]') || title.parentElement) : null;
    }

    function getDrawer() {
        return Array.from(document.querySelectorAll('.MuiDrawer-paper')).find(isVisible) || null;
    }

    function clickCloseIcon(root) {
        const close = root?.querySelector('svg[data-testid="CloseIcon"]')?.closest('button');
        return close ? realClick(close) : false;
    }

    async function dismissModal(root, isOpen) {
        if (!root || !isOpen()) return true;
        if (!clickCloseIcon(root)) {
            root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
        }
        let closed = await waitFor(() => isOpen() ? null : true, { timeout: 2500, pollMs: 100 });
        if (!closed) {
            const backdrop = root.closest('.MuiModal-root')?.querySelector('.MuiBackdrop-root') ||
                document.querySelector('.MuiBackdrop-root');
            if (backdrop) realClick(backdrop);
            closed = await waitFor(() => isOpen() ? null : true, { timeout: 2500, pollMs: 100 });
        }
        return Boolean(closed);
    }

    function closeRefundModal() {
        return dismissModal(getRefundModal(), () => Boolean(getRefundModal()));
    }

    function closeDrawer() {
        return dismissModal(getDrawer(), () => Boolean(getDrawer()));
    }

    function closeCancelDialog() {
        return dismissModal(getCancelDialog(), () => Boolean(getCancelDialog()));
    }

    function collectAlerts(into) {
        for (const alert of document.querySelectorAll('.MuiSnackbarContent-message, .MuiAlert-message, [role="alert"]')) {
            if (isOwnUi(alert)) continue;
            // The app's route announcer is a [role=alert] that just repeats
            // the page title - it came back as the "reason" "ViewLift - CMS
            // Tools" on a refund that had worked (2026-10-01).
            if (alert.closest('next-route-announcer, #__next-route-announcer__')) continue;
            const text = cleanText(alert.textContent);
            if (!text || text === cleanText(document.title)) continue;
            into.add(text.slice(0, 200));
        }
    }

    /* ---------------- the run ---------------- */

    function addStep(label) {
        const step = { label, state: 'running', detail: '', log: [], startedAt: Date.now() };
        steps.push(step);
        render();
        return step;
    }

    function endStep(step, state, detail = '') {
        step.state = state;
        step.detail = detail;
        step.endedAt = Date.now();
        render();
        return state !== 'failed';
    }

    // One line of what is happening right now, under the running step - the
    // progress view shows these as they arrive (Sebastian, 2026-09-30: "que
    // se vea como progresa, en más líneas").
    function stepLog(step, text) {
        if (!step) return;
        step.log.push(text);
        if (step.log.length > 12) step.log.shift();
        render();
    }

    // Newest subscription record first - its handler and status are the
    // live plan's.
    function latestSubscriptionRecord(records) {
        const time = record => Date.parse(record.completedAt || record.initiatedAt || record.addedDate || '') || 0;
        return records.filter(record => !isRefundRecord(record)).sort((a, b) => time(b) - time(a))[0] || null;
    }

    async function cancelSubscriptions(ticketURL, dryRun) {
        const step = addStep('Cancel Now');
        // API first, with no screen at all: the billing history gives the
        // plan's handler and status, and CANCEL NOW is one call.
        const quickCtx = cmsApiContext();
        if (quickCtx && !dryRun) {
            try {
                stepLog(step, '\u26a1 API: reading the plan from the billing history');
                const latest = latestSubscriptionRecord(await cmsBillingRecords(quickCtx));
                if (latest && latest.paymentHandler) {
                    const name = cleanText(latest.planTitle) || 'Subscription';
                    if (/^cancel/i.test(cleanText(latest.subscriptionStatus))) {
                        lastCancelStatus = cleanText(latest.subscriptionStatus);
                        return { ok: endStep(step, 'done', `Already cancelled (${name}: ${latest.subscriptionStatus})`), lines: [`Account already cancelled - ${name}`] };
                    }
                    stepLog(step, `\u26a1 API: CANCEL NOW - ${name} (${latest.paymentHandler}, was ${latest.subscriptionStatus || 'unknown'})`);
                    const response = await cmsInvoke(quickCtx, {
                        url: 'subscription-misc/refund',
                        method: 'POST',
                        role: 'Customer Support',
                        auth: { site: quickCtx.site, userId: quickCtx.userId },
                        query: { site: quickCtx.site },
                        body: {
                            userId: quickCtx.userId,
                            site: quickCtx.site,
                            comment: ticketURL,
                            paymentHandler: latest.paymentHandler,
                            cancellation: { option: 'CANCEL' },
                            deactivate: false
                        }
                    });
                    if (response && 'error' in response) throw new Error(String(response.error).slice(0, 200));
                    // Fire-and-forget: the cancel is done; the log must not hold the run up.
                    cmsAuditLog(quickCtx, { actionType: 'cancelSubscription', comments: ticketURL, reason: ticketURL });
                    lastCancelStatus = 'CANCELLED';
                    return { ok: endStep(step, 'done', `\u26a1 cancelled now via the API (${name})`), lines: [`Account cancelled now (${name})`] };
                }
                stepLog(step, 'No subscription record with a payment handler - using the screen');
            } catch (error) {
                stepLog(step, `API cancel not possible (${error.message}) - using the screen`);
            }
        }
        stepLog(step, 'Opening ACCOUNT \u203a Subscription Plans');
        if (!await openSubscriptionPlans()) {
            return { ok: endStep(step, 'failed', 'Could not open ACCOUNT > Subscription Plans'), lines: [] };
        }

        const lines = [];
        const cards = getPlanCards().map(card => ({ card, info: readPlanCard(card) }));
        const cancellable = cards.filter(entry => entry.info.cancelButton);

        if (!cancellable.length) {
            // Nothing left to cancel is only fine if CMS already says so.
            const statuses = cards.map(entry => `${entry.info.name}: ${entry.info.status || 'unknown'}`).join('; ');
            const alreadyCancelled = cards.length && cards.every(entry => /cancel/i.test(entry.info.status));
            if (!alreadyCancelled) {
                return { ok: endStep(step, 'failed', `No CANCEL button on the plan (${statuses || 'no plan found'})`), lines };
            }
            lines.push(`Account already cancelled - ${statuses}`);
            return { ok: endStep(step, 'done', `Already cancelled (${statuses})`), lines };
        }

        const apiCtx = cmsApiContext();
        for (const { info } of cancellable) {
            // CANCEL NOW through the same call its button makes
            // (cancellation.option "CANCEL"); the dialog is the fallback.
            if (apiCtx && info.paymentHandler) {
                if (dryRun) {
                    stepLog(step, `would POST subscription-misc/refund - cancellation CANCEL, ${info.paymentHandler}`);
                    lines.push(`Would cancel now: ${info.name} (status ${info.status || 'unknown'})`);
                    continue;
                }
                stepLog(step, `\u26a1 API: CANCEL NOW - ${info.name} (${info.paymentHandler})`);
                try {
                    const response = await cmsInvoke(apiCtx, {
                        url: 'subscription-misc/refund',
                        method: 'POST',
                        role: 'Customer Support',
                        auth: { site: apiCtx.site, userId: apiCtx.userId },
                        query: { site: apiCtx.site },
                        body: {
                            userId: apiCtx.userId,
                            site: apiCtx.site,
                            comment: ticketURL,
                            paymentHandler: info.paymentHandler,
                            cancellation: { option: 'CANCEL' },
                            deactivate: false
                        }
                    });
                    if (response && 'error' in response) throw new Error(String(response.error).slice(0, 200));
                    stepLog(step, 'CMS accepted the cancellation - writing its audit log');
                    await cmsAuditLog(apiCtx, { actionType: 'cancelSubscription', comments: ticketURL, reason: ticketURL });
                    lines.push(`Account cancelled now (${info.name})`);
                    continue;
                } catch (error) {
                    stepLog(step, `API cancel failed (${error.message}) - using the dialog instead`);
                }
            }
            stepLog(step, `${info.name} - status ${info.status || 'unknown'} - clicking CANCEL`);
            realClick(info.cancelButton);
            const dialog = await waitFor(getCancelDialog, { timeout: STEP_TIMEOUT_MS, pollMs: 100 });
            if (!dialog) return { ok: endStep(step, 'failed', `Cancel dialog did not open for ${info.name}`), lines };

            const comments = dialog.querySelector('textarea[placeholder*="comment" i]') ||
                dialog.querySelector('textarea');
            if (!comments) {
                await closeCancelDialog();
                return { ok: endStep(step, 'failed', 'Cancel dialog has no Comments field'), lines };
            }
            if (!cleanText(comments.value)) setControlledValue(comments, ticketURL);
            stepLog(step, 'Comments: the ticket link');
            const filled = await waitFor(() => cleanText(comments.value) ? true : null, { timeout: 3000, pollMs: 100 });
            if (!filled) {
                await closeCancelDialog();
                return { ok: endStep(step, 'failed', 'Could not fill the required Comments field'), lines };
            }

            const cancelNow = await waitFor(() => {
                const button = findButtonByText('cancel now', dialog);
                return button && !button.disabled ? button : null;
            }, { timeout: 5000, pollMs: 100 });
            if (!cancelNow) {
                await closeCancelDialog();
                return { ok: endStep(step, 'failed', 'CANCEL NOW is missing or disabled'), lines };
            }

            if (dryRun) {
                await closeCancelDialog();
                lines.push(`Would cancel now: ${info.name} (status ${info.status || 'unknown'})`);
                continue;
            }

            stepLog(step, 'CANCEL NOW');
            realClick(cancelNow);
            const closed = await waitFor(() => getCancelDialog() ? null : true, { timeout: SUBMIT_SETTLE_MS, pollMs: 150 });
            if (closed) stepLog(step, 'CMS accepted the cancellation - reading the new status');
            if (!closed) {
                return { ok: endStep(step, 'failed', `The cancel dialog stayed open after CANCEL NOW (${info.name})`), lines };
            }

            // The card keeps showing the OLD status for a while (live
            // 2026-09-30: the note said DEFERRED_CANCELLATION while a refresh
            // showed it cancelled). Only report a status once it has changed;
            // never write the stale one into the ticket.
            let status = '';
            await waitFor(() => {
                const after = getPlanCards().map(readPlanCard).find(card => card.name === info.name);
                if (after?.status && after.status !== info.status) {
                    status = after.status;
                    return true;
                }
                return null;
            }, { timeout: 6000, pollMs: 300 });
            lines.push(status
                ? `Account cancelled now (${info.name}) - status: ${status}`
                : `Account cancelled now (${info.name})`);
        }

        return { ok: endStep(step, dryRun ? 'dry-run' : 'done', lines.join('; ')), lines };
    }

    /* ---------------- CMS API mode (2026-10-01) ----------------
     * The calls CMS's own UI makes, read from its bundle (memory.md, "CMS
     * refund / cancel / billing API"): one POST per refund or cancel instead
     * of drawer > menu > dialog > Confirm, the same audit log CMS writes after
     * each, and the billing list as data - so "is it refunded?" is a lookup,
     * not a table refresh. Same envelope and credentials as the user search
     * (POST <api>/v3.0/invoke, Authorization + xApiKey, captured from the CMS
     * app's own requests by bvRecordCmsCreds). Anything missing or refused
     * falls back to the UI path for that step. */
    function cmsApiContext() {
        const site = bvGetSiteForCmsHost(location.hostname);
        const userId = cmsAccountIdFromPath();
        const cred = site ? bvGetCmsCredForSite(site) : null;
        return cred && userId ? { site, userId, cred } : null;
    }

    function cmsInvoke(ctx, data) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: ctx.cred.apiOrigin + BV_CMS_API_PATH,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: ctx.cred.authorization,
                    xApiKey: ctx.cred.xApiKey
                },
                data: JSON.stringify(data),
                timeout: 30000,
                onload: response => {
                    if (response.status === 401 || response.status === 403) {
                        reject(new Error('cms-unauthorized'));
                        return;
                    }
                    let parsed = null;
                    try {
                        parsed = response.responseText ? JSON.parse(response.responseText) : {};
                    } catch (error) {
                        parsed = null;
                    }
                    if (response.status < 200 || response.status >= 300) {
                        const message = parsed && (parsed.error || parsed.message);
                        reject(new Error(`cms-http-${response.status}${message ? `: ${String(message).slice(0, 160)}` : ''}`));
                        return;
                    }
                    if (!parsed) {
                        reject(new Error('cms-bad-json'));
                        return;
                    }
                    resolve(parsed);
                },
                onerror: () => reject(new Error('cms-network-error')),
                ontimeout: () => reject(new Error('cms-timeout'))
            });
        });
    }

    // The audit record CMS itself writes after a refund / cancel, so a run
    // through the API leaves exactly the trail a hand-made one does.
    function cmsAuditLog(ctx, logs) {
        return new Promise(resolve => {
            let sessionId = null;
            try {
                sessionId = window.sessionStorage.getItem('user_session');
            } catch (error) {
                sessionId = null;
            }
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${ctx.cred.apiOrigin}/v3.0/user/admin/logs/${encodeURIComponent(ctx.userId)}`,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: ctx.cred.authorization,
                    Xapikey: ctx.cred.xApiKey
                },
                data: JSON.stringify(Object.assign({ sessionId }, logs)),
                timeout: 15000,
                onload: response => resolve(response.status >= 200 && response.status < 300),
                onerror: () => resolve(false),
                ontimeout: () => resolve(false)
            });
        });
    }

    async function cmsBillingRecords(ctx) {
        const parsed = await cmsInvoke(ctx, {
            url: '/v3/billing/history',
            method: 'GET',
            role: 'Customer Support',
            auth: { site: ctx.site, userId: ctx.userId },
            query: { site: ctx.site, limit: 50, offset: 0, purchaseType: 'SUBSCRIPTION' },
            body: {}
        });
        const records = Array.isArray(parsed.records) ? parsed.records : [];
        runBillingRecords = records;
        return records;
    }

    // The latest billing history read in THIS run. Only this run's own
    // refunds change it, and each refund re-reads it to verify - so the next
    // charge (or the first, after Cancel Now's read) needs no fresh read.
    async function billingRecordsForRun(ctx) {
        return runBillingRecords || cmsBillingRecords(ctx);
    }

    function isRefundRecord(record) {
        return /refund/i.test(String(record && record.transactiontype || ''));
    }

    // The REFUND record of a charge: same gatewayChargeId (CMS's refund call
    // takes the charge's gatewayChargeId as transactionId), or - for
    // handlers that reuse the number - the refund id itself.
    function refundRecordFor(records, order) {
        return records.find(record => isRefundRecord(record) &&
            (cleanText(record.gatewayChargeId) === order || cleanText(record.gatewayRefundId) === order)) || null;
    }

    // A REFUND record shaped like a table row, for the note.
    function recordToRow(record, charge) {
        const amount = Number(record.totalAmount);
        return {
            date: record.completedAt || record.initiatedAt
                ? new Date(record.completedAt || record.initiatedAt).toLocaleDateString('en-US')
                : '',
            title: cleanText(record.planTitle) || charge.title,
            type: 'REFUND',
            order: cleanText(record.gatewayRefundId) || cleanText(record.gatewayChargeId) || charge.order,
            amount: Number.isFinite(amount) ? `${cleanText(record.currencyCode)} ${amount.toFixed(2)}`.trim() : charge.amount,
            handler: cleanText(record.paymentHandler) || charge.handler,
            offer: charge.offer || 'N/A'
        };
    }

    async function waitForRefundRecord(ctx, order, step, timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        let pass = 0;
        while (Date.now() < deadline) {
            pass += 1;
            try {
                const records = await cmsBillingRecords(ctx);
                const refund = refundRecordFor(records, order);
                if (refund) return refund;
                stepLog(step, `Billing history: no REFUND yet (check ${pass})`);
            } catch (error) {
                stepLog(step, `Billing history read failed: ${error.message}`);
            }
            await sleep(1500);
        }
        return null;
    }

    // One charge, refunded with the same call the dialog's Confirm makes.
    // Returns true / false like refundCharge, or null = use the UI path.
    async function refundChargeViaApi(charge, dryRun, step, ctx) {
        let records;
        try {
            stepLog(step, runBillingRecords ? '\u26a1 API: billing history already read this run' : '\u26a1 API: reading the billing history');
            records = await billingRecordsForRun(ctx);
        } catch (error) {
            stepLog(step, `API unavailable (${error.message}) - using the screen instead`);
            return null;
        }
        const record = records.find(item => !isRefundRecord(item) && cleanText(item.gatewayChargeId) === charge.order);
        if (!record) {
            stepLog(step, 'This charge is not in the billing history - using the screen instead');
            return null;
        }
        // The record must be THIS account on THIS site - otherwise the
        // credentials/site resolved for the API are not the page's, and the
        // screen (which is) does it instead.
        if ((record.userId && cleanText(record.userId) !== ctx.userId) || (record.site && cleanText(record.site) !== ctx.site)) {
            stepLog(step, 'The billing record is for another account or site - using the screen instead');
            return null;
        }
        const existing = refundRecordFor(records, charge.order);
        if (existing) {
            charge.refundRow = recordToRow(existing, charge);
            return endStep(step, 'done', `already refunded in CMS (${charge.refundRow.order}) - not refunded twice`);
        }

        const ticketURL = getTicketURL();
        const request = {
            method: 'POST',
            role: 'Customer Support',
            url: '/subscription-misc/refund',
            query: { site: ctx.site, userId: ctx.userId },
            auth: { site: ctx.site, userId: ctx.userId },
            body: {
                refundPercentage: 100,
                comment: `Customer wanted a refund: ${ticketURL}`,
                deactivate: false,
                paymentHandler: record.paymentHandler,
                revokeAccess: false,
                site: ctx.site,
                transactionId: record.gatewayChargeId,
                userId: ctx.userId
            }
        };
        if (dryRun) {
            stepLog(step, `would POST subscription-misc/refund - 100%, ${record.paymentHandler}, transactionId ${record.gatewayChargeId}`);
            return endStep(step, 'dry-run', 'API request built, not sent (dry run)');
        }

        stepLog(step, `\u26a1 API: refund 100% of ${record.gatewayChargeId} (${record.paymentHandler})`);
        let callError = null;
        try {
            const response = await cmsInvoke(ctx, request);
            if (response && 'error' in response) callError = new Error(String(response.error).slice(0, 200));
        } catch (error) {
            callError = error;
        }
        if (callError) stepLog(step, `CMS answered: ${callError.message} - checking whether it went through anyway`);
        else {
            stepLog(step, 'CMS accepted the refund - audit log written in the background');
            // Not awaited (like Cancel Now's): the log must not hold the run up.
            cmsAuditLog(ctx, { actionType: 'refund', comments: 'Issued refund of percentage: 100%, Reason: ROTH', reason: 'ROTH' })
                .then(logged => { if (!logged) console.warn('[BV Refund Assist] Refund audit log could not be written (the refund itself is done).'); });
        }

        // Never retried blindly: the billing history says whether it happened.
        const refund = await waitForRefundRecord(ctx, charge.order, step, callError ? 12000 : 20000);
        if (refund) {
            charge.refundRow = recordToRow(refund, charge);
            if (callError) cmsAuditLog(ctx, { actionType: 'refund', comments: 'Issued refund of percentage: 100%, Reason: ROTH', reason: 'ROTH' });
            return endStep(step, 'done', `\u26a1 refunded via the API - REFUND ${charge.refundRow.order}`);
        }
        return endStep(step, 'failed', callError
            ? `API refund failed: ${callError.message} - and no REFUND in the billing history (use Recheck)`
            : 'CMS accepted the refund but it has not shown in the billing history yet (use Recheck)');
    }

    async function refundCharge(charge, dryRun) {
        const step = addStep(`Refund ${charge.date} ${charge.amount} (${charge.order})`);
        const apiCtx = cmsApiContext();
        if (apiCtx) {
            const viaApi = await refundChargeViaApi(charge, dryRun, step, apiCtx);
            if (viaApi !== null) return viaApi;
        }
        const bridge = getBridge();
        if (!bridge?.start) return endStep(step, 'failed', 'The refund workflow (Feature 3) is not loaded');

        stepLog(step, 'Opening SUBSCRIPTION PLANS AND ENTITLEMENTS');
        if (!await openSubscriptionCharges()) return endStep(step, 'failed', 'Could not open SUBSCRIPTION PLANS AND ENTITLEMENTS');
        await closeRefundModal();
        if (!await closeDrawer()) {
            return endStep(step, 'failed', 'The previous charge\'s details drawer would not close - stopped so this refund cannot land on the wrong charge');
        }

        const row = findChargeRow(charge.order);
        const eye = row?.querySelector('svg[data-testid="VisibilityIcon"]')?.closest('button');
        if (!eye) return endStep(step, 'failed', 'Charge not found on this page of the table');
        stepLog(step, `Found the charge row - opening its details`);

        // The flag keeps Feature 3's own eye listener from also starting an
        // unpinned run off this click; start() below pins it to the order.
        window.__bvRefundAssistDriving = true;
        try {
            realClick(eye);
        } finally {
            window.__bvRefundAssistDriving = false;
        }

        const drawer = await waitFor(() => {
            const open = getDrawer();
            return open && textHasOrder(cleanText(open.innerText || open.textContent), charge.order) ? open : null;
        }, { timeout: STEP_TIMEOUT_MS, pollMs: 100 });
        if (!drawer) return endStep(step, 'failed', 'The charge details drawer did not open');
        stepLog(step, `Drawer confirms order ${charge.order}`);
        stepLog(step, 'Refund \u203a Issue percentage refund - 100%, reason ROTH, ticket link');

        const result = await Promise.race([
            new Promise(resolve => bridge.start({ order: charge.order, onFinish: resolve })),
            sleep(WORKFLOW_BACKSTOP_MS).then(() => ({ outcome: 'failed', detail: 'refund workflow did not finish' }))
        ]);

        if (result.outcome === 'dry-run') {
            await closeRefundModal();
            await closeDrawer();
            return endStep(step, 'dry-run', 'Dialog filled (100%, ROTH, ticket link) - not confirmed');
        }
        if (result.outcome !== 'submitted') {
            await closeRefundModal();
            await closeDrawer();
            return endStep(step, 'failed', result.detail || 'refund workflow failed');
        }

        stepLog(step, 'Confirm Refund - waiting for CMS');
        const alerts = new Set();
        const closed = await waitFor(() => {
            collectAlerts(alerts);
            return getRefundModal() ? null : true;
        }, { timeout: SUBMIT_SETTLE_MS, pollMs: 150 });
        if (closed) stepLog(step, 'CMS closed the refund dialog');
        await sleep(700);
        collectAlerts(alerts);
        const alertText = Array.from(alerts).join(' | ');

        if (!closed) {
            // CMS sometimes keeps the dialog up although the refund went
            // through (live 2026-10-01, a Google Play charge: the REFUND row
            // was in the table). The table is the truth, not the dialog.
            stepLog(step, 'CMS kept the dialog open - checking the table for the refund');
            await closeRefundModal();
            await closeDrawer();
            await attachRefundRows([charge], step, 25000);
            if (charge.refundRow) {
                return endStep(step, 'done', `CMS kept the dialog open, but REFUND ${charge.refundRow.order} is in the table`);
            }
            return endStep(step, 'failed', `Refund dialog still open after Confirm Refund and no REFUND row in the table${alertText ? ` - ${alertText}` : ''} - use Recheck`);
        }
        if (/\b(error|fail(ed|ure)?|unable|could not|invalid|declined)\b/i.test(alertText)) {
            await closeDrawer();
            return endStep(step, 'failed', alertText);
        }

        await closeDrawer();
        return endStep(step, 'done', alertText || 'Confirm Refund accepted');
    }

    function chargeCells(charge) {
        return [charge.date, charge.title, charge.type, charge.order, charge.amount, charge.handler, charge.offer]
            .map(value => cleanText(value));
    }

    // The layout Sebastian asked for (2026-09-30, modelled on his own note):
    //   (Annual Plan)
    //   CMS: <account link>
    //   Subscription details - Billing Cycle / Plan Name / Price / Status
    //   then the CMS table rows: each refunded charge's REFUND row (the re_
    //   id) above its CHARGE row, exactly as CMS lists them.
    // Returns { lines, rows, after }: text above the table, the table, and
    // anything that went wrong below it.
    function buildNote({ dryRun, cancelOk, plan, cmsUrl, done, failed, skipped }) {
        const lines = [];
        if (dryRun) lines.push({ text: 'DRY RUN - nothing was cancelled or refunded', bold: true });
        if (!cancelOk) lines.push({ text: 'Cancellation failed - no refunds issued', bold: true });
        if (plan?.name) lines.push({ text: `(${plan.name})` });
        if (cmsUrl) lines.push({ text: `CMS: ${cmsUrl}`, href: cmsUrl });

        const details = [
            ['Billing Cycle', plan?.cycle],
            ['Plan Name', plan?.name],
            ['Price', plan?.price],
            ['Status', plan?.status]
        ].filter(([, value]) => cleanText(value));
        if (details.length) {
            lines.push({ text: 'Subscription details', bold: true });
            details.forEach(([label, value]) => lines.push({ text: `${label}: ${cleanText(value)}` }));
        }

        const rows = [];
        for (const charge of done) {
            if (charge.refundRow) rows.push(chargeCells(charge.refundRow));
            rows.push(chargeCells(charge));
        }

        // A refund whose REFUND row CMS never listed keeps just its CHARGE row
        // here - no warning line in the ticket (asked for, 2026-09-30); the
        // run's panel says so instead.
        const after = [];
        const notDone = [
            ...failed.map(({ charge, reason }) => `${charge.date} - ${charge.amount} - ${charge.order} - failed: ${reason}`),
            ...skipped.map(charge => `${charge.date} - ${charge.amount} - ${charge.order} - not done`)
        ];
        if (notDone.length) {
            after.push({ text: 'Not refunded:', bold: true });
            notDone.forEach(text => after.push({ text }));
        }
        return { lines, rows, after };
    }

    // Tab-separated rows, like copying the table straight out of CMS.
    function noteToText(note) {
        const block = list => list.map(line => line.text).join('\n');
        return [
            block(note.lines),
            note.rows.length ? note.rows.map(cells => cells.join('\t')).join('\n') : '',
            block(note.after)
        ].filter(Boolean).join('\n\n');
    }

    // pasteNote: the Freshdesk tab writes the lines into an unsaved private
    // note (the no-API-key fallback, and dry runs). applyScenario: the tab
    // clicks Apply on that scenario so its customer reply lands in the reply
    // editor for review - only queued once the note is already saved,
    // because the reply editor replaces an open note draft.
    function queueNote(ticketURL, note, { pasteNote = true, submitNote = false, applyScenario = '', replyEmail = '', replyFirstName = '', refundCount = 0, updateProperties = false } = {}) {
        try {
            let queue = GM_getValue(BV_REFUND_ASSIST_NOTE_KEY, []);
            if (!Array.isArray(queue)) queue = [];
            const now = Date.now();
            queue = queue.filter(entry => entry && now - Number(entry.createdAt || 0) < BV_REFUND_ASSIST_NOTE_TTL_MS);
            queue.push({
                ticketUrl: ticketURL,
                createdAt: now,
                lines: pasteNote ? (note?.lines || []) : [],
                rows: pasteNote ? (note?.rows || []) : [],
                after: pasteNote ? (note?.after || []) : [],
                pasteNote,
                // Click Add note after pasting (the API could not save it).
                submitNote: pasteNote && submitNote,
                applyScenario,
                replyEmail,
                replyFirstName,
                // How many refunds the reply should mention (only said when > 1).
                refundCount,
                // Click the properties Update after the send (the API could
                // not set the scenario fields).
                updateProperties
            });
            GM_setValue(BV_REFUND_ASSIST_NOTE_KEY, queue);
            return true;
        } catch (error) {
            console.warn('[BV Refund Assist] Could not queue the Freshdesk note.', error);
            return false;
        }
    }

    /* ---------------- Freshdesk API (writes need the agent's own key) ---------------- */

    // Measured 2026-09-30: the Freshdesk session cookie is enough to READ the
    // API but every write (POST note, PUT ticket) comes back 401
    // invalid_credentials. So writes go through freshdeskApiRequest() with
    // the key each agent sets for themselves (Tampermonkey menu > "Freshdesk:
    // Set API Key") - which also means they work straight from this CMS tab.
    const REFUNDED_SCENARIO_NAME = 'B2C Account Refunded';
    // Read live on 2026-09-30 (id 43001069613). Only used when the scenario
    // list itself cannot be read; the live definition always wins.
    const REFUNDED_SCENARIO_FALLBACK_ACTIONS = [
        { name: 'status', value: '12' },
        { name: 'ticket_type', value: 'Refund' },
        { name: 'add_tag', value: 'Refunded' },
        { name: 'add_reply' },
        { name: 'responder_id', value: '-2' }
    ];
    // FOX answers in Spanish with its own scenario (Sebastian, 2026-09-30:
    // "para FOX quiero que uses el scenario de FOX refunded"). Read live, id
    // 43001063853.
    const FOX_REFUNDED_SCENARIO_NAME = 'FOX Refunded';
    const FOX_REFUNDED_SCENARIO_FALLBACK_ACTIONS = [
        { name: 'ticket_type', value: 'Refund' },
        { name: 'responder_id', value: '-2' },
        { name: 'add_tag', value: 'Refunded' },
        { name: 'status', value: '12' },
        { name: 'cf_platform_976229', value: 'Web' },
        { name: 'add_reply' }
    ];
    const SCENARIO_FALLBACKS = {
        [REFUNDED_SCENARIO_NAME]: REFUNDED_SCENARIO_FALLBACK_ACTIONS,
        [FOX_REFUNDED_SCENARIO_NAME]: FOX_REFUNDED_SCENARIO_FALLBACK_ACTIONS
    };

    // FOX One has its own CMS host, which makes the brand unambiguous here.
    function getRefundedScenarioName() {
        return location.hostname === 'foxone.cms.viewlift.com'
            ? FOX_REFUNDED_SCENARIO_NAME
            : REFUNDED_SCENARIO_NAME;
    }

    function freshdeskApi(method, path, body) {
        return new Promise((resolve, reject) => {
            freshdeskApiRequest({
                method,
                path,
                body,
                onDone: (error, data) => (error ? reject(error) : resolve(data))
            });
        });
    }

    function describeApiError(error) {
        const message = String(error?.message || error);
        if (message === 'no-api-key') return 'no Freshdesk API key set';
        if (message === 'unauthorized') return 'API key rejected';
        if (message === 'rate-limited') {
            return `Freshdesk API rate limit reached for the whole account${error.retryAfter ? ` (free again in ~${Math.ceil(error.retryAfter / 60)} min)` : ''}`;
        }
        const detail = cleanText(error?.responseBody || '').slice(0, 160);
        return detail ? `${message}: ${detail}` : message;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function lineToHtml(line) {
        if (line.bold) return `<strong>${escapeHtml(line.text)}</strong>`;
        // Only the account link is ever a link, and only to a CMS host.
        if (line.href && /^https:\/\//i.test(line.href)) {
            try {
                if (isCMSHost(new URL(line.href).hostname)) {
                    const label = line.text.startsWith('CMS: ') ? 'CMS: ' : '';
                    return `${label}<a href="${escapeHtml(line.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(line.href)}</a>`;
                }
            } catch (error) {
                // Not a URL - falls through to plain text.
            }
        }
        return escapeHtml(line.text);
    }

    function noteLinesToHtml(lines) {
        return `<div>${lines.map(lineToHtml).join('<br>')}</div>`;
    }

    function noteToHtml(note) {
        const parts = [];
        if (note.lines.length) parts.push(noteLinesToHtml(note.lines));
        if (note.rows.length) {
            // Freshdesk keeps the <table> but gives its cells no padding, so
            // the columns ran together (live, 2026-09-30). Inline padding,
            // plus a trailing gap in case the style attribute is stripped.
            parts.push(`<table style="border-collapse:collapse"><tbody>${note.rows.map(cells =>
                `<tr>${cells.map(cell => `<td style="padding:6px 18px 6px 0;vertical-align:top">${escapeHtml(cell)}&nbsp;&nbsp;&nbsp;</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        }
        if (note.after.length) parts.push(noteLinesToHtml(note.after));
        return parts.join('<br>');
    }

    // The scenario's actions translated into one v2 ticket update. The reply
    // (add_reply) and anything else the public API cannot express are left
    // out and reported, never guessed at.
    function scenarioActionsToUpdate(actions, ticket, myAgentId) {
        const update = {};
        const customFields = {};
        const skipped = [];
        const tags = Array.isArray(ticket?.tags) ? ticket.tags.slice() : [];
        let tagsChanged = false;

        for (const action of actions || []) {
            const value = action?.value;
            switch (action?.name) {
                case 'status': update.status = Number(value); break;
                case 'priority': update.priority = Number(value); break;
                case 'ticket_type': update.type = String(value); break;
                case 'group_id': update.group_id = Number(value); break;
                case 'product_id': update.product_id = Number(value); break;
                case 'responder_id': {
                    const id = String(value) === '-2' ? myAgentId : Number(value);
                    if (id) update.responder_id = id;
                    else skipped.push('responder_id');
                    break;
                }
                case 'add_tag':
                    String(value || '').split(',').map(tag => tag.trim()).filter(Boolean).forEach(tag => {
                        if (!tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) {
                            tags.push(tag);
                            tagsChanged = true;
                        }
                    });
                    break;
                default: {
                    // Scenarios address custom fields as cf_<name>_<accountId>;
                    // the v2 API wants plain cf_<name>.
                    const match = /^(cf_.+)_\d+$/.exec(String(action?.name || ''));
                    if (match && value !== undefined) customFields[match[1]] = value;
                    else skipped.push(String(action?.name || 'unknown'));
                }
            }
        }

        if (tagsChanged) update.tags = tags;
        if (Object.keys(customFields).length) update.custom_fields = customFields;
        return { update, skipped };
    }

    async function getScenarioActions(name) {
        try {
            const data = await freshdeskApi('GET', '/api/_/scenario_automations');
            const scenario = (data?.scenario_automations || []).find(item => item?.name === name);
            if (scenario) return { actions: scenario.actions || [], source: 'live' };
        } catch (error) {
            console.warn('[BV Refund Assist] Could not read the scenario list; using the built-in copy.', error);
        }
        return { actions: SCENARIO_FALLBACKS[name] || [], source: 'built-in copy' };
    }

    // The scenario's reads (its actions, the ticket, me) - read-only, so
    // runAssist starts them while CMS is still cancelling/refunding.
    function readScenarioInputs(ticketId, name) {
        return Promise.all([
            getScenarioActions(name),
            freshdeskApi('GET', `/api/v2/tickets/${ticketId}`),
            freshdeskApi('GET', '/api/v2/agents/me')
        ]);
    }

    async function applyScenarioViaApi(ticketId, name, inputs) {
        const [{ actions, source }, ticket, me] = await (inputs || readScenarioInputs(ticketId, name));
        const { update, skipped } = scenarioActionsToUpdate(actions, ticket, me?.id);
        // The status is deliberately NOT set here. The ticket tab's "Send and
        // set as Waiting on End User" sets it - and the SCHN+ Case Tracker
        // userscript counts a case by seeing exactly that status change go
        // out from the Freshdesk page. Setting it first from this CMS tab
        // (invisible to the tracker) left the send with no status change to
        // carry, so the case was never tracked (2026-09-30).
        if ('status' in update) {
            delete update.status;
            skipped.push('status (set by the send)');
        }
        if (!Object.keys(update).length) return { changed: [], skipped, source };
        await freshdeskApi('PUT', `/api/v2/tickets/${ticketId}`, update);
        return { changed: Object.keys(update), skipped, source };
    }

    function copyText(text) {
        try {
            GM_setClipboard(text, 'text');
            return true;
        } catch (error) {
            console.warn('[BV Refund Assist] Clipboard write failed.', error);
            return false;
        }
    }

    async function runAssist() {
        if (running) return;
        const ticketURL = getTicketURL();
        if (!ticketURL) return;
        const picked = charges.filter(charge => selected.has(charge.order) && isRefundable(charge));
        const dryRun = isDryRun();

        running = true;
        view = 'run';
        steps = [];
        lastNoteText = '';
        runClaimedRefundKeys = new Set();
        lastCancelStatus = '';
        runBillingRecords = null;
        // How many steps this run should take, for the progress bar: cancel,
        // one per refund, refund ids, contact/plan read, note, scenario,
        // refund-log row, back to the ticket. A real run can only grow it.
        plannedSteps = (cancelFirst ? 1 : 0) + picked.length + 1 +
            (dryRun ? 0 : 4);
        runStartedAt = Date.now();
        render();

        // Everything the run did and left undone, kept for Recheck.
        const run = {
            ticketURL,
            ticketId: getTicketNumber(ticketURL),
            dryRun,
            picked,
            cancelWanted: cancelFirst,
            cancelOk: true,
            done: [],
            failed: [],
            skipped: [],
            contact: { email: '', firstName: '' },
            noteSaved: false,
            handedToTicketTab: false,
            scenarioDone: false,
            sheetDone: false
        };
        lastRun = run;

        // Contact by API in the background while the cancel/refunds run;
        // only if that fails is the screen used, AFTER them (it navigates).
        const apiCtx = cmsApiContext();
        const contactPromise = apiCtx
            ? readAccountContactViaApi(apiCtx).catch(error => {
                console.warn('[BV Refund Assist] Identity read by API failed.', error);
                return null;
            })
            : Promise.resolve(null);
        run.apiCtx = apiCtx;
        // Same for the scenario's reads on Freshdesk.
        if (!dryRun && getFreshdeskApiKey() && run.ticketId) {
            run.scenarioInputs = readScenarioInputs(run.ticketId, getRefundedScenarioName());
            run.scenarioInputs.catch(() => {});
        }

        try {
            if (cancelFirst) {
                const cancel = await cancelSubscriptions(ticketURL, dryRun);
                run.cancelOk = cancel.ok;
            }
            if (!run.cancelOk) {
                run.skipped.push(...picked);
            } else {
                await refundEach(run, picked);
            }
        } catch (error) {
            console.error('[BV Refund Assist] Run crashed.', error);
            addStep('Unexpected error').state = 'failed';
            steps[steps.length - 1].detail = String(error?.message || error);
            const handled = new Set([...run.done, ...run.failed.map(entry => entry.charge), ...run.skipped]);
            run.skipped.push(...picked.filter(charge => !handled.has(charge)));
        }

        run.contact = await contactPromise;
        if (!run.contact) {
            try {
                run.contact = await readAccountContact();
            } catch (error) {
                console.warn('[BV Refund Assist] Could not read the account name/email.', error);
                run.contact = { email: '', firstName: '' };
            }
        }

        await finishRun(run);
    }

    // Refunds the given charges in order; the first failure stops the rest,
    // which are listed as skipped.
    async function refundEach(run, list) {
        for (let index = 0; index < list.length; index += 1) {
            const charge = list[index];
            const ok = await refundCharge(charge, run.dryRun);
            if (ok) {
                run.done.push(charge);
            } else {
                run.failed.push({ charge, reason: steps[steps.length - 1]?.detail || 'failed' });
                run.skipped.push(...list.slice(index + 1));
                break;
            }
        }
    }

    // "2nd run" (Sebastian, 2026-10-01: a refund went through but the run
    // reported it failed - "un botón como de recheck"). Looks for every
    // failed / skipped charge's REFUND row first - a refund that did happen
    // is never issued twice - refunds only what is really still unrefunded,
    // then finishes whatever the first run left undone.
    async function recheckRun() {
        const run = lastRun;
        if (!run || running || run.dryRun) return;
        running = true;
        view = 'run';
        steps = [];
        runBillingRecords = null;
        runStartedAt = Date.now();
        const pending =[...run.failed.map(entry => entry.charge), ...run.skipped];
        plannedSteps = 1 + (run.cancelWanted && !run.cancelOk ? 1 : 0) + pending.length + 4;
        render();

        try {
            if (run.cancelWanted && !run.cancelOk) {
                const cancel = await cancelSubscriptions(run.ticketURL, false);
                run.cancelOk = cancel.ok;
            }

            const checkStep = addStep('Recheck - are the refunds in CMS after all?');
            run.failed = [];
            run.skipped = [];
            if (pending.length) {
                await attachRefundRows(pending, checkStep, 20000);
            }
            const confirmed = pending.filter(charge => charge.refundRow);
            const still = pending.filter(charge => !charge.refundRow);
            confirmed.forEach(charge => {
                run.done.push(charge);
                stepLog(checkStep, `${charge.date} ${charge.amount} is refunded in CMS`);
            });
            endStep(checkStep, 'done', pending.length
                ? `${confirmed.length} confirmed in CMS, ${still.length} still to refund`
                : 'nothing was pending - finishing the remaining steps');

            if (still.length) {
                if (run.cancelOk) await refundEach(run, still);
                else run.skipped.push(...still);
            }
        } catch (error) {
            console.error('[BV Refund Assist] Recheck crashed.', error);
            addStep('Unexpected error').state = 'failed';
            steps[steps.length - 1].detail = String(error?.message || error);
        }

        await finishRun(run, { recheck: true });
    }

    // Everything after the refunds: refund ids, the note, the scenario, the
    // refund-log row, and the hand-off. On a recheck, only what is still
    // missing is done (the note is posted again so the ticket ends up with
    // the corrected record).
    async function finishRun(run, { recheck = false } = {}) {
        const { dryRun, done, failed, skipped, contact, ticketURL, ticketId } = run;

        // What the note reports is read back from CMS after the fact - the
        // refund ids and the plan's final status - never assumed.
        const needIds = done.filter(charge => !charge.refundRow);
        if (!dryRun && needIds.length) {
            const refundStep = addStep('Read the refund ids back from CMS');
            try {
                await attachRefundRows(needIds, refundStep);
                const missing = done.filter(charge => !charge.refundRow).length;
                endStep(refundStep, 'done', missing
                    ? `${done.length - missing} of ${done.length} found - CMS has not listed the rest yet`
                    : done.map(charge => charge.refundRow.order).join(', '));
            } catch (error) {
                endStep(refundStep, 'done', `could not re-read the table (${String(error?.message || error)})`);
            }
        }
        let plan = null;
        try {
            // After an API cancel the card never refreshes, so waiting for
            // it to say CANCELLED only cost 8s (live 2026-10-01, and the note
            // then said "CMS still showed DEFERRED_CANCELLATION"): read it
            // once and take the status from the cancel itself.
            const apiCancelled = Boolean(lastCancelStatus);
            plan = await readFinalPlan(run.cancelWanted && run.cancelOk && !dryRun && !apiCancelled, run.picked[0]?.title || '');
            if (plan && apiCancelled) plan = Object.assign({}, plan, { status: lastCancelStatus });
        } catch (error) {
            console.warn('[BV Refund Assist] Could not re-read the plan card.', error);
        }

        const note = buildNote({ dryRun, cancelOk: run.cancelOk, plan, cmsUrl: location.href, done, failed, skipped });
        lastNoteText = noteToText(note);
        const copied = copyText(lastNoteText);

        // 3. The refund-log row runs ALONGSIDE the note and the scenario -
        // it only needs the refunds, which are done by now.
        const sheetTask = (async () => {
            // 3. The refund log row, through the Refund Capture panel - only
            // for refunds that really happened, and only once.
            const sheetBridge = window.__bvRefundSheet;
            if (done.length && !dryRun && !run.sheetDone) {
                const sheetStep = addStep('Refund log row');
                if (!sheetBridge?.fillAndSend) {
                    endStep(sheetStep, 'failed', 'the Refund Capture panel is not loaded on this page');
                } else {
                    stepLog(sheetStep, 'Filling the Refund Capture panel and finding the first free row');
                    try {
                        const handlers = Array.from(new Set(done.map(charge => cleanText(charge.handler)).filter(Boolean)));
                        const sent = await sheetBridge.fillAndSend({
                            email: contact.email,
                            freshdesk: ticketURL,
                            cms: location.href,
                            payment: handlers.join(' / '),
                            amount: formatRefundAmount(done)
                        });
                        if (sent?.queued) run.sheetDone = true;
                        endStep(sheetStep, sent?.queued ? 'done' : 'failed', sent?.queued
                            ? `${String(sent.sheetKey || '').toUpperCase()}${sent.row ? ` row ${sent.row}` : ''} - written by the sheet tab on the first free row; it closes itself when saved`
                            : (sent?.reason || 'could not find the next free row - the row is on your clipboard'));
                    } catch (error) {
                        endStep(sheetStep, 'failed', String(error?.message || error));
                    }
                }
            }

        })();

        // 1. The private note. With a key it is saved through the API. When
        // the API is unavailable - no key, or the account-wide rate limit
        // (429, live 2026-09-30) - the ticket tab does the WHOLE rest through
        // the Freshdesk UI itself, in order: paste + Add note, Apply the
        // scenario, check and send the reply, Update the properties. The UI
        // runs on Freshdesk's own internal API, which kept working while
        // /api/v2 was blocked. A dry run only pastes the note, unsaved.
        // A recheck posts it again only when the record changed.
        const scenarioName = getRefundedScenarioName();
        const wantsScenario = !dryRun && done.length > 0 && !run.scenarioDone;
        const noteChanged = !recheck || done.length > 0;
        let noteSavedNow = false;
        let handedNow = false;
        // With a key, the scenario's field update goes out ALONGSIDE the note
        // rather than after it (its reads were started with the run). If the
        // note then fails, the ticket tab redoes the same fields in the UI -
        // same values, nothing lost.
        let scenarioPromise = null;
        if (wantsScenario && getFreshdeskApiKey()) {
            scenarioPromise = applyScenarioViaApi(ticketId, scenarioName, recheck ? null : run.scenarioInputs);
            scenarioPromise.catch(() => {});
        }
        if (noteChanged) {
            const noteStep = addStep(`Private note on #${ticketId}${recheck ? ' (corrected)' : ''}`);
            let apiProblem = '';
            if (!dryRun && getFreshdeskApiKey()) {
                stepLog(noteStep, 'Posting the private note through the Freshdesk API');
                try {
                    await freshdeskApi('POST', `/api/v2/tickets/${ticketId}/notes`, {
                        body: noteToHtml(note),
                        private: true
                    });
                    noteSavedNow = true;
                    run.noteSaved = true;
                    endStep(noteStep, 'done', `saved via the API${copied ? ', also copied' : ''}`);
                } catch (error) {
                    apiProblem = describeApiError(error);
                }
            } else if (!dryRun) {
                apiProblem = 'no Freshdesk API key set (Tampermonkey > Freshdesk: Set API Key)';
            }

            if (dryRun) {
                // The dry run is a test-only path now (page attribute, no
                // menu): it never reaches Freshdesk - a test once left a DRY
                // RUN draft in a real ticket's editor (2026-10-01).
                endStep(noteStep, 'dry-run', `not sent to Freshdesk (dry run)${copied ? ' - copied to the clipboard' : ''}`);
            } else if (!noteSavedNow) {
                const queued = queueNote(ticketURL, note, {
                    submitNote: true,
                    applyScenario: wantsScenario ? scenarioName : '',
                    replyEmail: contact.email,
                    replyFirstName: contact.firstName,
                    refundCount: done.length,
                    updateProperties: wantsScenario
                });
                handedNow = queued;
                if (handedNow) run.handedToTicketTab = true;
                endStep(noteStep, queued ? 'done' : 'failed', queued
                    ? `${apiProblem} - the ticket tab adds it through Freshdesk itself`
                    : `${apiProblem} - and it could not be queued for the ticket tab`);
            }
        }

        // 2. The scenario - only when money was actually refunded, once.
        if (wantsScenario) {
            const scenarioStep = addStep(`Scenario: ${scenarioName}`);
            const replyPlan = contact.email
                ? `the ticket tab checks the reply says ${contact.email}${contact.firstName ? ` / greets ${contact.firstName}` : ''}${done.length > 1 ? ` / mentions the ${done.length} refunds` : ''} and sends it (Waiting on End User)`
                : 'no account email read - the reply is left in the editor for you to send';
            if (handedNow) {
                run.scenarioDone = true;
                endStep(scenarioStep, 'done', `Apply + Update done by the ticket tab after the note - ${replyPlan}`);
            } else if (!noteSavedNow && !run.noteSaved) {
                endStep(scenarioStep, 'failed', 'not applied - the note could not be saved or queued');
            } else {
                stepLog(scenarioStep, 'Reading the scenario and setting its fields through the API');
                try {
                    const result = await (scenarioPromise || applyScenarioViaApi(ticketId, scenarioName));
                    // The customer reply cannot go through the API and must
                    // be checked anyway: the ticket tab clicks Apply so it
                    // lands in the reply editor, then checks and sends it.
                    queueNote(ticketURL, null, {
                        pasteNote: false,
                        applyScenario: scenarioName,
                        replyEmail: contact.email,
                        replyFirstName: contact.firstName,
                        refundCount: done.length
                    });
                    run.scenarioDone = true;
                    endStep(scenarioStep, 'done', `set ${result.changed.join(', ') || 'nothing new'} (${result.source}) - ${replyPlan}`);
                } catch (error) {
                    // The note is saved; let the ticket tab do the scenario in
                    // the UI instead of giving up on it.
                    const queued = queueNote(ticketURL, null, {
                        pasteNote: false,
                        applyScenario: scenarioName,
                        replyEmail: contact.email,
                        replyFirstName: contact.firstName,
                        refundCount: done.length,
                        updateProperties: true
                    });
                    if (queued) run.scenarioDone = true;
                    endStep(scenarioStep, queued ? 'done' : 'failed', queued
                        ? `API: ${describeApiError(error)} - the ticket tab applies it and clicks Update instead - ${replyPlan}`
                        : `API: ${describeApiError(error)}`);
                }
            }
        }

        // The refund log row was started alongside the note (see sheetTask).
        await sheetTask;

        running = false;
        render();

        // Only a run where everything worked closes CMS: anything that failed
        // stays on screen in this panel, which is where it is explained (and
        // where Recheck is). Handed to the ticket tab counts as done:
        // bringing that tab forward is exactly what lets it finish the job.
        const allGood = !dryRun && run.cancelOk && (run.noteSaved || run.handedToTicketTab) &&
            !failed.length && !skipped.length && steps.every(step => step.state !== 'failed');
        saveRunTimings(run, allGood);
        if (allGood) await handOffToTicket(ticketId);
    }

    // A refund issued seconds ago is not in the list CMS already fetched, so
    // the table is reloaded (One-Time Purchases and back) until each refunded
    // Stripe / Google Play charge has its REFUND row, or the time runs out.
    // Toggling the sub-tab is the same fix Sebastian uses by hand. Other
    // handlers' ids have no known pairing, so they are not waited on.
    // Every handler is waited on now, not only Stripe / Google Play: an
    // order like 6f9ef99fa6a511f1895bae7967899e38.. (2026-09-30, Erick) got
    // one look and then "Refund row not shown in CMS yet". Each pass is the
    // same small refresh Sebastian does by hand - One-Time Purchases and back.
    // Pairing: the id rules first (markRefundedCharges); for a handler with no
    // known rule, a REFUND row that was NOT in the table when the panel
    // opened, with the same title and amount, is this refund's.
    async function attachRefundRows(done, step, timeoutMs = 45000) {
        const deadline = Date.now() + timeoutMs;
        // Shared for the whole run (and its recheck), so one new REFUND row
        // is never handed to two charges of the same amount.
        const claimed = runClaimedRefundKeys;
        let pass = 0;
        while (Date.now() < deadline) {
            pass += 1;
            stepLog(step, `Refreshing the CMS table - pass ${pass}`);
            const oneTime = findButtonByText('one-time purchases');
            if (oneTime) {
                realClick(oneTime);
                await sleep(700);
            }
            const table = await openSubscriptionCharges();
            const rows = markRefundedCharges(scrapeCharges(table));
            for (const charge of done) {
                if (charge.refundRow) continue;
                const row = rows.find(candidate => candidate.order === charge.order &&
                    candidate.type.toUpperCase() === 'CHARGE');
                let refund = row?.refundedRow && !claimed.has(refundRowKey(row.refundedRow)) ? row.refundedRow : null;
                if (!refund) {
                    refund = rows.find(candidate => candidate.type.toUpperCase() === 'REFUND' &&
                        !initialRefundKeys.has(refundRowKey(candidate)) &&
                        !claimed.has(refundRowKey(candidate)) &&
                        cleanText(candidate.amount) === cleanText(charge.amount) &&
                        (!candidate.title || !charge.title || candidate.title === charge.title)) || null;
                }
                if (refund) {
                    charge.refundRow = refund;
                    claimed.add(refundRowKey(refund));
                    stepLog(step, `REFUND ${refund.order} found for ${charge.date} ${charge.amount}`);
                }
            }
            if (done.every(charge => charge.refundRow)) return;
            await sleep(2500);
        }
    }

    // Per-step durations of the last run, kept in GM so they survive CMS
    // closing itself - measuring is how "is it faster?" gets answered.
    const LAST_RUN_KEY = 'bvRefundAssistLastRun';

    function saveRunTimings(run, clean) {
        try {
            GM_setValue(LAST_RUN_KEY, {
                at: Date.now(),
                totalMs: Date.now() - runStartedAt,
                refunds: run.done.length,
                api: Boolean(run.apiCtx),
                clean,
                steps: steps.map(step => ({
                    label: step.label,
                    state: step.state,
                    ms: (step.endedAt || Date.now()) - (step.startedAt || Date.now())
                }))
            });
        } catch (error) {
            // Timing is a nicety - never let it break a run.
        }
    }

    function readRunTimings() {
        try {
            const value = GM_getValue(LAST_RUN_KEY, null);
            return value && Array.isArray(value.steps) ? value : null;
        } catch (error) {
            return null;
        }
    }

    function seconds(ms) {
        return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
    }

    function refundRowKey(row) {
        return [row.type, row.order, row.date, row.amount].map(cleanText).join('|');
    }

    // The status is read from a freshly mounted card: right after CANCEL NOW
    // the old card still says DEFERRED_CANCELLATION (live, 2026-09-30).
    async function readFinalPlan(expectCancelled, preferName) {
        if (!await openSubscriptionPlans()) return null;
        let plan = null;
        await waitFor(() => {
            const cards = getPlanCards().map(readPlanCard);
            plan = cards.find(card => card.name === preferName) || cards[0] || null;
            return plan && (!expectCancelled || /^cancel/i.test(plan.status)) ? true : null;
        }, { timeout: 8000, pollMs: 400 });
        if (plan && expectCancelled && !/^cancel/i.test(plan.status)) {
            // Cancel Now went through, CMS just has not caught up. Say that
            // rather than printing the stale status as if it were the result.
            plan = Object.assign({}, plan, { status: `Cancel Now done (CMS still showed ${plan.status || 'no status'})` });
        }
        return plan;
    }

    // Brings the ticket tab to the front and closes this CMS tab. The ticket
    // tab answers on BV_FOCUS_TICKET_ACK_KEY when it has focused itself; with
    // no answer (tab not open) the ticket is opened fresh instead.
    async function handOffToTicket(ticketId) {
        const step = addStep('Back to the ticket');
        stepLog(step, `Calling the #${ticketId} tab to the front`);
        const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        try {
            GM_setValue(BV_FOCUS_TICKET_KEY, { ticketId: String(ticketId), nonce, at: Date.now() });
        } catch (error) {
            endStep(step, 'failed', 'could not signal the ticket tab');
            return;
        }
        const acked = await waitFor(() => {
            try {
                return GM_getValue(BV_FOCUS_TICKET_ACK_KEY, '') === nonce ? true : null;
            } catch (error) {
                return null;
            }
        }, { timeout: 3000, pollMs: 150 });
        if (!acked) {
            try {
                GM_openInTab(`https://viewlift.freshdesk.com/a/tickets/${ticketId}`, { active: true });
            } catch (error) {
                endStep(step, 'failed', 'ticket tab not open and could not open it - CMS left open');
                return;
            }
        }
        endStep(step, 'done', `${acked ? 'ticket tab focused' : 'ticket opened in a new tab'} - closing CMS`);
        await sleep(400);
        try {
            window.close();
        } catch (error) {
            endStep(step, 'failed', 'Tampermonkey did not allow closing this tab - close it by hand');
        }
    }

    /* ---------------- UI ---------------- */

    function el(tag, attrs = {}, children = []) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
            else if (value === true) node.setAttribute(key, '');
            else if (value !== false && value != null) node.setAttribute(key, value);
        }
        for (const child of [].concat(children)) {
            if (child == null || child === false) continue;
            node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        }
        return node;
    }

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = el('style', { id: STYLE_ID });
        style.textContent = `
/* Dark, on the Refund Capture panel's own CMS theme (.cms-theme: #0f1728
   card, #121c30 header, #111b2e fields, #34425a borders) so the two read as
   one set - but TEAL with a return-arrow icon where Refund Capture is
   PURPLE with "$", so they are never mistaken for each other (Sebastian,
   2026-09-30: "los dos en dark mode... debidamente diferenciados"). */
#${BUTTON_ID}{position:fixed;right:20px;bottom:20px;z-index:999999;width:52px;height:52px;padding:0;border:1px solid rgba(45,212,191,.6);border-radius:999px;background:linear-gradient(135deg,#0d9488,#0891b2);color:#fff;font:800 20px/1 Inter,ui-sans-serif,system-ui,"Segoe UI",sans-serif;cursor:pointer;box-shadow:0 12px 30px rgba(13,148,136,.4);transition:transform 180ms ease,box-shadow 180ms ease}
#${BUTTON_ID}:hover{transform:translateY(-2px) scale(1.03);box-shadow:0 16px 36px rgba(13,148,136,.5)}
#${BUTTON_ID}:active{transform:translateY(0) scale(.97);box-shadow:0 6px 16px rgba(13,148,136,.3),inset 0 2px 5px rgba(0,0,0,.2)}
#${PANEL_ID}{position:fixed;z-index:1000002;transform-origin:bottom right;display:flex;flex-direction:column;box-sizing:border-box;width:520px;height:560px;min-width:340px;min-height:240px;max-width:calc(100vw - 32px);max-height:calc(100vh - 88px);overflow:hidden;resize:both;background:#0f1728;color:#e7edf7;border:1px solid #27344a;border-radius:12px;box-shadow:0 22px 60px rgba(0,0,0,.48);font:12px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:dark}
#${PANEL_ID} header{flex:0 0 auto;min-height:44px;display:flex;align-items:center;gap:8px;padding:8px 10px;background:#121c30;border-bottom:1px solid #27344a;font-weight:700;color:#f0fdfa;box-sizing:border-box}
#${PANEL_ID} .bv-ra-icon{width:30px;height:30px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;background:linear-gradient(135deg,#0d9488,#0891b2);box-shadow:0 5px 14px rgba(13,148,136,.35);color:#fff;font-weight:800;font-size:16px}
#${PANEL_ID} header .bv-ra-x{margin-left:auto;width:28px;height:28px;border:1px solid #34425a;border-radius:7px;background:#172238;color:#cdd6e5;font-size:14px;line-height:1;cursor:pointer;transition:background 140ms ease,color 140ms ease}
#${PANEL_ID} header .bv-ra-x:hover{background:#202d45;color:#fff}
#${PANEL_ID} header .bv-ra-x:disabled{opacity:.5;cursor:not-allowed}
#${PANEL_ID} header .bv-ra-title{white-space:nowrap}
#${PANEL_ID} .bv-ra-badge.is-api{background:rgba(13,148,136,.22);color:#5eead4;border-color:rgba(45,212,191,.55)}
#${PANEL_ID} header .bv-ra-agent{margin-left:6px;max-width:140px;height:28px;padding:0 8px;border:1px solid #34425a;border-radius:7px;background:#111b2e;color:#f1f5f9;font:600 12px Inter,ui-sans-serif,system-ui,"Segoe UI",sans-serif;cursor:pointer;color-scheme:dark}
#${PANEL_ID} header .bv-ra-agent:focus{outline:none;border-color:#14b8a6;box-shadow:0 0 0 3px rgba(20,184,166,.18)}
#${PANEL_ID} header .bv-ra-agent:disabled{opacity:.6;cursor:not-allowed}
#${PANEL_ID} header .bv-ra-x.is-capture{color:#c4b5fd;border-color:rgba(139,92,246,.45)}
#${PANEL_ID} header .bv-ra-x.is-capture ~ .bv-ra-x{margin-left:6px}
#${PANEL_ID} .bv-ra-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px;background:#0f1728;scrollbar-width:thin;scrollbar-color:#34425a transparent}
#${PANEL_ID} .bv-ra-body::-webkit-scrollbar{width:8px}
#${PANEL_ID} .bv-ra-body::-webkit-scrollbar-thumb{background:#34425a;border-radius:999px}
#${PANEL_ID} .bv-ra-badge{padding:2px 8px;border-radius:999px;font-size:11px;background:rgba(120,53,15,.35);color:#fbbf24;border:1px solid rgba(245,158,11,.5)}
#${PANEL_ID} .bv-ra-warn{margin-bottom:10px;padding:8px 10px;border:1px solid rgba(245,158,11,.5);border-radius:7px;background:rgba(120,53,15,.25);color:#fcd34d;font-weight:600;line-height:1.4}
#${PANEL_ID} .bv-ra-muted{color:#94a3b8;font-size:12px}
#${PANEL_ID} label{color:#cbd5e1}
#${PANEL_ID} label.bv-ra-row{display:grid;grid-template-columns:18px 72px 1fr auto;gap:8px;align-items:center;margin:0 0 6px;padding:7px 9px;border:1px solid #34425a;border-radius:7px;background:#111b2e;color:#f1f5f9;cursor:pointer;transition:border-color 140ms ease,background 140ms ease}
#${PANEL_ID} label.bv-ra-row:hover{border-color:#14b8a6;background:#13213a}
#${PANEL_ID} label.bv-ra-row:has(input:checked){border-color:rgba(45,212,191,.6);background:rgba(13,148,136,.16)}
#${PANEL_ID} label.bv-ra-row.is-off{opacity:.45;cursor:default;background:#0f1728}
#${PANEL_ID} label.bv-ra-row.is-off:hover{border-color:#34425a}
#${PANEL_ID} input[type="checkbox"]{accent-color:#14b8a6;margin:0}
#${PANEL_ID} .bv-ra-order{font-family:Consolas,monospace;font-size:11px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#${PANEL_ID} strong{color:#f1f5f9}
#${PANEL_ID} .bv-ra-actions{flex:0 0 auto;display:flex;gap:10px;justify-content:flex-end;padding:10px 12px;border-top:1px solid #27344a;background:#121c30}
#${PANEL_ID} button.bv-ra-btn{box-sizing:border-box;min-width:96px;padding:8px 12px;border:1px solid #34425a;border-radius:7px;background:#172238;color:#dbe4f1;cursor:pointer;font:600 12px Inter,ui-sans-serif,system-ui,"Segoe UI",sans-serif;transition:background 140ms ease,box-shadow 140ms ease}
#${PANEL_ID} button.bv-ra-btn:hover{background:#202d45}
#${PANEL_ID} button.bv-ra-primary{background:linear-gradient(90deg,#0d9488,#0891b2);border-color:#14b8a6;color:#fff;font-weight:700;box-shadow:0 8px 20px rgba(13,148,136,.28)}
#${PANEL_ID} button.bv-ra-primary:hover{background:linear-gradient(90deg,#0f766e,#0e7490);box-shadow:0 10px 24px rgba(13,148,136,.38)}
#${PANEL_ID} button.bv-ra-btn:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
#${PANEL_ID} ol{margin:6px 0 0 18px;padding:0}
#${PANEL_ID} .bv-ra-step{margin-bottom:8px}
#${PANEL_ID} .bv-ra-state{font-weight:700;margin-right:4px}
#${PANEL_ID} .is-done .bv-ra-state{color:#86efac}
#${PANEL_ID} .is-dry-run .bv-ra-state{color:#fbbf24}
#${PANEL_ID} .is-failed .bv-ra-state{color:#f87171}
#${PANEL_ID} .is-running .bv-ra-state{color:#5eead4}
#${PANEL_ID} .bv-ra-hud{margin:0 0 12px;padding:12px;border:1px solid #27344a;border-radius:10px;background:linear-gradient(180deg,#121c30,#0f1728)}
#${PANEL_ID} .bv-ra-hud.is-won{border-color:rgba(134,239,172,.45)}
#${PANEL_ID} .bv-ra-hud.is-lost{border-color:rgba(248,113,113,.5)}
#${PANEL_ID} .bv-ra-hud-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
#${PANEL_ID} .bv-ra-level{font:800 12px/1 Consolas,monospace;letter-spacing:.12em;color:#5eead4}
#${PANEL_ID} .bv-ra-xp{font:700 11px/1 Consolas,monospace;color:#94a3b8}
#${PANEL_ID} .bv-ra-bar{height:12px;border-radius:999px;background:#0b1220;border:1px solid #27344a;overflow:hidden}
#${PANEL_ID} .bv-ra-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#0d9488,#22d3ee);transition:width 450ms ease;background-size:200% 100%}
#${PANEL_ID} .bv-ra-hud.is-live .bv-ra-fill{animation:bv-ra-shine 1.4s linear infinite;background-image:linear-gradient(90deg,#0d9488 0%,#22d3ee 50%,#0d9488 100%)}
#${PANEL_ID} .bv-ra-hud.is-won .bv-ra-fill{background:linear-gradient(90deg,#16a34a,#86efac)}
#${PANEL_ID} .bv-ra-hud.is-lost .bv-ra-fill{background:linear-gradient(90deg,#b91c1c,#f87171)}
#${PANEL_ID} .bv-ra-now{margin-top:9px;font-size:13px;font-weight:700;color:#f0fdfa;min-height:18px}
#${PANEL_ID} .bv-ra-quest{display:flex;flex-direction:column;gap:6px}
#${PANEL_ID} .bv-ra-quest-step{padding:8px 10px;border:1px solid #27344a;border-radius:8px;background:#111b2e}
#${PANEL_ID} .bv-ra-quest-step.is-running{border-color:rgba(45,212,191,.55);box-shadow:0 0 0 1px rgba(45,212,191,.15),0 0 18px rgba(13,148,136,.18)}
#${PANEL_ID} .bv-ra-quest-step.is-done{border-color:rgba(134,239,172,.3)}
#${PANEL_ID} .bv-ra-quest-step.is-failed{border-color:rgba(248,113,113,.55);background:rgba(127,29,29,.18)}
#${PANEL_ID} .bv-ra-quest-step.is-dry-run{border-color:rgba(251,191,36,.45)}
#${PANEL_ID} .bv-ra-quest-head{display:flex;align-items:center;gap:8px;font-weight:700;color:#f1f5f9}
#${PANEL_ID} .bv-ra-quest-icon{width:18px;text-align:center;flex:0 0 auto}
#${PANEL_ID} .bv-ra-quest-icon.is-spinning{display:inline-block;animation:bv-ra-spin 1.1s linear infinite}
#${PANEL_ID} .bv-ra-quest-num{font:700 10px/1 Consolas,monospace;color:#64748b}
#${PANEL_ID} .bv-ra-quest-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#${PANEL_ID} .bv-ra-quest-time{margin-left:auto;padding-left:8px;font:700 10px/1 Consolas,monospace;color:#64748b;white-space:nowrap}
#${PANEL_ID} .bv-ra-quest-log{margin:6px 0 0 26px;font:11px/1.5 Consolas,monospace;color:#94a3b8}
#${PANEL_ID} .bv-ra-quest-log div:last-child{color:#cbd5e1}
#${PANEL_ID} .bv-ra-quest-step.is-running .bv-ra-quest-log div:last-child{color:#5eead4}
#${PANEL_ID} .bv-ra-quest-detail{margin:5px 0 0 26px;color:#94a3b8;font-size:11.5px}
#${PANEL_ID} .bv-ra-quest-step.is-failed .bv-ra-quest-detail{color:#fca5a5}
#${PANEL_ID} .bv-ra-result{margin:12px 0 8px;padding:12px;border-radius:10px;border:1px solid rgba(134,239,172,.45);background:rgba(20,83,45,.25);text-align:center}
#${PANEL_ID} .bv-ra-result.is-lost{border-color:rgba(248,113,113,.5);background:rgba(127,29,29,.22)}
#${PANEL_ID} .bv-ra-result-title{font-size:15px;font-weight:800;color:#f0fdfa;margin-bottom:3px}
@keyframes bv-ra-spin{to{transform:rotate(360deg)}}
@keyframes bv-ra-shine{from{background-position:200% 0}to{background-position:0 0}}
#${PANEL_ID} pre{white-space:pre-wrap;background:#111b2e;color:#e2e8f0;border:1px solid #34425a;border-radius:7px;padding:9px;font:12px/1.4 Consolas,monospace;overflow:auto}
`;
        (document.head || document.documentElement).appendChild(style);
    }

    // CSS resize:both does the dragging (bottom-right corner); this only
    // remembers the size so the next open starts where it was left.
    function restorePanelSize(panel) {
        try {
            const size = GM_getValue(PANEL_SIZE_KEY, null);
            if (size && size.width > 0 && size.height > 0) {
                panel.style.width = `${Math.round(size.width)}px`;
                panel.style.height = `${Math.round(size.height)}px`;
            }
        } catch (error) {
            // No stored size - the CSS default applies.
        }
        if (typeof ResizeObserver !== 'function') return;
        let saveTimer = null;
        new ResizeObserver(() => {
            window.clearTimeout(saveTimer);
            saveTimer = window.setTimeout(() => {
                if (!panel.isConnected) return;
                try {
                    GM_setValue(PANEL_SIZE_KEY, { width: panel.offsetWidth, height: panel.offsetHeight });
                } catch (error) {
                    // Not remembering the size is harmless.
                }
            }, 400);
        }).observe(panel);
    }

    function closePanel() {
        if (running) return;
        document.getElementById(PANEL_ID)?.remove();
        view = 'select';
        // A choice made for one account must not still be ticked next time.
        selected = new Set();
        mountFloat();
    }

    async function openPanel() {
        addStyles();
        view = 'select';
        steps = [];
        render(true);
        const table = await openSubscriptionCharges();
        charges = markRefundedCharges(scrapeCharges(table));
        initialRefundKeys = new Set(charges
            .filter(charge => charge.type.toUpperCase() === 'REFUND')
            .map(refundRowKey));
        // Nothing preselected: every refund is an explicit choice.
        selected = new Set(Array.from(selected).filter(order => charges.some(c => c.order === order && isRefundable(c))));
        render();
    }

    function renderSelect(body, actions, loading) {
        const ticketURL = getTicketURL();
        if (!ticketURL) {
            body.appendChild(el('div', { class: 'bv-ra-warn', text: 'No Freshdesk ticket stored. Open the ticket in Freshdesk first (or set it in the $ panel) - it is the required comment for the cancel and every refund.' }));
        } else {
            body.appendChild(el('div', { class: 'bv-ra-muted', text: `Ticket #${getTicketNumber(ticketURL)} - used as the comment everywhere.` }));
        }

        const lastTimings = readRunTimings();
        if (lastTimings && lastTimings.steps.length) {
            const slowest = lastTimings.steps.slice().sort((a, b) => b.ms - a.ms)[0];
            body.appendChild(el('div', {
                class: 'bv-ra-muted',
                title: lastTimings.steps.map(step => `${seconds(step.ms)}  ${step.label}`).join('\n'),
                text: `Last run: ${seconds(lastTimings.totalMs)}${lastTimings.api ? ' (\u26a1 API)' : ''} \u00b7 ${lastTimings.refunds} refund${lastTimings.refunds === 1 ? '' : 's'} \u00b7 slowest: ${slowest.label} (${seconds(slowest.ms)})`
            }));
        }

        if (loading) {
            body.appendChild(el('p', { text: 'Loading charges...' }));
            return;
        }
        if (!charges.length) {
            body.appendChild(el('p', { text: 'No charges found on SUBSCRIPTION PLANS AND ENTITLEMENTS.' }));
        }

        const refundable = charges.filter(isRefundable);
        if (refundable.length) {
            const allOn = refundable.every(charge => selected.has(charge.order));
            body.appendChild(el('label', { class: 'bv-ra-muted', style: 'display:block;margin:8px 0 4px;cursor:pointer' }, [
                el('input', { type: 'checkbox', checked: allOn, onchange: event => {
                    refundable.forEach(charge => event.target.checked ? selected.add(charge.order) : selected.delete(charge.order));
                    render();
                } }),
                ' Select all charges on this page'
            ]));
        }

        for (const charge of charges) {
            const on = isRefundable(charge);
            body.appendChild(el('label', { class: `bv-ra-row${on ? '' : ' is-off'}`, title: on ? '' : (charge.refundedBy ? `Already refunded (${charge.refundedBy})` : `${charge.type} - not a refundable charge`) }, [
                el('input', { type: 'checkbox', disabled: !on, checked: selected.has(charge.order), onchange: event => {
                    if (event.target.checked) selected.add(charge.order);
                    else selected.delete(charge.order);
                    render();
                } }),
                el('span', { text: charge.date }),
                el('span', { class: 'bv-ra-order', text: `${charge.title} - ${charge.order}` }),
                el('strong', { text: charge.refundedBy ? `${charge.amount} refunded` : charge.amount })
            ]));
        }

        body.appendChild(el('p', { class: 'bv-ra-muted', text: 'Only the current page of the table is listed.' }));
        body.appendChild(el('label', { style: 'display:block;margin-top:6px;cursor:pointer' }, [
            el('input', { type: 'checkbox', checked: cancelFirst, onchange: event => { cancelFirst = event.target.checked; render(); } }),
            ' Cancel the subscription first (CANCEL NOW)'
        ]));

        const picked = charges.filter(charge => selected.has(charge.order) && isRefundable(charge));
        actions.appendChild(el('button', { class: 'bv-ra-btn', text: 'Refresh', onclick: openPanel }));
        actions.appendChild(el('button', {
            class: 'bv-ra-btn bv-ra-primary',
            disabled: !ticketURL || (!picked.length && !cancelFirst),
            text: 'Review',
            onclick: () => { view = 'confirm'; render(); }
        }));
    }

    function renderConfirm(body, actions) {
        const picked = charges.filter(charge => selected.has(charge.order) && isRefundable(charge));
        const ticketURL = getTicketURL();
        const dryRun = isDryRun();
        if (dryRun) body.appendChild(el('div', { class: 'bv-ra-warn', style: 'background:#fffaeb;color:#93370d', text: 'DRY RUN - dialogs are filled and closed, nothing is cancelled or refunded.' }));
        body.appendChild(el('p', { text: 'This will, in order:' }));
        const list = el('ol');
        if (cancelFirst) list.appendChild(el('li', { text: 'Cancel the subscription with CANCEL NOW (not after the billing period).' }));
        if (picked.length) {
            list.appendChild(el('li', {}, [
                `Refund 100% of ${picked.length} charge${picked.length === 1 ? '' : 's'} - total ${formatTotal(picked)}:`,
                el('ul', {}, picked.map(charge => el('li', { class: 'bv-ra-order', text: `${charge.date} ${charge.amount} ${charge.order}` })))
            ]));
        }
        list.appendChild(el('li', { text: `Copy the summary and paste it into a private note on ticket #${getTicketNumber(ticketURL)}.` }));
        if (picked.length) list.appendChild(el('li', { text: `Write the refund-log row with ${getRefunder() || 'the selected agent'} as the Refunder.` }));
        body.appendChild(list);
        body.appendChild(el('p', { class: 'bv-ra-muted', text: 'Stops at the first failure. If the cancel fails, no refund is issued.' }));

        actions.appendChild(el('button', { class: 'bv-ra-btn', text: 'Back', onclick: () => { view = 'select'; render(); } }));
        actions.appendChild(el('button', {
            class: 'bv-ra-btn bv-ra-primary',
            text: dryRun ? 'Run dry run' : 'Confirm - cancel & refund',
            onclick: runAssist
        }));
    }

    // The run as a little game (Sebastian, 2026-09-30: "un progreso un poco
    // más tipo un juego, que se vea como progresa"): a level counter and a
    // filling bar on top, the action happening right now in large type, and
    // every step with its own icon and its live log lines underneath.
    function renderRun(body, actions) {
        const finished = steps.filter(step => step.state !== 'running').length;
        const failedSteps = steps.filter(step => step.state === 'failed').length;
        const total = Math.max(plannedSteps, steps.length, 1);
        const percent = running ? Math.min(99, Math.round((finished / total) * 100)) : 100;
        const current = steps.slice().reverse().find(step => step.state === 'running');
        const nowText = running
            ? (current ? (current.log[current.log.length - 1] || current.label) : 'Warming up...')
            : (failedSteps ? 'Stopped - see the red step' : 'All done');
        const elapsedSeconds = Math.max(0, Math.round((Date.now() - runStartedAt) / 1000));

        body.appendChild(el('div', { class: `bv-ra-hud${running ? ' is-live' : (failedSteps ? ' is-lost' : ' is-won')}` }, [
            el('div', { class: 'bv-ra-hud-top' }, [
                el('span', { class: 'bv-ra-level', text: `LEVEL ${Math.min(finished + (running ? 1 : 0), total)} / ${total}` }),
                el('span', { class: 'bv-ra-xp', text: `${percent}%  \u00b7  ${elapsedSeconds}s` })
            ]),
            el('div', { class: 'bv-ra-bar' }, [el('div', { class: 'bv-ra-fill', style: `width:${percent}%` })]),
            el('div', { class: 'bv-ra-now', text: nowText })
        ]));

        const list = el('div', { class: 'bv-ra-quest' });
        steps.forEach((step, index) => {
            const icon = { running: '\u23f3', done: '\u2705', 'dry-run': '\ud83e\uddea', failed: '\u274c' }[step.state] || '\u2022';
            const lines = step.state === 'running' ? step.log.slice(-5) : step.log.slice(-2);
            list.appendChild(el('div', { class: `bv-ra-quest-step is-${step.state}` }, [
                el('div', { class: 'bv-ra-quest-head' }, [
                    el('span', { class: `bv-ra-quest-icon${step.state === 'running' ? ' is-spinning' : ''}`, text: icon }),
                    el('span', { class: 'bv-ra-quest-num', text: String(index + 1).padStart(2, '0') }),
                    el('span', { class: 'bv-ra-quest-label', text: step.label }),
                    step.endedAt ? el('span', { class: 'bv-ra-quest-time', text: seconds(step.endedAt - step.startedAt) }) : null
                ]),
                lines.length ? el('div', { class: 'bv-ra-quest-log' }, lines.map(line => el('div', { text: `\u203a ${line}` }))) : null,
                step.detail ? el('div', { class: 'bv-ra-quest-detail', text: step.detail }) : null
            ]));
        });
        body.appendChild(list);

        if (running) {
            body.appendChild(el('p', { class: 'bv-ra-muted', text: "Running - don't click around in CMS until the bar is full." }));
            return;
        }
        body.appendChild(el('div', { class: `bv-ra-result${failedSteps ? ' is-lost' : ''}` }, [
            el('div', { class: 'bv-ra-result-title', text: failedSteps ? '\u26a0\ufe0f Run stopped' : '\ud83c\udfc6 Run complete' }),
            el('div', { class: 'bv-ra-muted', text: failedSteps
                ? `${failedSteps} step${failedSteps === 1 ? '' : 's'} failed - the red one says why.`
                : `${steps.length} steps in ${elapsedSeconds}s.` })
        ]));
        if (lastNoteText) body.appendChild(el('pre', { text: lastNoteText }));
        // Offered whenever the run did not finish clean: it re-reads CMS
        // before refunding anything again, so it is safe to press.
        if (lastRun && !lastRun.dryRun && (failedSteps || lastRun.failed.length || lastRun.skipped.length)) {
            actions.appendChild(el('button', {
                class: 'bv-ra-btn bv-ra-primary',
                text: '↻ Recheck (2nd run)',
                title: 'Looks for the refunds in CMS again, refunds only what is really missing, then finishes the note, scenario and refund log',
                onclick: recheckRun
            }));
        }
        actions.appendChild(el('button', { class: 'bv-ra-btn', text: 'Copy again', disabled: !lastNoteText, onclick: () => copyText(lastNoteText) }));
        actions.appendChild(el('button', { class: 'bv-ra-btn', text: 'Close', onclick: closePanel }));
    }

    // The agent written into the refund log's Refunder column (Sebastian,
    // 2026-09-30: "que se pueda elegir el agente... como el de refund
    // capture"). The Refund Capture panel's own select stays the single
    // source: its options, its saved preference (Feature 1b), and the value
    // buildRefundRow() reads - this menu only reads and writes it.
    const FALLBACK_REFUNDERS = ['Sebastian', 'Erick', 'Esteban', 'Julio'];
    const REFUNDER_PREF_KEY = 'Better CMS Preferred Refunder';

    function getRefunderSource() {
        return document.getElementById('refund-refunder');
    }

    function buildRefunderSelect() {
        const source = getRefunderSource();
        const names = source
            ? Array.from(source.options).map(option => cleanText(option.value || option.textContent)).filter(Boolean)
            : FALLBACK_REFUNDERS;
        let current = source ? source.value : '';
        if (!current) {
            try {
                current = GM_getValue(REFUNDER_PREF_KEY, '') || names[0];
            } catch (error) {
                current = names[0];
            }
        }
        return el('select', {
            class: 'bv-ra-agent',
            title: 'Refunder - the agent written into the refund log',
            'aria-label': 'Refunder',
            disabled: running,
            onchange: event => setRefunder(event.target.value)
        }, names.map(name => el('option', { value: name, selected: name === current, text: name })));
    }

    function setRefunder(name) {
        const source = getRefunderSource();
        if (source) {
            source.value = name;
            source.dispatchEvent(new Event('input', { bubbles: true }));
            source.dispatchEvent(new Event('change', { bubbles: true }));
            return;
        }
        try {
            GM_setValue(REFUNDER_PREF_KEY, name);
        } catch (error) {
            // Not remembered this time - the select still shows the choice.
        }
    }

    function getRefunder() {
        return cleanText(getRefunderSource()?.value || '');
    }

    function render(loading = false) {
        let panel = document.getElementById(PANEL_ID);
        if (!panel) {
            panel = el('div', { id: PANEL_ID, 'data-html2canvas-ignore': 'true' });
            document.body.appendChild(panel);
            restorePanelSize(panel);
            anchorPanelBottomRight(panel);
            mountFloat();
        }
        panel.textContent = '';

        const header = el('header', {}, [
            el('span', { class: 'bv-ra-icon', text: '↩' }),
            el('span', { class: 'bv-ra-title', text: 'Refund Assist' }),
            buildRefunderSelect(),
            isDryRun() ? el('span', { class: 'bv-ra-badge', text: 'DRY RUN' }) : null,
            cmsApiContext() ? el('span', { class: 'bv-ra-badge is-api', title: 'Refunds and Cancel Now go straight through the CMS API', text: '\u26a1 API' }) : null,
            el('button', {
                class: 'bv-ra-x is-capture',
                title: 'Open the old Refund Capture panel',
                disabled: running,
                text: '$',
                onclick: () => {
                    if (!window.__bvRefundSheet?.showPanel?.()) console.warn('[BV Refund Assist] The Refund Capture panel is not on this page.');
                }
            }),
            el('button', { class: 'bv-ra-x', title: running ? 'Running...' : 'Minimize', disabled: running, text: '–', onclick: closePanel })
        ]);
        const body = el('div', { class: 'bv-ra-body' });
        const actions = el('div', { class: 'bv-ra-actions' });

        // A drawing bug must never abort a run that is cancelling/refunding
        // (3.78.0 died at its first redraw): show the error, keep going.
        try {
            if (view === 'confirm') renderConfirm(body, actions);
            else if (view === 'run') renderRun(body, actions);
            else renderSelect(body, actions, loading);
        } catch (error) {
            console.error('[BV Refund Assist] Panel render failed.', error);
            body.textContent = '';
            body.appendChild(el('p', { text: `Panel display error (${error.message}) - the run itself continues; see the console.` }));
        }

        panel.appendChild(header);
        panel.appendChild(body);
        if (actions.children.length) panel.appendChild(actions);
    }

    // The account id from /users/search/<id> - not only hex ids: Sign in
    // with Apple accounts look like apple-001618.<hex>.0003-vegas-golden-knights
    // (live, 2026-10-01), and a hex-only match hid the tool on all of them.
    function cmsAccountIdFromPath() {
        const match = location.pathname.match(/^\/users\/(?:search\/)?([A-Za-z0-9][A-Za-z0-9._-]{7,})\/?$/);
        if (!match) return '';
        const id = decodeURIComponent(match[1]);
        return /^(search|list|new|create)$/i.test(id) ? '' : id;
    }

    function isAccountPage() {
        return Boolean(cmsAccountIdFromPath());
    }

    // The round $ float in the bottom-right corner - the same spot and look
    // as the Refund Capture panel's own float, which CMS no longer shows
    // (Sebastian, 2026-09-30: "a la par del refund capture... la misma
    // apariencia"). Only on a customer account page; opening it takes CMS
    // to SUBSCRIPTION PLANS AND ENTITLEMENTS by itself.
    function mountFloat() {
        let float = document.getElementById(BUTTON_ID);
        const panelOpen = Boolean(document.getElementById(PANEL_ID));
        if (!isAccountPage() && !running) {
            float?.remove();
            if (panelOpen) closePanel();
            return;
        }
        if (!float) {
            addStyles();
            float = el('button', {
                id: BUTTON_ID,
                type: 'button',
                title: 'Refund Assist',
                'aria-label': 'Refund Assist',
                'data-html2canvas-ignore': 'true',
                // Return arrow, not "$": the $ float beside it is Refund Capture.
                text: '↩',
                onclick: event => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!running) openPanel();
                }
            });
            document.body.appendChild(float);
        }
        const hide = panelOpen ? 'none' : '';
        if (float.style.display !== hide) float.style.display = hide;
    }

    // Opened in the float's corner and growing up and to the left, like the
    // Refund Capture panel - but placed by left/top so the resize handle
    // (bottom-right) still pulls the way it looks like it should.
    function anchorPanelBottomRight(panel) {
        // The corner is this tool's alone now that the Refund Capture float
        // is retired (it opens from this panel's header instead).
        const left = Math.max(8, window.innerWidth - 20 - panel.offsetWidth);
        const top = Math.max(8, window.innerHeight - 20 - panel.offsetHeight);
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
    }

    onRouteChange(function () {
        window.clearTimeout(mountTimer);
        mountTimer = window.setTimeout(mountFloat, 250);
    });
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
    /*
     * Subscription details scraped alongside the screenshot.
     *
     * The PNG shows the panel, but a note you can only read as an image is a
     * note nobody can search, quote or copy a plan name out of. So the same
     * fields are also lifted as text and pasted under the CMS link.
     *
     * Label-driven rather than "read every row in the panel": the app renders
     * the panel as generic divs, so a structural sweep picks up buttons,
     * section headings and empty spacers as if they were fields. A known-label
     * list keeps the note to the fields support actually reads out.
     */
    const SUBSCRIPTION_DETAIL_LABELS = [
        "Plan Name",
        "Plan Id",
        "Plan ID",
        "Subscription Id",
        "Subscription ID",
        "Subscription Status",
        "Status",
        "Price",
        "Amount",
        "Currency",
        "Country",
        "Channel IDs",
        "Channel Ids",
        "Receipt ID",
        "Receipt Id",
        "Payment Unique ID",
        "Payment Unique Id",
        "Transaction ID",
        "Transaction Id",
        "Payment Handler",
        "Payment Method",
        "Registered On",
        "Start Date",
        "End Date",
        "Subscription Start Date",
        "Subscription End Date",
        "Next Billing Date",
        "Renewal Date",
        "Free Trial",
        "Coupon Code",
        "Promo Code",
        "Discount",
        "Cancellation Reason",
        "Cancelled On",
        "TVOD Redemption Code"
    ];

    // The plan's billing cycle is the one thing in the panel with no label
    // beside it - it renders as a bare heading above that plan's fields
    // ("Monthly"), so it is recognised by its own text and reported under a
    // label of our own. It doubles as the marker for where one plan ends and
    // the next begins.
    const SUBSCRIPTION_CYCLE_PATTERN = /^(?:daily|weekly|bi-?weekly|monthly|bi-?monthly|quarterly|semi-?annual(?:ly)?|annual(?:ly)?|yearly|lifetime|one[- ]time|free\s+trial)$/i;

    // An account can hold several plans, and every field of every plan is
    // wanted - so the cap is per panel, not per plan, and sits well above what
    // a single plan renders.
    const SUBSCRIPTION_DETAIL_MAX_FIELDS = 60;
    const SUBSCRIPTION_DETAIL_MAX_VALUE_LENGTH = 200;

    function isSubscriptionDetailLabel(text) {
        const normalized = cleanText(text).toLowerCase().replace(/:$/, "");
        if (!normalized) return "";

        const match = SUBSCRIPTION_DETAIL_LABELS.find(
            label => label.toLowerCase() === normalized
        );

        return match || "";
    }

    // The panel sits inside the same page as the account header, the refund
    // panel and the site nav - all of which contain words like "Status". So
    // the scan is scoped to the smallest ancestor of the "Subscription Plans"
    // heading that actually holds more than one known field.
    function findSubscriptionPanel() {
        const heading = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, p, span, div, button, [role='tab']"))
            .find(element =>
                !element.closest(`#${WRAPPER_ID}, #refund-capture-panel`) &&
                cleanText(element.textContent) === "Subscription Plans"
            );

        if (!heading) return null;

        let node = heading.parentElement;

        for (let depth = 0; node && depth < 8; depth += 1) {
            const found = new Set();

            node.querySelectorAll("p, span, div, label, td, th, strong, b, h4, h5, h6").forEach(element => {
                const label = isSubscriptionDetailLabel(element.textContent);
                if (label) found.add(label);
            });

            if (found.size >= 2) return node;

            node = node.parentElement;
        }

        return null;
    }

    // An editable field's value is what is typed into it. The placeholder
    // ("Enter TVOD Redemption Code") and whatever picker sits beside it are
    // chrome, not the field's value, so a node holding a field reads as that
    // field alone - blank included.
    function readFieldOrText(node) {
        if (!node) return null;

        const field = node.matches("input, textarea")
            ? node
            : node.querySelector("input, textarea");

        if (field) return cleanText(field.value);

        return cleanText(node.textContent) || null;
    }

    // Same shape as findPaymentHandlerValue: the value sits next to the label,
    // never inside it. The panel renders both as a flat run of nodes and as
    // label/value rows, so both are tried - siblings first, because in the flat
    // run the label's parent holds every other field too, and reading the whole
    // parent there would glue the entire panel into one value.
    function readLabeledValue(labelElement) {
        const label = cleanText(labelElement.textContent);

        // Only the date fields spill over into a second node (Registered On
        // renders the day and the time separately). Everything else stops at
        // one, so an unrecognised neighbouring label can't be swallowed into
        // the value above it.
        const maxParts = /date|registered|renewal/i.test(label) ? 2 : 1;
        const parts = [];

        let sibling = labelElement.nextElementSibling;
        let sawField = false;

        while (sibling && parts.length < maxParts) {
            // The next field's label ends this field's value.
            if (isSubscriptionDetailLabel(sibling.textContent)) break;

            const holdsField = sibling.matches("input, textarea") ||
                Boolean(sibling.querySelector("input, textarea"));

            const text = readFieldOrText(sibling);
            if (text) parts.push(text);

            // An empty editable field is still the answer for this label: the
            // field has no value, so nothing further along is one either.
            if (holdsField) {
                sawField = true;
                break;
            }

            sibling = sibling.nextElementSibling;
        }

        if (parts.length) return cleanText(parts.join(" "));
        if (sawField) return "";

        // Row layout: the label and the value are wrapped together instead of
        // being siblings. Only trusted when the wrapper really is one field's
        // row - in the flat layout the label's parent holds the whole panel,
        // and reading it there hands back the section heading as the value.
        const row = labelElement.parentElement;
        if (!row) return "";

        const siblingsInRow = Array.from(row.children)
            .filter(child => child !== labelElement && !child.contains(labelElement));

        const isFlatRun = siblingsInRow.length > 3 ||
            siblingsInRow.some(child => isSubscriptionDetailLabel(child.textContent));

        if (isFlatRun) return "";

        for (const child of siblingsInRow) {
            const text = readFieldOrText(child);
            if (text) return text;
        }

        return "";
    }

    // A bare "Monthly" / "Annual" heading is the start of a plan. It is only
    // that heading when nothing labelled it: the same word sitting next to a
    // known label is that label's value, and is read there instead.
    function readSubscriptionCycleHeading(element) {
        if (element.children && element.children.length) return "";

        const text = cleanText(element.textContent);
        if (!SUBSCRIPTION_CYCLE_PATTERN.test(text)) return "";

        const previous = element.previousElementSibling;
        if (previous && isSubscriptionDetailLabel(previous.textContent)) return "";

        return text;
    }

    function collectSubscriptionDetails() {
        const scope = findSubscriptionPanel();
        if (!scope) return [];

        const candidates = Array.from(
            scope.querySelectorAll("p, span, div, label, td, th, strong, b, h4, h5, h6")
        ).filter(element =>
            !element.closest(`#${WRAPPER_ID}, #${BUTTON_ID}, #${BADGE_ID}, #refund-capture-panel`)
        );

        const details = [];

        // An account can hold more than one plan, and the panel lists them one
        // after another under the same labels each time. A label that has
        // already been read therefore means "this is the next plan", not "skip
        // it" - so repeats open a new group instead of being dropped, and the
        // note can keep the plans apart.
        let group = 0;
        let seen = new Set();

        const startNextPlan = () => {
            group += 1;
            seen = new Set();
        };

        for (const element of candidates) {
            const label = isSubscriptionDetailLabel(element.textContent);

            // "Free Trial" is both a field of its own and a billing cycle. A
            // node the panel labelled is read as that label, always - the
            // cycle heuristic only gets the nodes nothing labelled.
            if (!label) {
                const cycle = readSubscriptionCycleHeading(element);
                if (!cycle) continue;

                if (seen.size) startNextPlan();
                seen.add("Billing Cycle");
                details.push({ label: "Billing Cycle", value: cycle, group });
                if (details.length >= SUBSCRIPTION_DETAIL_MAX_FIELDS) break;
                continue;
            }

            // Wrappers whose only text is the label repeat the same field once
            // per nesting level - keep the innermost node, which is the one
            // sitting next to the value.
            if (Array.from(element.children).some(
                child => isSubscriptionDetailLabel(child.textContent)
            )) continue;

            let value = readLabeledValue(element);

            // Empty fields render their own placeholder ("Enter TVOD
            // Redemption Code") - that is not a value, it is the absence of one.
            if (!value || /^enter/i.test(value)) continue;

            if (value.length > SUBSCRIPTION_DETAIL_MAX_VALUE_LENGTH) {
                value = `${value.slice(0, SUBSCRIPTION_DETAIL_MAX_VALUE_LENGTH)}...`;
            }

            if (seen.has(label)) startNextPlan();

            seen.add(label);
            details.push({ label, value, group });

            if (details.length >= SUBSCRIPTION_DETAIL_MAX_FIELDS) break;
        }

        return details;
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
            await delay(50);

            if (typeof window.html2canvas !== "function") {
                throw new Error("DOM capture library is unavailable. Reload the CMS tab and try again.");
            }

            const canvas = await window.html2canvas(document.documentElement, {
                backgroundColor: "#ffffff",
                useCORS: true,
                allowTaint: false,
                // Deliberately 1, not devicePixelRatio: on a retina screen
                // that meant rendering 4x the pixels and then pushing a
                // correspondingly huge data URL through GM storage to the
                // Freshdesk tab - the single biggest cost in this whole
                // path. A support note doesn't need retina detail.
                scale: 1,
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
            const subscriptionDetails = collectSubscriptionDetails();

            // With the agent's API key the note is saved straight from here
            // (Sebastian, 2026-09-30: "que la función de copy page snapshot
            // pegue la nota con el API"); the Freshdesk-tab paste below is
            // only the fallback, so a saved note is never pasted a second time.
            const savedViaApi = await postSnapshotNote(ticketUrl, blob, subscriptionDetails);

            if (!savedViaApi) try {
                // A small queue, not a single value: requesting two snapshots
                // (for the same ticket or different ones) within the consumer's
                // poll window used to silently overwrite the first one.
                const existing = GM_getValue(PENDING_SNAPSHOT_KEY, null);
                const queue = Array.isArray(existing) ? existing : (existing ? [existing] : []);

                queue.push({
                    dataUrl: snapshotDataUrl,
                    ticketUrl,
                    // The CMS page the shot was taken on. A screenshot alone
                    // doesn't say which account it belongs to, so the Freshdesk
                    // side pastes this as a clickable link under the image.
                    sourceUrl: location.href,
                    // The same subscription fields the shot shows, as text, so
                    // the note stays searchable and quotable instead of being
                    // an image nobody can copy a plan name out of.
                    subscriptionDetails,
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

    function escapeNoteHtml(value) {
        return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    // The same content the Freshdesk tab pastes (Feature 9): the CMS link,
    // then "Subscription details" with a blank line between plans - built
    // here as HTML for the API, with the screenshot as the note's attachment.
    function buildSnapshotNoteHtml(sourceUrl, details) {
        const parts = [`<div>CMS: <a href="${escapeNoteHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeNoteHtml(sourceUrl)}</a></div>`];
        const rows = (Array.isArray(details) ? details : [])
            .slice(0, SUBSCRIPTION_DETAIL_MAX_FIELDS)
            .map(detail => ({
                label: cleanText(detail && detail.label).slice(0, 60),
                value: cleanText(detail && detail.value).slice(0, SUBSCRIPTION_DETAIL_MAX_VALUE_LENGTH),
                group: Number(detail && detail.group) || 0
            }))
            .filter(row => row.label && row.value);
        if (rows.length) {
            let group = rows[0].group;
            const lines = ['<strong>Subscription details</strong>'];
            for (const row of rows) {
                if (row.group !== group) {
                    lines.push('');
                    group = row.group;
                }
                lines.push(`${escapeNoteHtml(row.label)}: ${escapeNoteHtml(row.value)}`);
            }
            parts.push(`<div>${lines.join('<br>')}</div>`);
        }
        return parts.join('<br>');
    }

    // true = the note is saved on the ticket. false = no key, no ticket, or
    // the API refused - the caller falls back to the paste queue.
    function postSnapshotNote(ticketUrl, blob, details) {
        const ticketId = (String(ticketUrl || '').match(/\/tickets\/(\d+)/i) || [])[1];
        if (!ticketId || !getFreshdeskApiKey()) return Promise.resolve(false);

        return new Promise(resolve => {
            try {
                const formData = new FormData();
                formData.append('body', buildSnapshotNoteHtml(location.href, details));
                formData.append('private', 'true');
                formData.append('attachments[]', new File([blob], 'cms-snapshot.png', { type: 'image/png' }));
                freshdeskApiMultipart({
                    path: `/api/v2/tickets/${ticketId}/notes`,
                    formData,
                    onDone: function (error) {
                        if (error) {
                            console.warn('[CMS Snapshot] API note failed, pasting it in the ticket tab instead.',
                                error.message, error.responseBody || '');
                            resolve(false);
                            return;
                        }
                        resolve(true);
                    }
                });
            } catch (error) {
                console.warn('[CMS Snapshot] Could not build the API note.', error);
                resolve(false);
            }
        });
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

// Host only, not the path: Freshdesk is a single-page app, so a session that
// starts on a list or the dashboard reaches its tickets without a page load,
// and a load-time path check left these features off for the whole session.
if (location.hostname === 'viewlift.freshdesk.com') {
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
    // The Spanish pair is FOX's template ("Gracias por contactar con el Equipo
    // de Soporte Técnico" ... "Saludos cordiales, / Equipo de Soporte Técnico"),
    // asked for in bold the same as the English one (2026-09-30).
    return /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})|(The Technical Support Team)|(Technical Support Team)|(Regards,)|(Equipo de Soporte T[ée]cnico)|(Saludos cordiales,)/g;
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
              lowerText.includes("regards,") ||
              /equipo de soporte t[ée]cnico|saludos cordiales,/.test(lowerText)
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

  // Refund Assist (Feature 9b) sends the scenario reply itself, with no
  // keystroke in between to set this off - so it asks for the pass directly
  // before it syncs Froala and sends (2026-09-30: a reply went out with no
  // bold at all).
  window.__bvAutoBoldEditor = function (editor) {
    normalizeEditorFormatting(editor);
    processEditor(editor);
  };

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
  // No load-time path check (2026-09-30): opened from a ticket LIST, the
  // page never reloads on the way into a ticket, so a check here meant no
  // toolbar - no chip, no CMS button, no $ - for the rest of the session.
  // installToolbar() checks the path on every pass instead.
  const isTicketDetailPath = () => /^\/a\/tickets\/\d+(?:\/|$)/i.test(location.pathname);

  const TOOLBAR_ID = 'better-freshdesk-unified-toolbar';
  const BRAND_ID = 'better-freshdesk-case-brand';
  const EMAIL_ID = 'better-freshdesk-action-email';
  const REFUND_TOGGLE_ID = 'better-freshdesk-refund-toggle';
  const CMS_SESSION_DOT_ID = 'better-freshdesk-cms-session-dot';
  const STYLE_ID = 'better-freshdesk-unified-toolbar-style';

  // Client names as Freshdesk actually stores them in cf_b2b_client_name,
  // read off the API on 2026-08-22: "TBL B2C", "SCHN+ B2C", "Altitude B2C",
  // "LivGolf B2C", "DIRTVision B2C", "MSN B2C (Monumental Sports Network)".
  // Tampa is "TBL" everywhere - the words "tampa" and "lightning" only turn
  // up in some subjects - which is why matching on them alone left every TBL
  // ticket reading "CASE".
  const BRAND_RULES = [
    { label: 'TBL', patterns: [/\btbl\b/i, /tampa\s*bay/i, /tampabaylightning/i, /\blightning\b/i] },
    { label: 'LIV', patterns: [/liv\s*golf/i, /livgolf/i, /livgolfplus\.com/i] },
    { label: 'DIRT', patterns: [/dirtvision/i, /dirt\s*vision/i, /dirtvision\.com/i] },
    { label: 'ALTITUDE', patterns: [/altitude/i, /altitudeplus/i] },
    { label: 'MSN', patterns: [/monumental\s*sports/i, /msn\b/i, /monumentalsportsnetwork/i] },
    { label: 'SCHN', patterns: [/\bschn\b/i, /space\s*city/i, /spacecityhn/i, /sc-appsupport/i] },
    // Freshdesk stores this brand as "FOX One B2C" and its mail arrives on
    // fox.com - neither contains "fox sports", which is why FOX tickets read
    // "CASE". Kept last in the list so the bare /\bfox\b/ fallback can only
    // win once every more specific brand has already failed to match.
    { label: 'FOX', patterns: [/\bfox\s*one\b/i, /\bfoxone\b/i, /fox\s*sports/i, /foxsports/i, /foxsports\.com/i, /\bfox\.com\b/i, /\bfox\b/i] }
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
        border: 1px solid #1a7f5a !important;
        border-radius: 4px !important;
        background: #1a7f5a !important;
        color: #ffffff !important;
        font-size: 14px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        box-shadow: none !important;
        transition: background 120ms ease, border-color 120ms ease !important;
      }

      #${REFUND_TOGGLE_ID}:hover {
        background: #15684a !important;
        border-color: #15684a !important;
      }

      #${REFUND_TOGGLE_ID}:active {
        background: #11543b !important;
        border-color: #11543b !important;
      }

      #${BRAND_ID} {
        display: inline-flex !important;
        align-items: center !important;
        height: 32px !important;
        box-sizing: border-box !important;
        white-space: nowrap !important;
        padding: 0 10px !important;
        border: 1px solid transparent !important;
        border-radius: 4px !important;
        font: 700 12px/1.2 Arial, sans-serif !important;
        letter-spacing: .03em !important;
        box-shadow: none !important;
      }

      /* One flat tinted chip per brand - enough colour to tell them apart
         instantly, without the glow/gradient treatment. */
      #${BRAND_ID}[data-brand="LIV"]      { color: #14683f !important; background: #e6f4ec !important; border-color: #bcdfcb !important; }
      #${BRAND_ID}[data-brand="DIRT"]     { color: #8a5200 !important; background: #fdf3e3 !important; border-color: #eed7ab !important; }
      #${BRAND_ID}[data-brand="ALTITUDE"] { color: #1b4a9c !important; background: #e8f0fc !important; border-color: #bed4f2 !important; }
      #${BRAND_ID}[data-brand="MSN"]      { color: #5b2a86 !important; background: #f2eafa !important; border-color: #d9c6ed !important; }
      #${BRAND_ID}[data-brand="SCHN"]     { color: #96233f !important; background: #fdeaee !important; border-color: #f2c2ce !important; }
      #${BRAND_ID}[data-brand="FOX"]      { color: #93400f !important; background: #fdefe4 !important; border-color: #f0cdb2 !important; }
      #${BRAND_ID}[data-brand="CASE"]     { color: #5a6c7d !important; background: #f0f2f5 !important; border-color: #d5dbe1 !important; }

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
    // Both of these are the real, correctly-laid-out containers.
    //
    // There used to be a third candidate here - the native Reply button's
    // parent - which is now permanently dead: Feature 6 removes that button
    // itself, so it is never present to be found. Worse than useless, it
    // made the bare-section fallback below look like a rare edge case when
    // it had actually become the normal outcome of a slow load.
    return document.querySelector('section#mainactionbar .reply-bar-top') ||
      document.querySelector('section#mainactionbar .page-actions__left') ||
      null;
  }

  // The bare section is a genuinely worse container - a different flex
  // layout - so a toolbar placed there looks misaligned and then visibly
  // jumps once the real container appears. That is only ever an acceptable
  // outcome if Freshdesk has renamed its classes and the real containers are
  // never coming; it is NOT an acceptable outcome for a page that is merely
  // loading slowly. Hence a long grace period: waiting a few extra seconds
  // for correct placement beats rendering wrong and then moving.
  const ACTION_BAR_GRACE_MS = 15000;
  let warnedAboutFallbackBar = false;

  function getActionBarWithFallback() {
    const actionBar = getActionBar();
    if (actionBar) {
      actionBarFallbackSince = 0;
      return actionBar;
    }

    if (!actionBarFallbackSince) actionBarFallbackSince = Date.now();
    if (Date.now() - actionBarFallbackSince < ACTION_BAR_GRACE_MS) return null;

    const bareSection = document.querySelector('section#mainactionbar');

    // Loud once, because reaching this means the selectors above have gone
    // stale and the toolbar is now rendering in the degraded position.
    if (bareSection && !warnedAboutFallbackBar) {
      warnedAboutFallbackBar = true;
      console.warn(
        '[Better ViewLift] Neither .reply-bar-top nor .page-actions__left appeared within ' +
        (ACTION_BAR_GRACE_MS / 1000) + 's - falling back to the bare action bar, so the toolbar ' +
        'will look misaligned. Freshdesk may have renamed these containers.'
      );
    }

    return bareSection;
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
    // The ticket record wins (see BV_TICKET_BRANDS); page text is only the
    // fallback while that lookup is in flight or when it fails.
    const resolved = bvGetTicketBrand();
    if (resolved) return BRAND_RULES.find(rule => rule.label === resolved.label) || { label: resolved.label, patterns: [] };
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

  // Undo of the old inline mount: back to <body> as the corner float, with
  // the inline class (and its display:none while "closed") gone.
  function unmountRefundPanel() {
    const panel = document.getElementById('refund-capture-panel');
    if (!panel || !panel.classList.contains('better-freshdesk-inline-panel')) return;
    panel.classList.remove('better-freshdesk-inline-panel');
    delete panel.dataset.betterOpen;
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
  }

  // querySelector finds the Reply button at ANY depth, but insertBefore()
  // demands a DIRECT child of the container - and Freshdesk nested that
  // button inside .reply-bar-wrapper-top. The result was an uncaught
  // NotFoundError on every single install pass, so the toolbar was never
  // created and the client chip inside it never appeared. Insert next to the
  // button in ITS OWN parent, which is also where it visually belongs.
  function insertToolbarBefore(actionBar, toolbar) {
    const reply = actionBar.querySelector('button[data-test-email-action="reply"]');

    if (reply && reply.parentElement && actionBar.contains(reply)) {
      reply.parentElement.insertBefore(toolbar, reply);
      return;
    }

    actionBar.insertBefore(toolbar, actionBar.firstElementChild || null);
  }

  function installToolbar() {
    if (!isTicketDetailPath()) return;
    addStyles();
    const actionBar = getActionBarWithFallback();
    if (!actionBar) return;

    let toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = TOOLBAR_ID;
      insertToolbarBefore(actionBar, toolbar);
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

    // The refund panel is the round $ float in the corner again, beside 📋
    // and 🧠 (Sebastian, 2026-09-30: "aparece, pero desaparece al segundo" -
    // that second was this toolbar pulling it in as a hidden inline panel).
    // So no $ toggle here, and a panel an older pass pulled in goes back out.
    document.getElementById(REFUND_TOGGLE_ID)?.remove();
    unmountRefundPanel();

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
    if (document.getElementById(TOOLBAR_ID)?.querySelector('#better-freshdesk-copy-case')) {
      document.getElementById('better-freshdesk-copy-case').remove();
    }

    const orderedControls = [brand, cms, cmsSessionDot, agent].filter(Boolean);
    const currentControls = Array.from(toolbar.children).filter(element => orderedControls.includes(element));
    const orderIsCorrect = orderedControls.length === currentControls.length &&
      orderedControls.every((element, index) => currentControls[index] === element);

    if (!orderIsCorrect) {
      orderedControls.forEach(element => toolbar.appendChild(element));
    }
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
      // No visibility check here any more. It used to skip the whole pass
      // while the tab was hidden, which meant a ticket opened in a
      // background tab NEVER got a toolbar: the one pass at init() runs
      // before Freshdesk has drawn the action bar, and every retry after
      // it was skipped. The client chip lives in this toolbar, so the
      // visible symptom was "no me pone el tag de cada cliente".
      // installToolbar() is idempotent and cheap, so just let it run.
      const toolbar = document.getElementById(TOOLBAR_ID);
      // Re-verify the toolbar is still inside the CURRENT action bar, not just
      // "somewhere in the document" - Ember can replace the whole action bar
      // subtree, which would leave a stale toolbar node connected but orphaned
      // from the bar the user actually sees.
      //
      // contains(), not a strict parent match: the toolbar is inserted beside
      // the Reply button, which lives one level down inside the bar, so
      // requiring it to be a direct child would report "misplaced" forever.
      const bar = getActionBar();
      if (
        toolbar &&
        bar &&
        bar.contains(toolbar) &&
        document.getElementById(BRAND_ID)
      ) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(installToolbar, 80);
    };

    onRouteChange(scheduleInstall);
    window.addEventListener('focus', () => window.setTimeout(installToolbar, 100));

    // focus alone was not enough: switching to a tab that was loaded in the
    // background is a visibilitychange, and that is exactly the case that
    // used to come up empty.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') window.setTimeout(installToolbar, 100);
    });
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

  // Path read on every pass, not at load - see Feature 8 (2026-09-30).

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

  // Whatever sits in GM storage is treated as untrusted input here - it ends
  // up as an href in the agent's note - so only http(s) URLs on a real CMS
  // host are accepted. Older queued entries have no sourceUrl at all and just
  // paste the image as before.
  function toSafeCmsUrl(value) {
    const raw = cleanText(value);
    if (!raw) return '';

    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
      if (!isCMSHost(url.hostname)) return '';
      return url.href;
    } catch (error) {
      return '';
    }
  }

  function appendSourceLink(editor, sourceUrl) {
    const safeUrl = toSafeCmsUrl(sourceUrl);
    if (!safeUrl) return false;

    // Built as DOM nodes and appended, never by rewriting innerHTML: Froala
    // swaps its own placeholder <img> for the uploaded one asynchronously, and
    // re-serialising the editor mid-upload would drop the image just pasted.
    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createTextNode('CMS: '));

    const anchor = document.createElement('a');
    anchor.href = safeUrl;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = safeUrl;
    paragraph.appendChild(anchor);

    editor.appendChild(paragraph);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // Matches the scraper's per-panel cap: every field of every plan on the
  // account is meant to reach the note, not just the first plan's.
  const SUBSCRIPTION_NOTE_MAX_ROWS = 60;

  // Same trust rule as the source link: this came out of GM storage and is
  // about to land in an agent's note, so it goes in as text nodes only, with
  // hard caps on how much of it can get there.
  function appendSubscriptionDetails(editor, details) {
    if (!Array.isArray(details) || !details.length) return false;

    const rows = details
      .slice(0, SUBSCRIPTION_NOTE_MAX_ROWS)
      .map(detail => ({
        label: cleanText(detail && detail.label).slice(0, 60),
        value: cleanText(detail && detail.value).slice(0, 200),
        group: Number(detail && detail.group) || 0
      }))
      .filter(row => row.label && row.value);

    if (!rows.length) return false;

    const paragraph = document.createElement('p');
    const heading = document.createElement('strong');
    heading.textContent = 'Subscription details';
    paragraph.appendChild(heading);

    // One blank line between plans, so an account with two subscriptions
    // does not read as one plan with two of everything.
    let group = rows[0].group;

    for (const row of rows) {
      if (row.group !== group) {
        paragraph.appendChild(document.createElement('br'));
        group = row.group;
      }

      paragraph.appendChild(document.createElement('br'));
      paragraph.appendChild(document.createTextNode(`${row.label}: ${row.value}`));
    }

    editor.appendChild(paragraph);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
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

    // Appended last, so it lands under the image on both paste paths, with
    // the scraped fields directly under the link.
    appendSourceLink(editor, snapshot && snapshot.sourceUrl);
    appendSubscriptionDetails(editor, snapshot && snapshot.subscriptionDetails);

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

    // React the instant the CMS tab queues a snapshot instead of waiting for
    // the next poll tick - that poll was up to ~0.9s of dead time on every
    // single capture, which is most of the "it takes a moment to show up"
    // feel. The interval stays purely as a safety net (and much slower now)
    // for the case where the change event doesn't arrive.
    try {
      if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(SNAPSHOT_KEY, function (_name, _oldValue, _newValue, remote) {
          if (!remote) return;
          consumeSnapshotIfReady();
        });
      }
    } catch (error) {
      console.warn('[Freshdesk Snapshot] Could not subscribe to snapshot updates.', error);
    }

    window.setInterval(consumeSnapshotIfReady, 2500);
  }

  init();
})();
}

/* ============================================================
 * Feature 9b: Paste the Refund Assist summary into a private note
 * Consumer half of CMS Refund Assist (Feature 3b): when the ticket the
 * summary belongs to is open, opens a private note and writes the
 * cancellation confirmation plus the refund list into it. The note is left
 * unsent for the agent to review. Checks the path on every pass instead of
 * at load, because Freshdesk moves between tickets without a page load.
 * ============================================================ */

(function () {
  'use strict';

  if (location.hostname !== 'viewlift.freshdesk.com') return;

  const MAX_LINES = 80;
  let pasting = false;

  function cleanText(value) {
    return String(value || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  }

  function getTicketId() {
    const match = location.pathname.match(/^\/a\/tickets\/(\d+)/i);
    return match ? match[1] : '';
  }

  function getEntryTicketId(entry) {
    const match = String(entry && entry.ticketUrl || '').match(/\/tickets\/(\d+)/i);
    return match ? match[1] : '';
  }

  function readQueue() {
    try {
      const value = GM_getValue(BV_REFUND_ASSIST_NOTE_KEY, []);
      return Array.isArray(value) ? value : [];
    } catch (error) {
      return [];
    }
  }

  function removeEntry(entry) {
    const queue = readQueue().filter(item =>
      !(item && item.createdAt === entry.createdAt && item.ticketUrl === entry.ticketUrl));
    try {
      if (queue.length) GM_setValue(BV_REFUND_ASSIST_NOTE_KEY, queue);
      else GM_deleteValue(BV_REFUND_ASSIST_NOTE_KEY);
    } catch (error) {
      console.warn('[BV Refund Assist] Could not clear the queued note.', error);
    }
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

  // Came out of GM storage, so it goes in as text nodes only, capped - the
  // same trust rule as the snapshot note's subscription details.
  function buildParagraph(lines) {
    const paragraph = document.createElement('p');
    (Array.isArray(lines) ? lines : []).slice(0, MAX_LINES).forEach(line => {
      const text = cleanText(line && line.text).slice(0, 300);
      if (!text) return;
      if (paragraph.childNodes.length) paragraph.appendChild(document.createElement('br'));
      if (line.bold) {
        const strong = document.createElement('strong');
        strong.textContent = text;
        paragraph.appendChild(strong);
      } else {
        paragraph.appendChild(document.createTextNode(text));
      }
    });
    return paragraph.childNodes.length ? paragraph : null;
  }

  function buildTable(rows) {
    const list = (Array.isArray(rows) ? rows : []).slice(0, MAX_LINES).filter(Array.isArray);
    if (!list.length) return null;
    const table = document.createElement('table');
    const body = document.createElement('tbody');
    for (const cells of list) {
      const tr = document.createElement('tr');
      cells.slice(0, 10).forEach(cell => {
        const td = document.createElement('td');
        // Same spacing as the API note's table: without it the cells run
        // together ("4/22/2026Monthly PlanCHARGE...", seen live 2026-10-01).
        td.style.padding = '6px 18px 6px 0';
        td.style.verticalAlign = 'top';
        td.textContent = cleanText(cell).slice(0, 120) + '   ';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    }
    table.appendChild(body);
    return table;
  }

  // Same layout as the API note: lines, the CMS table rows, then problems.
  function writeNote(editor, entry) {
    const blocks = [buildParagraph(entry.lines), buildTable(entry.rows), buildParagraph(entry.after)].filter(Boolean);
    if (!blocks.length) return false;
    blocks.forEach(block => editor.appendChild(block));
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function isShown(element) {
    return Boolean(element && element.getBoundingClientRect().width > 0);
  }

  // The console is invisible from the page, so the outcome is shown here.
  function showStatus(message, isError) {
    let status = document.getElementById('bv-refund-assist-fd-status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'bv-refund-assist-fd-status';
      status.style.cssText = 'position:fixed;right:18px;bottom:64px;z-index:1000001;max-width:360px;padding:9px 12px;border-radius:7px;color:#fff;font:600 12px/1.4 Arial,sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.22);';
      document.body.appendChild(status);
    }
    status.textContent = message;
    status.style.background = isError ? '#991b1b' : '#17324d';
    window.clearTimeout(showStatus.timer);
    showStatus.timer = window.setTimeout(() => status.remove(), isError ? 12000 : 6000);
  }

  function fireClick(element) {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const EventType = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
      element.dispatchEvent(new EventType(type, { bubbles: true, cancelable: true, view: bvEventView, button: 0 }));
    }
  }

  // More > Execute scenarios > <name> > Apply, exactly what the agent does by
  // hand (chain confirmed live with synthetic events, 2026-09-30). Apply -
  // not Execute - so the scenario's customer reply lands in the reply editor
  // unsent. Its status/type/tag/agent were already saved through the API.
  async function applyScenarioInUi(name) {
    let modal = document.querySelector('.modal-content.execute-scenarios');
    if (!modal) {
      const more = document.querySelector('button[data-test-actions="more"]');
      if (!more) return 'no More button';
      fireClick(more);
      const link = await waitFor(() => Array.from(document.querySelectorAll('a'))
        .find(a => isShown(a) && cleanText(a.textContent).startsWith('Execute scenarios')), { timeout: 4000, pollMs: 100 });
      if (!link) return 'no "Execute scenarios" in the More menu';
      fireClick(link);
      modal = await waitFor(() => document.querySelector('.modal-content.execute-scenarios'), { timeout: 6000, pollMs: 100 });
      if (!modal) return 'the scenarios panel did not open';
    }
    const item = await waitFor(() => Array.from(modal.querySelectorAll('[data-test-item="execute-scenario-item"]'))
      .find(candidate => cleanText(candidate.querySelector('.text--semibold')?.textContent) === name), { timeout: 6000, pollMs: 150 });
    const apply = item?.querySelector('[data-test-button="apply-scenario-btn"] button');
    if (!apply) return `scenario "${name}" not found`;
    fireClick(apply);
    return '';
  }

  // B2C Account Refunded (English) and FOX Refunded (Spanish), both read from
  // sent replies on 2026-09-30. The sentence holding the email is how the
  // scenario reply is recognised, in either language.
  const REPLY_EMAIL_SENTENCE = /associated with the email address|asociada a la direcci[oó]n de correo electr[oó]nico/i;
  const REPLY_PROFILES = {
    en: {
      sentence: /associated with the email address/i,
      signature: /regards,/gi,
      thanks: /thank you for contacting/gi,
      team: /technical support team/gi
    },
    es: {
      sentence: /asociada a la direcci[oó]n de correo electr[oó]nico/i,
      signature: /saludos cordiales,/gi,
      thanks: /gracias por contactar/gi,
      team: /equipo de soporte t[ée]cnico/gi
    }
  };
  const GREETING_WORDS = '(?:Hello|Hi|Dear|Hola|Estimad[oa])';

  // What Froala is about to send, checked against the template's rules:
  // email, team name and signature in bold (Sebastian, 2026-09-30: "bold en
  // el saludo, correo y firma"), and one greeting / "thank you" / signature
  // each - a reply once went out with two of everything. Returns the reason
  // NOT to send, or ''.
  function checkReplyLayout(html, expectedEmail) {
    const doc = document.createElement('div');
    doc.innerHTML = String(html || '');
    const text = cleanText(doc.textContent);
    const profile = REPLY_PROFILES.es.sentence.test(text) ? REPLY_PROFILES.es : REPLY_PROFILES.en;
    const bold = Array.from(doc.querySelectorAll('strong, b')).map(node => cleanText(node.textContent).toLowerCase());
    const count = pattern => (text.match(pattern) || []).length;
    const boldCount = pattern => bold.reduce((total, value) => total + (value.match(pattern) || []).length, 0);

    if (!bold.includes(expectedEmail)) return 'the email is not bold in what Freshdesk would send';
    if (count(profile.signature) !== 1) return `the reply has ${count(profile.signature)} signatures`;
    if (boldCount(profile.signature) !== 1) return 'the signature is not bold in what Freshdesk would send';
    if (boldCount(profile.team) !== count(profile.team)) return 'the team name is not bold everywhere in what Freshdesk would send';
    if (count(profile.thanks) > 1) return 'the reply repeats its "thank you for contacting" line';
    if (count(new RegExp(`\\b${GREETING_WORDS}\\s+[^,]{1,40},`, 'gi')) > 1) return 'the reply has more than one greeting';
    return '';
  }

  function findScenarioReplyEditor() {
    return Array.from(document.querySelectorAll('[contenteditable="true"]'))
      .find(editor => isShown(editor) && REPLY_EMAIL_SENTENCE.test(editor.textContent || '')) || null;
  }

  // The template reads "...associated with the email address <strong>x</strong>
  // has been successfully canceled..." (read from sent replies, 2026-09-30).
  // The bold node inside that sentence is the email - the one holding an @
  // first, else the first bold node of the sentence.
  function findReplyEmailNode(editor) {
    const blocks = Array.from(editor.querySelectorAll('div, p'))
      .filter(block => REPLY_EMAIL_SENTENCE.test(block.textContent || ''))
      .sort((a, b) => a.textContent.length - b.textContent.length);
    const block = blocks[0];
    if (!block) return null;
    const bold = Array.from(block.querySelectorAll('strong, b'));
    return bold.find(node => node.textContent.includes('@')) || bold[0] || null;
  }

  // "Hello J.," -> "Hello John," in the first greeting line only. The name
  // comes from the CMS account; with none there the greeting is left alone.
  function fixGreeting(editor, firstName) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue || '';
      if (!cleanText(text)) continue;
      const match = text.match(new RegExp(`^(\\s*${GREETING_WORDS}\\s+)([^,\\n]+?)(\\s*,)`, 'i'));
      if (!match) return '';
      if (cleanText(match[2]) === firstName) return '';
      node.nodeValue = match[1] + firstName + match[3] + text.slice(match[0].length);
      return `greeting "${cleanText(match[2])}" -> "${firstName}"`;
    }
    return '';
  }

  function runAutoBold(editor) {
    if (typeof window.__bvAutoBoldEditor !== 'function') return false;
    try {
      window.__bvAutoBoldEditor(editor);
      return true;
    } catch (error) {
      console.warn('[BV Refund Assist] Auto Bold pass failed.', error);
      return false;
    }
  }

  // If the email in the sentence is plain text, wrap it in <strong> - the
  // template always has it bold.
  function boldEmailInSentence(editor) {
    if (findReplyEmailNode(editor)?.textContent.includes('@')) return false;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const found = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(node.nodeValue || '');
      if (!found || node.parentElement?.closest('strong, b')) continue;
      const block = node.parentElement?.closest('div, p');
      if (!block || !REPLY_EMAIL_SENTENCE.test(block.textContent || '')) continue;
      const emailPart = node.splitText(found.index);
      emailPart.splitText(found[0].length);
      const strong = document.createElement('strong');
      emailPart.parentNode.replaceChild(strong, emailPart);
      strong.appendChild(emailPart);
      return true;
    }
    return false;
  }

  // Pushes the DOM into Froala's own model and returns the HTML Froala will
  // hand to Freshdesk on send (null when the instance cannot be found).
  // Froala lives in the page, hence unsafeWindow.
  function syncFroala(editor) {
    let pageWindow = window;
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) pageWindow = unsafeWindow;
    } catch (error) {
      // Fall back to the sandbox window.
    }
    const Froala = pageWindow.FroalaEditor;
    const instance = Froala && Array.from(Froala.INSTANCES || []).find(item => item && item.el === editor);
    if (!instance) return null;
    try {
      instance.undo.saveStep();
      instance.events.trigger('contentChanged');
      return String(instance.html.get() || '');
    } catch (error) {
      console.warn('[BV Refund Assist] Froala sync failed.', error);
      return null;
    }
  }

  // Sebastian's rule (2026-09-30): send the scenario reply only once it names
  // the email that was actually refunded. Wrong email -> correct it (bold
  // kept, the node itself is reused), then Send and set as Waiting on End
  // User. Anything that cannot be checked is NOT sent - it is left in the
  // editor with the reason on screen.
  // Several refunds -> the reply says how many (Sebastian, 2026-10-01).
  // Matched on the template's own refund sentence, in both languages:
  //   "The refund process has been initiated, ..."  (B2C Account Refunded)
  //   "Se ha iniciado el proceso de reembolso y ..." (FOX Refunded)
  const REFUND_COUNT_SENTENCES = [
    {
      find: /The refund process has been initiated/i,
      said: /The refund process for your \d+ charges/i,
      make: count => `The refund process for your ${count} charges has been initiated`
    },
    {
      find: /Se ha iniciado el proceso de reembolso/i,
      said: /proceso de reembolso de sus \d+ cargos/i,
      make: count => `Se ha iniciado el proceso de reembolso de sus ${count} cargos`
    }
  ];

  // '' = nothing to do (one refund, or already said), a description of the
  // change, or 'not-found' when the template no longer has the sentence.
  function addRefundCount(editor, count) {
    if (!(count > 1)) return '';
    if (REFUND_COUNT_SENTENCES.some(rule => rule.said.test(editor.textContent || ''))) return '';
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const rule of REFUND_COUNT_SENTENCES) {
        const match = rule.find.exec(node.nodeValue || '');
        if (!match) continue;
        node.nodeValue = node.nodeValue.slice(0, match.index) + rule.make(count) +
          node.nodeValue.slice(match.index + match[0].length);
        return `mentions the ${count} refunds`;
      }
    }
    return 'not-found';
  }

  async function checkAndSendReply(expectedEmail, firstName, { send = true, refundCount = 0 } = {}) {
    if (!expectedEmail) return { problem: 'CMS gave no account email to check the reply against' };
    const editor = await waitFor(findScenarioReplyEditor, { timeout: 10000, pollMs: 200 });
    if (!editor) return { problem: 'the scenario reply did not appear in the editor' };

    // Let Freshdesk finish inserting the scenario into the reply, then run
    // the Apply cleanup (Feature 2) that strips the default template's
    // duplicate greeting and signature - normally it runs on its own timer,
    // which the send used to beat.
    let lastText = '';
    let stableSince = Date.now();
    await waitFor(() => {
      const text = editor.textContent || '';
      if (text !== lastText) {
        lastText = text;
        stableSince = Date.now();
        return null;
      }
      return Date.now() - stableSince >= 1000 ? true : null;
    }, { timeout: 6000, pollMs: 200 });
    if (typeof window.__bvCleanAppliedReply === 'function') {
      try {
        window.__bvCleanAppliedReply(editor);
      } catch (error) {
        console.warn('[BV Refund Assist] Apply cleanup failed.', error);
      }
    } else {
      // Cleanup not loaded on this page - at least outwait its own timer.
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    if (!editor.isConnected || !REPLY_EMAIL_SENTENCE.test(editor.textContent || '')) {
      return { problem: 'the reply changed while it was being cleaned up' };
    }

    // The cleanup rewrites the reply as plain text (every <strong> gone -
    // seen live on #361824), so the Auto Bold pass (Feature 1) must run
    // BEFORE the email is looked for; normally a keystroke sets it off, here
    // nothing does. Whatever email the sentence holds is wrapped by hand if
    // it still is not bold.
    runAutoBold(editor);
    boldEmailInSentence(editor);

    const emailNode = findReplyEmailNode(editor);
    if (!emailNode || !emailNode.textContent.includes('@')) return { problem: 'could not find the email in the reply' };

    const changed = [];
    const shown = cleanText(emailNode.textContent).toLowerCase();
    if (shown !== expectedEmail) {
      emailNode.textContent = expectedEmail;
      changed.push(`email ${shown || '(empty)'} -> ${expectedEmail}`);
    }
    if (firstName) {
      const greeting = fixGreeting(editor, firstName);
      if (greeting) changed.push(greeting);
    }
    const countChange = addRefundCount(editor, Number(refundCount) || 0);
    if (countChange === 'not-found') changed.push(`the ${refundCount} refunds could NOT be added - the refund sentence was not found`);
    else if (countChange) changed.push(countChange);
    // Once more after the edits: the greeting rewrite can touch text nodes.
    runAutoBold(editor);

    // Read back before sending - never send on the strength of the write.
    const recheck = findReplyEmailNode(editor);
    if (!recheck || cleanText(recheck.textContent).toLowerCase() !== expectedEmail) {
      return { problem: 'the corrected email did not stick in the editor', changed };
    }

    // THE bug behind the unbolded reply (2026-09-30): Freshdesk sends
    // Froala's copy of the content, not the DOM, and that copy only updates
    // on Froala's own events. Measured live: after undo.saveStep() the
    // saved draft carried the DOM's <strong> tags. So: sync, then check what
    // FROALA will send - not what the page shows.
    const froalaHtml = syncFroala(editor);
    if (froalaHtml === null) return { problem: 'could not reach the Froala editor to sync it', changed };
    const layoutProblem = checkReplyLayout(froalaHtml, expectedEmail);
    if (layoutProblem) return { problem: layoutProblem, changed };

    // Test mode (see the data-bv-reply-check hook below): everything up to
    // here ran for real on the editor, only the send is skipped.
    if (!send) return { wouldSend: true, changed, html: froalaHtml };

    const toggle = document.querySelector('button[aria-label="Send and set as"]');
    if (!isShown(toggle)) return { problem: 'no "Send and set as" button', changed };
    fireClick(toggle);
    const option = await waitFor(() => {
      const link = document.querySelector('a[data-test-link="dropdown-submit-Waiting on End User"]');
      return isShown(link) ? link : null;
    }, { timeout: 4000, pollMs: 100 });
    if (!option) return { problem: 'no "Waiting on End User" option in the send menu', changed };
    fireClick(option);

    const closed = await waitFor(() => (editor.isConnected && isShown(editor) ? null : true), { timeout: 15000, pollMs: 300 });
    return closed
      ? { sent: true, changed }
      : { problem: 'clicked Send, but the reply is still open - check the ticket', changed };
  }

  // Add note, the way the agent does it: Froala's model synced first (the
  // button stays disabled until Freshdesk sees content), then the note
  // editor's own submit, then wait for the editor to close.
  async function submitNoteEditor(editor) {
    syncFroala(editor);
    const button = await waitFor(() => {
      const candidate = Array.from(document.querySelectorAll('button[data-test-id="submit"]'))
        .find(item => isShown(item) && /add note/i.test(item.textContent || ''));
      return candidate && !candidate.disabled ? candidate : null;
    }, { timeout: 6000, pollMs: 150 });
    if (!button) return 'the Add note button never became clickable';
    fireClick(button);
    const closed = await waitFor(() => (editor.isConnected && isShown(editor) ? null : true), { timeout: 15000, pollMs: 300 });
    return closed ? '' : 'clicked Add note, but the note editor is still open';
  }

  // The properties pane's Update, for the scenario fields (type, tag, agent)
  // when the API could not set them. Disabled = nothing left unsaved.
  async function clickPropertiesUpdate() {
    const button = await waitFor(() => {
      const candidate = document.querySelector('button[data-test-id="ticket-properties-btn"]');
      return candidate && isShown(candidate) && !candidate.disabled ? candidate : null;
    }, { timeout: 5000, pollMs: 200 });
    if (!button) return 'nothing to update';
    fireClick(button);
    const saved = await waitFor(() => (button.disabled || !button.isConnected ? true : null), { timeout: 15000, pollMs: 300 });
    return saved ? 'updated' : 'clicked Update, but it did not finish';
  }

  // Apply the scenario, check and send its reply, then (UI path) Update.
  async function runScenarioAndSend(entry) {
    const problem = await applyScenarioInUi(entry.applyScenario);
    if (problem) {
      showStatus(`Refund Assist: could not apply "${entry.applyScenario}" (${problem}). Apply it by hand.`, true);
      return;
    }
    const result = await checkAndSendReply(cleanText(entry.replyEmail).toLowerCase(), cleanText(entry.replyFirstName), {
      refundCount: Number(entry.refundCount) || 0
    });
    const fixes = result.changed && result.changed.length ? ` (fixed ${result.changed.join('; ')})` : '';
    if (!result.sent) {
      showStatus(`Refund Assist: "${entry.applyScenario}" applied but the reply was NOT sent - ${result.problem}${fixes}. Review it and send by hand.`, true);
      return;
    }
    let update = '';
    if (entry.updateProperties) {
      const outcome = await clickPropertiesUpdate();
      update = outcome === 'updated' ? ', properties updated' : (outcome === 'nothing to update' ? '' : ` - ${outcome}`);
    }
    showStatus(`Refund Assist: reply sent to the customer, ticket set to Waiting on End User${update}${fixes}.`);
  }

  async function consume(attempt = 0) {
    if (pasting) return;
    const ticketId = getTicketId();
    if (!ticketId) return;

    const now = Date.now();
    const entry = readQueue().find(item =>
      item && getEntryTicketId(item) === ticketId && Array.isArray(item.lines) &&
      now - Number(item.createdAt || 0) < BV_REFUND_ASSIST_NOTE_TTL_MS);
    if (!entry) return;

    if (entry.pasteNote === false) {
      if (!entry.applyScenario) {
        removeEntry(entry);
        return;
      }
      pasting = true;
      // Removed first: a retry loop that re-clicked Apply could stack the
      // reply twice. A failure is reported and left to the agent instead.
      removeEntry(entry);
      try {
        await runScenarioAndSend(entry);
      } catch (error) {
        console.error('[BV Refund Assist] Applying the scenario failed.', error);
        showStatus(`Refund Assist: applying "${entry.applyScenario}" failed. Apply it by hand.`, true);
      } finally {
        pasting = false;
      }
      return;
    }

    const editor = findEditor();
    if (!editor) {
      clickPrivateNote();
      if (attempt < 10) window.setTimeout(() => consume(attempt + 1), 700);
      return;
    }

    pasting = true;
    try {
      editor.focus();
      if (!writeNote(editor, entry)) return;
      removeEntry(entry);
      if (!entry.submitNote) {
        showStatus('Refund Assist: summary pasted into a private note - click Add note to save it.');
        return;
      }
      // The API could not save it (no key / account rate limit): the UI does
      // the whole rest, in the order the agent would.
      const notProblem = await submitNoteEditor(editor);
      if (notProblem) {
        showStatus(`Refund Assist: the note is pasted but NOT saved - ${notProblem}. Click Add note${entry.applyScenario ? `, then apply "${entry.applyScenario}"` : ''} by hand.`, true);
        return;
      }
      if (!entry.applyScenario) {
        showStatus('Refund Assist: private note saved.');
        return;
      }
      showStatus(`Refund Assist: private note saved - applying "${entry.applyScenario}"...`);
      await new Promise(resolve => setTimeout(resolve, 1200));
      await runScenarioAndSend(entry);
    } catch (error) {
      console.error('[BV Refund Assist] Could not finish the ticket steps.', error);
      showStatus('Refund Assist: something failed on the ticket - check the note, the reply and the properties.', true);
    } finally {
      pasting = false;
    }
  }

  function init() {
    if (!document.body) {
      window.setTimeout(init, 300);
      return;
    }
    window.setTimeout(consume, 400);
    try {
      if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(BV_REFUND_ASSIST_NOTE_KEY, function (_name, _old, _new, remote) {
          if (remote) consume();
        });
        // CMS finished cleanly and is about to close itself: if this tab is
        // that ticket, come to the front and say so, so CMS does not open a
        // duplicate. Needs @grant window.focus - Tampermonkey's version
        // actually brings the tab forward, the page's own does not.
        GM_addValueChangeListener(BV_FOCUS_TICKET_KEY, function (_name, _old, request, remote) {
          if (!remote || !request || String(request.ticketId) !== getTicketId()) return;
          if (Date.now() - Number(request.at || 0) > 15000) return;
          try {
            window.focus();
          } catch (error) {
            console.warn('[BV Refund Assist] Could not focus the ticket tab.', error);
          }
          try {
            GM_setValue(BV_FOCUS_TICKET_ACK_KEY, request.nonce);
          } catch (error) {
            // CMS then opens the ticket in a new tab instead.
          }
        });
      }
    } catch (error) {
      console.warn('[BV Refund Assist] Could not subscribe to note updates.', error);
    }
    window.setInterval(consume, 3000);

    // Live test hook, no send: set <html data-bv-reply-check="email|FirstName">
    // on a ticket whose reply editor holds the scenario reply; the check runs
    // on it (cleanup, email, greeting, bold, Froala sync, layout checks) and
    // the outcome lands in data-bv-reply-check-result as JSON. A data
    // attribute because the page cannot reach this sandbox any other way.
    new MutationObserver(async function () {
      const root = document.documentElement;
      const request = root.getAttribute('data-bv-reply-check');
      if (!request) return;
      root.removeAttribute('data-bv-reply-check');
      const [email, firstName, count] = request.split('|');
      let result;
      try {
        result = await checkAndSendReply(cleanText(email).toLowerCase(), cleanText(firstName || ''), { send: false, refundCount: Number(count) || 0 });
      } catch (error) {
        result = { problem: String(error && error.message || error) };
      }
      root.setAttribute('data-bv-reply-check-result', JSON.stringify(result));
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-bv-reply-check'] });
  }

  init();
})();

/* ============================================================
 * Feature 10: Copy the whole case to the clipboard
 *
 * The point is EVERYTHING, including the conversations Freshdesk hides
 * behind its "+11 conversations" block. Scraping the DOM for those means
 * clicking that block until it stops appearing and hoping Ember re-renders
 * in time - and even then it only ever yields what the page decided to
 * render.
 *
 * Freshdesk's own v2 REST API answers with nothing but the session cookie
 * (confirmed live 2026-08-21 from a ticket page: no API key, no CSRF token,
 * ~4000 calls/h left on the budget), and /tickets/<id>/conversations returns
 * the collapsed messages too - 59 on a ticket whose UI showed a handful. So
 * the API is the real path; the saved API key is the second try, and reading
 * the page is the last resort.
 * ============================================================ */

(function () {
  'use strict';

  if (location.hostname !== 'viewlift.freshdesk.com') return;

  const LAUNCHER_ID = 'better-freshdesk-copy-case';
  const CLAUDE_LAUNCHER_ID = 'better-freshdesk-case-to-claude';
  const PICKER_ID = 'better-freshdesk-case-helper-picker';
  const CHAT_KEY = 'betterFreshdeskCaseHelperChat';
  // Superseded by CHAT_KEY - read once so an existing choice is not lost.
  const LEGACY_SESSIONS_KEY = 'betterFreshdeskCaseHelperSessions';
  const LAUNCHER_STYLE_ID = 'better-freshdesk-copy-case-style';
  const FIELDS_CACHE_KEY = 'betterFreshdeskTicketFieldLabels';
  const AGENTS_CACHE_KEY = 'betterFreshdeskAgentNames';
  const GROUPS_CACHE_KEY = 'betterFreshdeskGroupNames';
  // Field labels, agent names and group names change on the order of never; a
  // page reload should not cost three extra API calls.
  const LOOKUP_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  const PER_PAGE = 100;
  // 100 messages a page, so this is a 2000-message ceiling - far past any real
  // ticket, and there purely so a paging bug cannot loop forever.
  const MAX_PAGES = 20;

  const SOURCE_LABELS = {
    1: 'Email', 2: 'Portal', 3: 'Phone', 4: 'Forum', 5: 'Twitter', 6: 'Facebook',
    7: 'Chat', 8: 'MobiHelp', 9: 'Feedback Widget', 10: 'Outbound Email',
    11: 'Ecommerce', 12: 'Bot', 13: 'WhatsApp'
  };

  function cleanText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function getTicketId() {
    const match = location.pathname.match(/\/a\/tickets\/(\d+)/i);
    return match ? match[1] : '';
  }

  // Local time, fixed shape. Deliberately not toLocaleString(): this text gets
  // pasted into notes and handed to other people, and a format that changes
  // with whoever is reading it is worse than one that is always the same.
  function formatWhen(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    const pad = number => String(number).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function htmlToText(html) {
    if (!html) return '';

    const holder = document.createElement('div');
    holder.innerHTML = String(html);
    holder.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    holder.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6').forEach(block => {
      block.appendChild(document.createTextNode('\n'));
    });

    // textContent, not innerText: the node is detached, so it has no layout and
    // innerText would come back empty.
    return (holder.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  function normalizeBody(entry) {
    const text = String((entry && entry.body_text) || '').trim();
    return text || htmlToText(entry && entry.body);
  }

  function apiViaSession(path) {
    return fetch(path, {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    }).then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + path);
      return response.json();
    });
  }

  function apiViaSavedKey(path) {
    return new Promise((resolve, reject) => {
      freshdeskApiRequest({
        path,
        onDone: (error, data) => (error ? reject(error) : resolve(data))
      });
    });
  }

  // The session cookie is enough on a ticket page, so this needs no setup at
  // all. The saved API key (Freshdesk: Set API Key) is only a second try for
  // the case where the session is not accepted for API calls.
  async function api(path) {
    try {
      return await apiViaSession(path);
    } catch (error) {
      if (!getFreshdeskApiKey()) throw error;
      return apiViaSavedKey(path);
    }
  }

  // Only the reduced map is cached, never the raw payload: the agent list comes
  // back with everyone's email, phone and signature attached, and none of that
  // needs to sit in GM storage to turn an id into a name.
  async function cachedMap(key, build) {
    try {
      const hit = GM_getValue(key, null);
      if (hit && hit.map && Date.now() - Number(hit.at || 0) < LOOKUP_CACHE_TTL_MS) return hit.map;
    } catch (error) { /* storage unavailable - just rebuild */ }

    const map = await build();

    try {
      GM_setValue(key, { at: Date.now(), map });
    } catch (error) { /* storage unavailable - the map is still usable now */ }

    return map;
  }

  async function pagedList(path) {
    const all = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const separator = path.indexOf('?') === -1 ? '?' : '&';
      const batch = await api(path + separator + 'per_page=' + PER_PAGE + '&page=' + page);
      if (!Array.isArray(batch) || !batch.length) break;

      all.push.apply(all, batch);
      if (batch.length < PER_PAGE) break;
    }

    return all;
  }

  // status choices arrive as {id: [label, customerFacingLabel]}, priority as
  // {label: id} - same endpoint, two different shapes. Normalize both to
  // {id: label} instead of special-casing at the call site.
  function choicesToIdLabelMap(choices) {
    const map = {};
    if (!choices || typeof choices !== 'object') return map;

    Object.keys(choices).forEach(key => {
      const value = choices[key];
      if (Array.isArray(value)) map[String(key)] = String(value[0]);
      else if (typeof value === 'number' || /^\d+$/.test(String(value))) map[String(value)] = String(key);
      else map[String(key)] = String(value);
    });

    return map;
  }

  function buildFieldLabels(fields) {
    const list = Array.isArray(fields) ? fields : [];
    const byName = name => list.find(field => field && field.name === name) || {};
    const custom = {};

    list.filter(field => field && /^cf_/.test(String(field.name))).forEach(field => {
      custom[field.name] = String(field.label || field.name);
    });

    return {
      status: choicesToIdLabelMap(byName('status').choices),
      priority: choicesToIdLabelMap(byName('priority').choices),
      custom
    };
  }

  function getFieldLabels() {
    return cachedMap(FIELDS_CACHE_KEY, async () => buildFieldLabels(await api('/api/v2/ticket_fields')));
  }

  function getAgentNames() {
    return cachedMap(AGENTS_CACHE_KEY, async () => {
      const agents = await pagedList('/api/v2/agents');
      const map = {};

      agents.forEach(agent => {
        const name = cleanText(agent && agent.contact && agent.contact.name);
        if (agent && agent.id && name) map[String(agent.id)] = name;
      });

      return map;
    });
  }

  // Group names accumulate one id at a time rather than listing every group:
  // a case only ever has one, and the whole list is a bigger call for no gain.
  async function getGroupName(groupId) {
    if (!groupId) return '';

    let cache = null;
    try {
      cache = GM_getValue(GROUPS_CACHE_KEY, null);
    } catch (error) { /* storage unavailable */ }

    const fresh = Boolean(cache && Date.now() - Number(cache.at || 0) < LOOKUP_CACHE_TTL_MS);
    const map = (fresh && cache.map) || {};
    if (map[String(groupId)]) return map[String(groupId)];

    try {
      const group = await api('/api/v2/groups/' + groupId);
      const name = cleanText(group && group.name);
      if (!name) return '';

      map[String(groupId)] = name;
      try {
        GM_setValue(GROUPS_CACHE_KEY, { at: fresh ? Number(cache.at) : Date.now(), map });
      } catch (error) { /* storage unavailable */ }

      return name;
    } catch (error) {
      // A missing group name is not worth failing the whole copy over.
      return '';
    }
  }

  function authorFor(entry, context) {
    const names = (context && context.agentNames) || {};
    const requester = (context && context.requester) || {};
    const userId = String((entry && entry.user_id) || '');

    if (userId && names[userId]) return names[userId];
    if (userId && String(requester.id || '') === userId) {
      return requester.name || requester.email || 'Requester';
    }

    return cleanText(entry && entry.from_email) || 'Unknown';
  }

  // private/incoming, not `source`: a note and an agent's email reply can both
  // carry source values that say nothing about who is talking to whom.
  function kindFor(entry) {
    if (entry && entry.private) return 'PRIVATE NOTE';
    if (entry && entry.incoming) return 'CUSTOMER';
    return 'AGENT REPLY';
  }

  function attachmentLines(entry) {
    return ((entry && entry.attachments) || []).map(attachment => {
      const size = Number(attachment && attachment.size);
      const sizeText = Number.isFinite(size) && size > 0
        ? ' (' + Math.max(1, Math.round(size / 1024)) + ' KB)'
        : '';
      return '   [attachment] ' + cleanText(attachment && attachment.name) + sizeText;
    });
  }

  function buildMessageBlock(index, kind, author, when, body, extras) {
    const head = '--- ' + index + ' · ' + kind + ' · ' + author + (when ? ' · ' + when : '') + ' ---';
    return [head, body || '(no text)'].concat(extras || []).join('\n');
  }

  function buildReport(data) {
    const ticket = (data && data.ticket) || {};
    const labels = (data && data.labels) || { status: {}, priority: {}, custom: {} };
    const requester = (data && data.requester) || {};
    const conversations = (data && data.conversations) || [];
    const context = { agentNames: (data && data.agentNames) || {}, requester };

    const header = [];
    const field = (label, value) => {
      const text = Array.isArray(value) ? value.filter(Boolean).join(', ') : cleanText(value);
      if (text) header.push((label + ':').padEnd(12) + text);
    };

    field('Status', labels.status[String(ticket.status)] || ticket.status);
    field('Priority', labels.priority[String(ticket.priority)] || ticket.priority);
    field('Type', ticket.type);
    field('Source', SOURCE_LABELS[ticket.source] || ticket.source);
    field('Group', data && data.groupName);
    field('Agent', data && data.agentName);
    field('Tags', ticket.tags);
    field('Created', formatWhen(ticket.created_at));
    field('Updated', formatWhen(ticket.updated_at));
    field('Due by', formatWhen(ticket.due_by));
    field('Requester', [requester.name, requester.email ? '<' + requester.email + '>' : '']
      .filter(Boolean).join(' '));
    field('Phone', requester.phone || requester.mobile);
    field('To', ticket.to_emails);
    field('CC', ticket.cc_emails);

    // Only the custom fields that were actually filled in - this account has
    // 13 of them and most cases use two.
    Object.keys(ticket.custom_fields || {}).forEach(name => {
      const value = ticket.custom_fields[name];
      if (value === null || value === undefined || value === '' || value === false) return;
      field(labels.custom[name] || name.replace(/^cf_/, ''), String(value));
    });

    // The description is not part of /conversations - it is the ticket's own
    // first message, so it has to be prepended by hand.
    const messages = [buildMessageBlock(
      1,
      'CUSTOMER',
      requester.name || requester.email || 'Requester',
      formatWhen(ticket.created_at),
      normalizeBody({ body_text: ticket.description_text, body: ticket.description }),
      attachmentLines(ticket)
    )];

    conversations.forEach((entry, index) => {
      messages.push(buildMessageBlock(
        index + 2,
        kindFor(entry),
        authorFor(entry, context),
        formatWhen(entry.created_at),
        normalizeBody(entry),
        attachmentLines(entry)
      ));
    });

    const rule = '='.repeat(62);
    let version = '';
    try {
      version = (GM_info && GM_info.script && GM_info.script.version) || '';
    } catch (error) { /* GM_info unavailable */ }

    return [
      rule,
      'TICKET #' + ticket.id + ' — ' + (cleanText(ticket.subject) || '(no subject)'),
      location.origin + '/a/tickets/' + ticket.id,
      rule,
      header.join('\n'),
      '',
      messages.join('\n\n'),
      '',
      rule,
      messages.length + ' message' + (messages.length === 1 ? '' : 's') +
        ' · copied ' + formatWhen(new Date().toISOString()) +
        (version ? ' · Better Viewlift ' + version : '')
    ].join('\n');
  }

  async function collectViaApi(ticketId) {
    const ticket = await api('/api/v2/tickets/' + ticketId + '?include=requester');

    // Only the conversations are allowed to fail the whole thing - they ARE
    // the feature. A label or agent-name lookup that 403s (narrower API
    // permissions than the ticket read) must degrade to raw ids, not throw
    // the case back to the DOM fallback and lose every collapsed message.
    const [labels, agentNames, conversations] = await Promise.all([
      getFieldLabels().catch(error => {
        console.warn('[Copy case] Field labels unavailable - falling back to raw ids.', error);
        return { status: {}, priority: {}, custom: {} };
      }),
      getAgentNames().catch(error => {
        console.warn('[Copy case] Agent names unavailable - falling back to addresses.', error);
        return {};
      }),
      pagedList('/api/v2/tickets/' + ticketId + '/conversations')
    ]);

    return buildReport({
      ticket,
      requester: ticket.requester || {},
      labels,
      agentNames,
      conversations,
      groupName: await getGroupName(ticket.group_id),
      agentName: agentNames[String(ticket.responder_id)] || ''
    });
  }

  /* ---------- fallback: whatever the page itself is showing ---------- */

  function isVisible(element) {
    if (!element || element.nodeType !== 1) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const BLOCK_TAGS = /^(?:DIV|P|LI|TR|BR|H1|H2|H3|H4|H5|H6|SECTION|ARTICLE)$/;
  const OUR_UI_ID = /^(?:better-freshdesk|better-viewlift|tm-viewlift|refund-capture)/;
  const OUR_UI_CLASS = /^better-freshdesk-/;

  // A text walker rather than innerText on a clone: our own injected chips and
  // panels have to come out (they would otherwise show up as duplicated emails
  // inside the copied case), and a detached clone has no layout, so its
  // innerText is always ''.
  function readTextSkippingOurUi(root) {
    const parts = [];

    const walk = node => {
      if (!node) return;
      if (node.nodeType === 3) { parts.push(node.nodeValue || ''); return; }
      if (node.nodeType !== 1 && node.nodeType !== 11) return;
      if (node.tagName === 'STYLE' || node.tagName === 'SCRIPT') return;
      if (node.id && OUR_UI_ID.test(node.id)) return;
      if (node.classList && Array.from(node.classList).some(name => OUR_UI_CLASS.test(name))) return;

      Array.from(node.childNodes).forEach(walk);
      if (node.tagName && BLOCK_TAGS.test(node.tagName)) parts.push('\n');
    };

    walk(root);
    return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Each click loads one more page of collapsed messages, so this keeps going
  // until the block stops coming back. Ember guards some of its own controls
  // against synthetic clicks (see memory.md on the favourites star), which is
  // exactly why this is the fallback and not the main path.
  async function expandHiddenConversations() {
    let clicked = 0;

    for (let round = 0; round < 12; round++) {
      const blocks = Array.from(document.querySelectorAll('[data-test-button="load-more"]')).filter(isVisible);
      if (!blocks.length) break;

      blocks.forEach(block => {
        try { block.click(); clicked++; } catch (error) { /* guarded - nothing to do */ }
      });

      await new Promise(resolve => window.setTimeout(resolve, 700));
    }

    return clicked;
  }

  async function collectViaDom(ticketId) {
    await expandHiddenConversations();

    const messages = Array.from(document.querySelectorAll('.ticket-details__item'))
      .filter(item => !item.classList.contains('rich-editor'))
      .map(readTextSkippingOurUi)
      .filter(Boolean)
      .map((text, index) => '--- ' + (index + 1) + ' ---\n' + text);

    const properties = readTextSkippingOurUi(document.querySelector('.ticket-properties-wrapper'));
    const contactHost = document.querySelector('fw-unified-mfe--contact-info');
    const contact = contactHost && contactHost.shadowRoot
      ? readTextSkippingOurUi(contactHost.shadowRoot)
      : '';

    const rule = '='.repeat(62);

    return [
      rule,
      'TICKET #' + ticketId + ' — ' + cleanText(document.title),
      location.origin + '/a/tickets/' + ticketId,
      rule,
      'READ OFF THE PAGE - the Freshdesk API was unreachable, so anything the',
      'page had not rendered is missing from this copy.',
      '',
      contact ? 'CONTACT\n' + contact + '\n' : '',
      properties ? 'PROPERTIES\n' + properties + '\n' : '',
      messages.join('\n\n')
    ].filter(Boolean).join('\n');
  }

  function copyToClipboard(text) {
    // GM_setClipboard, not navigator.clipboard: this runs after several awaited
    // fetches, by which point Chrome has dropped the click's user activation
    // and the async clipboard API would reject.
    try {
      GM_setClipboard(text, 'text');
      return true;
    } catch (error) {
      try {
        navigator.clipboard.writeText(text);
        return true;
      } catch (fallbackError) {
        console.error('[Copy case] No clipboard channel worked.', error, fallbackError);
        return false;
      }
    }
  }

  // Shared by both launchers: the clipboard one and the send-to-Claude one.
  async function collectCase(ticketId) {
    try {
      return { report: await collectViaApi(ticketId), viaApi: true };
    } catch (error) {
      console.warn('[Copy case] The Freshdesk API path failed - reading the page instead.', error);
      return { report: await collectViaDom(ticketId), viaApi: false };
    }
  }

  async function copyFullCase() {
    const ticketId = getTicketId();
    if (!ticketId) {
      bvNotify('Open a ticket first - there is no case to copy here.', { level: 'warn' });
      return '';
    }

    const { report, viaApi } = await collectCase(ticketId);

    if (!copyToClipboard(report)) return '';

    const messageCount = (report.match(/^--- \d+ /gm) || []).length;
    bvNotify(
      viaApi
        ? 'Case #' + ticketId + ' copied - ' + messageCount + ' messages, the collapsed ones included.'
        : 'Case #' + ticketId + ' copied from the page only (API unreachable) - may be incomplete.',
      { level: viaApi ? 'info' : 'warn' }
    );

    return report;
  }

  /* ---------- Case helper: which chat, and sending to it ---------- */

  // One link, not a set of named sessions: whichever chat the agent wants the
  // case in, pasted once.
  function readChatUrl() {
    try {
      const stored = GM_getValue(CHAT_KEY, '');
      if (typeof stored === 'string' && stored) return stored;

      // Carry over the first usable URL from the two-session version.
      const legacy = GM_getValue(LEGACY_SESSIONS_KEY, null);
      if (legacy && typeof legacy === 'object' && legacy.urls) {
        const carried = legacy.urls[legacy.chosen] ||
          Object.values(legacy.urls).find(Boolean);
        if (carried) return String(carried);
      }
    } catch (error) { /* storage unavailable */ }

    return '';
  }

  function writeChatUrl(url) {
    try {
      GM_setValue(CHAT_KEY, url);
    } catch (error) {
      console.warn('[Case helper] Could not save the chat link.', error);
    }
  }

  // The stored URL is typed by hand and later opened in a tab, so it is
  // validated the same way the CMS snapshot link is: https, claude.ai, and a
  // path that is actually a chat or a project.
  function toSafeClaudeUrl(value) {
    const raw = cleanText(value);
    if (!raw) return '';

    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:') return '';
      if (url.hostname !== 'claude.ai' && url.hostname !== 'www.claude.ai') return '';
      // /cowork/<id> is what a Case helper session actually is; /chat and
      // /project are the classic surfaces and still accepted.
      if (url.pathname !== '/new' && !/^\/(?:chat|project|cowork)\/[^/]+/.test(url.pathname)) return '';
      return url.href;
    } catch (error) {
      return '';
    }
  }

  function closeSessionPicker() {
    const picker = document.getElementById(PICKER_ID);
    if (picker) picker.remove();
  }

  function openSessionPicker(onChosen) {
    closeSessionPicker();
    addLauncherStyles();

    const overlay = document.createElement('div');
    overlay.id = PICKER_ID;
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeSessionPicker();
    });

    const card = document.createElement('div');
    card.className = 'bv-case-helper-card';

    const title = document.createElement('div');
    title.className = 'bv-case-helper-title';
    title.textContent = 'Case helper: link del chat';
    card.appendChild(title);

    const hint = document.createElement('div');
    hint.className = 'bv-case-helper-hint';
    hint.textContent = 'Pega el link una vez y queda guardado. Click derecho en el botón para cambiarlo.';
    card.appendChild(hint);

    const row = document.createElement('div');
    row.className = 'bv-case-helper-row';

    const input = document.createElement('input');
    input.type = 'url';
    input.spellcheck = false;
    input.placeholder = 'https://claude.ai/cowork/...';
    input.value = readChatUrl();
    row.appendChild(input);

    const use = document.createElement('button');
    use.type = 'button';
    use.textContent = 'Guardar y enviar';

    const save = () => {
      const url = toSafeClaudeUrl(input.value);
      if (!url) {
        input.dataset.invalid = 'yes';
        hint.textContent = 'Ese link no es de claude.ai, o no es un chat/cowork/project.';
        return;
      }

      writeChatUrl(url);
      closeSessionPicker();
      if (typeof onChosen === 'function') onChosen();
    };

    use.addEventListener('click', save);
    input.addEventListener('keydown', event => { if (event.key === 'Enter') save(); });
    row.appendChild(use);

    card.appendChild(row);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  // At most three, and each one carries the chat it is meant for: the
  // claude.ai side must never paste a case into the wrong chat just because
  // that tab happened to open first.
  function queueCaseForClaude(entry) {
    try {
      const existing = GM_getValue(BV_CASE_TO_CLAUDE_KEY, null);
      const queue = Array.isArray(existing) ? existing : (existing ? [existing] : []);
      queue.push(entry);
      GM_setValue(BV_CASE_TO_CLAUDE_KEY, queue.slice(-3));
      return true;
    } catch (error) {
      console.error('[Case helper] Could not queue the case for claude.ai.', error);
      return false;
    }
  }

  async function sendCaseToClaude() {
    const ticketId = getTicketId();
    if (!ticketId) {
      bvNotify('Open a ticket first - there is no case to send.', { level: 'warn' });
      return false;
    }

    const targetUrl = toSafeClaudeUrl(readChatUrl());
    if (!targetUrl) {
      openSessionPicker(sendCaseToClaude);
      return false;
    }

    const { report, viaApi } = await collectCase(ticketId);

    // Also on the clipboard, always: if claude.ai ever renames its composer
    // and the paste fails, Ctrl+V still gets the job done.
    copyToClipboard(report);

    if (!queueCaseForClaude({
      ticketId,
      report,
      targetUrl,
      createdAt: Date.now()
    })) return false;

    try {
      GM_openInTab(targetUrl, { active: true, insert: true });
    } catch (error) {
      console.error('[Case helper] Could not open the chat tab.', error);
      return false;
    }

    const messageCount = (report.match(/^--- \d+ /gm) || []).length;
    bvNotify(
      'Case #' + ticketId + ' (' + messageCount + ' messages' +
        (viaApi ? '' : ', read off the page') + ') sent to the Case helper chat.',
      { level: 'info' }
    );

    return true;
  }

  /* ---------- the floating launchers ---------- */

  function isTicketPage() {
    return /^\/a\/tickets\/\d+(?:\/|$)/i.test(location.pathname);
  }

  // Deliberately NOT in Feature 8's unified toolbar, where this button started:
  // that toolbar only mounts once its action-bar container exists AND the tab
  // is visible, so the button was missing exactly when it was wanted. A float
  // parented to <body> has neither dependency.
  function addLauncherStyles() {
    if (document.getElementById(LAUNCHER_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = LAUNCHER_STYLE_ID;
    style.textContent = `
      #${LAUNCHER_ID}, #${CLAUDE_LAUNCHER_ID} {
        position: fixed !important;
        /* The corner itself: the Refund Capture float lives on CMS now and
           the 🧠 float is gone, so on Freshdesk this is the only one. */
        right: 20px !important;
        bottom: 20px !important;
        width: 52px !important;
        height: 52px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 0 !important;
        border: none !important;
        border-radius: 999px !important;
        background: #2f5f8f !important;
        color: #ffffff !important;
        font-size: 22px !important;
        line-height: 1 !important;
        cursor: pointer !important;
        box-shadow: 0 12px 28px rgba(11, 92, 171, .34) !important;
        /* One below the refund panel: when that one is expanded to its full
           372px it should cover this, not fight it for the same corner. */
        z-index: 999998 !important;
        transition: background 140ms ease, transform 140ms ease !important;
      }

      /* One more 52px + 12px gap along, so the row reads
         [case to Claude] [copy case] [refund]. */
      #${CLAUDE_LAUNCHER_ID} { right: 148px !important; background: #a8492c !important; }
      #${CLAUDE_LAUNCHER_ID}:hover { background: #8f3d25 !important; }

      #${LAUNCHER_ID}:hover { background: #274e75 !important; }

      #${LAUNCHER_ID}:active,
      #${CLAUDE_LAUNCHER_ID}:active { transform: scale(.94) !important; }

      #${LAUNCHER_ID}:disabled,
      #${CLAUDE_LAUNCHER_ID}:disabled { opacity: .75 !important; cursor: default !important; }

      #${PICKER_ID} {
        position: fixed !important;
        inset: 0 !important;
        z-index: 1000002 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        background: rgba(15, 23, 42, .38) !important;
        font-family: Arial, sans-serif !important;
      }

      #${PICKER_ID} .bv-case-helper-card {
        width: 460px !important;
        max-width: calc(100vw - 32px) !important;
        padding: 18px !important;
        border-radius: 14px !important;
        background: #ffffff !important;
        box-shadow: 0 22px 55px rgba(15, 23, 42, .32) !important;
        color: #17324d !important;
      }

      #${PICKER_ID} .bv-case-helper-title {
        font: 700 14px/1.3 Arial, sans-serif !important;
        margin-bottom: 6px !important;
      }

      #${PICKER_ID} .bv-case-helper-hint {
        font: 400 12px/1.45 Arial, sans-serif !important;
        color: #5a6c7d !important;
        margin-bottom: 14px !important;
      }

      #${PICKER_ID} .bv-case-helper-row {
        display: grid !important;
        grid-template-columns: 1fr auto !important;
        gap: 6px 8px !important;
        margin-bottom: 14px !important;
      }

      #${PICKER_ID} .bv-case-helper-label {
        grid-column: 1 / -1 !important;
        font: 700 12px/1.2 Arial, sans-serif !important;
      }

      #${PICKER_ID} input {
        padding: 8px 10px !important;
        border: 1px solid #d5dbe1 !important;
        border-radius: 7px !important;
        font: 400 12px/1.2 Arial, sans-serif !important;
        color: #17324d !important;
        background: #ffffff !important;
      }

      #${PICKER_ID} input[data-invalid="yes"] { border-color: #dc2626 !important; }

      #${PICKER_ID} button {
        padding: 8px 12px !important;
        border: none !important;
        border-radius: 7px !important;
        background: #2f5f8f !important;
        color: #ffffff !important;
        font: 700 12px/1.2 Arial, sans-serif !important;
        cursor: pointer !important;
      }

      #${PICKER_ID} button:hover { background: #274e75 !important; }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  async function onClaudeLauncherClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = document.getElementById(CLAUDE_LAUNCHER_ID);
    if (!button || button.disabled) return;

    if (!toSafeClaudeUrl(readChatUrl())) {
      // First run: no link saved yet, so ask instead of guessing.
      openSessionPicker(sendCaseToClaude);
      return;
    }

    button.disabled = true;
    button.textContent = '⏳';

    let sent = false;
    try {
      sent = await sendCaseToClaude();
    } catch (error) {
      console.error('[Case helper] Sending the case failed.', error);
    }

    button.disabled = false;
    button.textContent = sent ? '✅' : '⚠️';
    window.setTimeout(() => {
      const current = document.getElementById(CLAUDE_LAUNCHER_ID);
      if (current) current.textContent = '🧠';
    }, 1400);
  }

  function onClaudeLauncherContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    openSessionPicker(sendCaseToClaude);
  }

  async function onLauncherClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = document.getElementById(LAUNCHER_ID);
    if (!button || button.disabled) return;

    // The copy takes a couple of API round-trips, and bvNotify only reaches the
    // console now that the toasts are gone - so the button is the feedback.
    button.disabled = true;
    button.textContent = '⏳';

    let copied = '';
    try {
      copied = await copyFullCase();
    } catch (error) {
      console.error('[Copy case] Failed.', error);
    }

    button.disabled = false;
    button.textContent = copied ? '✅' : '⚠️';
    window.setTimeout(() => {
      const current = document.getElementById(LAUNCHER_ID);
      if (current) current.textContent = '📋';
    }, 1400);
  }

  // The handlers are reached through arrows on purpose: this table is built
  // while the module is still being defined.
  // The 🧠 "send the case to a Case helper chat" float was removed on
  // request (2026-09-30: "ya ese no lo voy a usar"); a copy left on screen by
  // an older version is taken down by installLauncher().
  const LAUNCHERS = [
    {
      id: LAUNCHER_ID,
      glyph: '📋',
      title: 'Copy the whole case (every message, including the collapsed ones)',
      ariaLabel: 'Copy the whole case to the clipboard',
      click: event => onLauncherClick(event)
    }
  ];

  function installLauncher() {
    document.getElementById(CLAUDE_LAUNCHER_ID)?.remove();
    if (!isTicketPage()) {
      LAUNCHERS.forEach(spec => {
        const stale = document.getElementById(spec.id);
        if (stale) stale.remove();
      });
      closeSessionPicker();
      return;
    }

    if (!document.body) return;

    addLauncherStyles();

    LAUNCHERS.forEach(spec => {
      const existing = document.getElementById(spec.id);
      if (existing && existing.isConnected) return;

      const button = document.createElement('button');
      button.id = spec.id;
      button.type = 'button';
      button.textContent = spec.glyph;
      button.title = spec.title;
      button.setAttribute('aria-label', spec.ariaLabel);
      button.addEventListener('click', spec.click);
      if (spec.contextMenu) button.addEventListener('contextmenu', spec.contextMenu);

      document.body.appendChild(button);
    });
  }

  onRouteChange(installLauncher);

  // Also the hook Feature 8's old toolbar button used, and how the copy can be
  // triggered from the console.
  window.__bvCopyFullCase = copyFullCase;
})();

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
  // Path read on every pass, not at load - see Feature 8 (2026-09-30).

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
        padding: 3px 9px !important;
        border-radius: 4px !important;
        border: 1px solid #bed4f2 !important;
        background: #e8f0fc !important;
        color: #1b4a9c !important;
        font: 500 12px Arial, sans-serif !important;
        cursor: copy !important;
        white-space: nowrap !important;
        box-shadow: none !important;
        transition: background 120ms ease, border-color 120ms ease !important;
      }
      .${CHIP_CLASS}:hover {
        background: #d8e6fa !important;
        border-color: #9dbfe9 !important;
      }
      .${CHIP_CLASS}[data-type="phone"] {
        border-color: #bcdfcb !important;
        background: #e6f4ec !important;
        color: #14683f !important;
      }
      .${CHIP_CLASS}[data-type="phone"]:hover {
        background: #d5ebde !important;
        border-color: #9fcfb4 !important;
      }
      .${CHIP_CLASS}[data-type="cms"] {
        cursor: pointer !important;
        border-color: #2c5cc5 !important;
        background: #2c5cc5 !important;
        color: #ffffff !important;
        font-weight: 600 !important;
      }
      .${CHIP_CLASS}[data-type="cms"]:hover {
        background: #24499c !important;
        border-color: #24499c !important;
      }
      .${CHIP_CLASS}[data-copied="yes"] {
        border-color: #9fcfb4 !important;
        background: #e6f4ec !important;
        color: #14683f !important;
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

      // These are exactly the addresses the CMS button deliberately does
      // NOT chase (it only ever uses the ticket's Contact Info email), so
      // give each mentioned address its own one-click CMS lookup instead
      // of making the button guess between them.
      if (entry.type === 'email' && typeof window.__bvOpenCmsForEmail === 'function') {
        const cmsChip = document.createElement('button');
        cmsChip.type = 'button';
        cmsChip.className = CHIP_CLASS;
        cmsChip.dataset.type = 'cms';
        cmsChip.textContent = 'CMS';
        cmsChip.title = `Open the CMS account for ${entry.value}`;
        cmsChip.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          window.__bvOpenCmsForEmail(entry.value, window.__bvGetFreshdeskClientContext
            ? window.__bvGetFreshdeskClientContext()
            : { primary: '', fallback: '' });
        });
        row.appendChild(cmsChip);
      }
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
    }
    // The top action bar's own "Reply" shortcut used to be deleted here.
    // It is only CSS-hidden now (see addStyles): Sebastian runs a separate
    // "reply with bot" userscript that anchors on that button, and ripping
    // the node out of the DOM on every route change broke it. Hiding keeps
    // it out of his way - which is all he asked for - while leaving the
    // node in place for the other script to find and click. Do not put
    // this back into removalRules.
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

// Host only, not the path: Freshdesk is a single-page app, so a session that
// starts on a list or the dashboard reaches its tickets without a page load,
// and a load-time path check left these features off for the whole session.
if (location.hostname === 'viewlift.freshdesk.com') {
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
        // FOX's replies are Spanish: "Saludos cordiales, / Equipo de Soporte
        // Técnico" is the same signature and gets the same treatment.
        const signaturePattern = /(^|\n)(\s*(?:Regards,\s*\n\s*The Technical Support Team|Saludos cordiales,\s*\n\s*Equipo de Soporte T[ée]cnico)\b[\s\S]*?)(?=\n\s*\S)/i;
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
        const defaultSpanishTemplatePattern = /\n+\s*Gracias por contactar con el Equipo de Soporte T[ée]cnico\.\s*\n+\s*Saludos cordiales,\s*\n\s*Equipo de Soporte T[ée]cnico\s*$/i;

        return text.replace(defaultTemplatePattern, '').replace(defaultSpanishTemplatePattern, '').trim();
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
            view: bvEventView,
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

    // Refund Assist (Feature 9b) clicks Apply itself and then sends. The
    // click above schedules this same cleanup 0.3-2.5s later, and the send
    // used to beat it - a reply went out with the default template's greeting
    // and signature still wrapped around the scenario (2026-09-30). So it
    // runs the cleanup now, on the editor it names, and cancels the pending
    // one so it cannot rewrite the reply (dropping its bold) after the sync.
    window.__bvCleanAppliedReply = function (editor) {
        scheduledCleanRunId += 1;
        if (editor) {
            lastEditor = editor;
            try {
                editor.focus();
            } catch (error) {
                // Focus is only a hint for getEditor().
            }
        }
        clearCannedResponseMode(editor || getEditor());
        markForceRewrite('apply');
        cleanCurrentEditor();
    };

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

    // See the note in Feature 1: claude.ai is a matched host now.
    if (location.hostname !== 'viewlift.freshdesk.com' && !isCMSHost()) return;

    const CMS_USERS_URLS = {
        standard: 'https://cms.viewlift.com/users/search',
        gcp: 'https://cms-gcp.viewlift.com/users/search',
        msn: 'https://cms.monumentalsportsnetwork.com/users/search',
        fox: 'https://foxone.cms.viewlift.com/users/search'
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

    // The breadcrumb at the top of a ticket page is NOT ticket data - it is the
    // name of the saved view the agent arrived from ([data-test-title="main-title"]
    // wraps an anchor pointing at /a/tickets). Brand detection used to read it as
    // its highest-priority signal, which only ever looked correct because the views
    // happened to be named after single brands ("Altitude", "MSN", "SCHN"). Rename
    // one to "ALTITUDE + LIV + MSN" and every ticket opened from it resolves to
    // whichever brand getCMSKeyFromClientText tests first - MSN - so the CMS button
    // opens the wrong CMS entirely. Read live on ticket #352179 (2026-08-20): all
    // four resolving primary chunks were the view name and nothing else. The view
    // name is now excluded on ticket pages, from primary AND fallback.
    function isTicketDetailPage() {
        return /^\/a\/tickets\/\d+/.test(location.pathname);
    }

    function getViewNameChrome() {
        if (!isTicketDetailPage()) return '';

        const holder = document.querySelector(
            '[data-test-title="main-title"], .header-primary .breadcrumb-title'
        );

        return holder ? cleanText(holder.innerText || holder.textContent || '') : '';
    }

    // The ticket subject moved into shadow DOM (the ticket-details custom element),
    // so every ticket-subject selector below now matches nothing - confirmed live.
    // document.title is the one place it stays readable, and it is genuine ticket
    // data, so it leads the primary chunks.
    function getTicketSubjectFromTitle() {
        const title = cleanText(document.title || '');

        if (!title) return '';

        return cleanText(
            title
                .replace(/\s*:\s*ViewLift\s*$/i, '')
                .replace(/^\[#\d+\]\s*/, '')
        );
    }

    function getFreshdeskClientContext() {
        // The ticket record's own brand, when known, is the whole context:
        // in a combined filter view the page text below names the VIEW, and
        // that is how the button used to open the wrong CMS.
        const resolvedBrand = bvGetTicketBrand();
        if (resolvedBrand && resolvedBrand.context) {
            return { primary: resolvedBrand.context, fallback: '' };
        }

        const primaryChunks = [];
        const viewNameChrome = getViewNameChrome();
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
        ].filter(selector => !(viewNameChrome && /main-title|breadcrumb-title/.test(selector)));

        addClientContextText(primaryChunks, getTicketSubjectFromTitle());

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

            if (viewNameChrome && text && viewNameChrome.includes(text)) continue;

            if (text && !/^\d+$/.test(text)) {
                addClientContextText(primaryChunks, text);
            }
        }

        const rawFallback = cleanText(document.body ? document.body.innerText : '');

        // split/join rather than a regex: view names contain "+" and friends.
        const fallback = viewNameChrome
            ? cleanText(rawFallback.split(viewNameChrome).join(' '))
            : rawFallback;

        return {
            primary: primaryChunks.join(' | '),
            fallback
        };
    }

    function getCMSKeyFromClientText(clientText) {
        const normalized = cleanText(clientText).toLowerCase();

        if (!normalized) return '';

        // A brand's own support address is unambiguous where the loose word tokens
        // below are not - "MSN" turns up in view names, signatures and quoted
        // threads. altitudeplus.com is what settles #352179: the ticket was
        // addressed to customersupport@altitudeplus.com while the surrounding page
        // text still said MSN. Checked before the token passes for that reason.
        const brandDomains = [
            [/monumentalsportsnetwork\.com/, 'msn'],
            // The address on real MSN tickets is monumentalsports.com - the
            // longer form above is what the CMS host is called, not the inbox.
            [/monumentalsports\.com/, 'msn'],
            [/altitudeplus\.com/, 'standard'],
            [/dirtvision\.com/, 'standard'],
            [/livgolfplus\.com/, 'gcp'],
            [/spacecityhn\.com/, 'gcp'],
            [/tampabaylightning\.com/, 'gcp'],
            // FOX One's mail arrives on fox.com (its cf_b2b_client_name is
            // "FOX One B2C"). Listed with the other domains because it is the
            // one unambiguous FOX signal - the bare word "fox" is not.
            [/\bfox\.com\b/, 'fox'],
            [/foxsports\.com/, 'fox']
        ];

        for (const [pattern, key] of brandDomains) {
            if (pattern.test(normalized)) return key;
        }

        if (/\bmsn\b|\bmonumental\s+sports\s+network\b/i.test(normalized)) {
            return 'msn';
        }

        if (/\bschn\b|\bspace\s+city\s+home\s+network\b|\bliv\b|\bliv\s*golf(?:\s*(?:\+|plus))?\b|\blivgolf(?:\+|plus)?\b|livgolfplus\.com|\blightning\b|\btampa\b|\btampa\s+bay\b|\btbl\b/i.test(normalized)) {
            return 'gcp';
        }

        if (/\baltitude\b|\bdirt\s*vision\b|\bdirtvision\b|\bvegas\s+golden\s+knights\b|\bvgk\b|\bknight\s*time\b/i.test(normalized)) {
            return 'standard';
        }

        // FOX is tested LAST on purpose. "FOX One" and "FOX Sports" are as
        // specific as any other brand token, but a bare "fox" is an ordinary
        // English word and a common surname, and the fallback context this
        // runs against is the whole ticket body. Testing it after every other
        // brand means a stray "fox" can only change the answer for a ticket
        // that matched nothing at all - which used to fall through to the
        // standard CMS, the one host a FOX customer is certainly not on.
        if (/\bfox\s*one\b|\bfoxone\b|\bfox\s*sports\b/i.test(normalized)) {
            return 'fox';
        }

        // ...and a bare "fox" only when the text names no other known brand at
        // all. MOTV is recognized here even though it has no host yet (see
        // UNROUTED_KNOWN_BRANDS below), so an MOTV ticket that happens to say
        // "fox" keeps falling through to the standard host and its warning
        // instead of being quietly handed to FOX's CMS.
        if (/\bfox\b/i.test(normalized) && !/\bmotv\b/i.test(normalized)) {
            return 'fox';
        }

        return '';
    }

    // Brands confirmed to exist (from the ViewLift Support Bot's own platform
    // list - see memory.md) but with no host mapping above, so they fall
    // through to the "standard" default like a genuinely unknown client.
    // Unlike that generic case, this one is worth calling out loud: the
    // search will likely run against the wrong CMS instance entirely for
    // these tickets, not just show a plausible-but-wrong result.
    // FOX One left this list on 2026-09-30: the user confirmed its CMS is
    // foxone.cms.viewlift.com, so it now routes above like every other brand.
    // Knight Time is Vegas Golden Knights on the standard host, also routed
    // above. MOTV is the last one with no confirmed host.
    const UNROUTED_KNOWN_BRANDS = [
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

    // cms.viewlift.com is not one brand. Altitude, DIRTVision and Vegas Golden
    // Knights all live on it, each as its own CMS "site" - the slug that goes
    // into the search API's auth.site/query.site body fields. The host is
    // therefore only half the routing decision, and the half that was missing
    // is what "the CMS button for DIRT opens the wrong CMS" is: the host was
    // right all along (live-confirmed on #352811, 2026-08-22), the tenant was
    // not. resolveCmsSite's old fallback - "whichever slug this host was last
    // seen using" - is a coin flip between three brands there, so a DIRT
    // ticket looked up while the session had last been on Altitude searched
    // ALTITUDE's tenant with Altitude's API key and opened whatever Altitude
    // account happened to share the email.
    //
    // The real slugs for these three have never been read off the CMS, so
    // nothing here guesses one. Each brand carries a PATTERN instead, matched
    // against the slugs the CMS itself has already reported through
    // bvRecordCmsCreds - the first time a real DIRTVision page is open in the
    // browser its true slug is learned and used, whatever it turns out to be
    // called.
    const MULTI_BRAND_CMS_SITES = [
        {
            label: 'DIRTVision',
            brand: /\bdirt\s*vision\b|\bdirtvision\b|dirtvision\.com/,
            slug: /dirt/,
            switchKey: 'dirtvision'
        },
        {
            label: 'Altitude',
            brand: /\baltitude\b|altitudeplus\.com/,
            slug: /altitude/,
            switchKey: 'altitude'
        },
        {
            label: 'Vegas Golden Knights',
            brand: /\bvgk\b|vegas\s+golden\s+knights|knight\s*time/,
            slug: /vgk|knight|golden/,
            switchKey: 'vegas-golden-knights'
        }
    ];

    function getMultiBrandSiteRule(clientContext) {
        const text = cleanText([
            clientContext && clientContext.primary,
            clientContext && clientContext.fallback
        ].filter(Boolean).join(' ') || clientContext).toLowerCase();

        if (!text) return null;

        return MULTI_BRAND_CMS_SITES.find(rule => rule.brand.test(text)) || null;
    }

    // The slugs the CMS has actually named for itself, not a list this script
    // made up - bvRecordCmsCreds only ever writes one it saw on a real page.
    function findCapturedSite(pattern) {
        try {
            return Object.keys(bvGetCmsCreds().sites || {}).find(site => pattern.test(site)) || '';
        } catch (error) {
            return '';
        }
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

    // The email regex's TLD part is case-insensitive, so when the scraped
    // page text runs an address straight into the next label with no
    // separator ("...@outlook.comContact Info") it swallows that label as
    // part of the TLD. Real domains are lowercase, so a lowercase->
    // uppercase transition inside the domain marks where the real address
    // actually ended.
    function trimGluedEmailSuffix(email) {
        const atIndex = String(email).indexOf('@');
        if (atIndex < 0) return email;

        const local = email.slice(0, atIndex);
        const domain = email.slice(atIndex + 1);
        const glued = domain.match(/^(.*?[a-z0-9])[A-Z]/);

        if (!glued) return email;

        const trimmedDomain = glued[1];
        // Only accept the trim if what's left is still a plausible domain.
        return /\.[a-z]{2,}$/i.test(trimmedDomain) ? `${local}@${trimmedDomain}` : email;
    }

    // Shared cleanup for every raw regex match: strip glued-on trailing
    // text, then drop any candidate that is just another candidate with
    // extra text glued onto the FRONT (a ticket number or name with no
    // whitespace before the real address).
    function normalizeEmailMatches(matches) {
        const cleaned = matches
            .map(match => trimGluedEmailSuffix(cleanText(match)))
            .filter(Boolean);

        return cleaned.filter(candidate =>
            !cleaned.some(other =>
                other !== candidate &&
                other.length < candidate.length &&
                candidate.toLowerCase().endsWith(other.toLowerCase())
            )
        );
    }

    function extractBestCustomerEmailFromText(text) {
        const matches = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];

        for (const email of normalizeEmailMatches(matches)) {
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

        // Feature 6 removes the native Reply button, so this lookup normally
        // finds nothing and the firstElementChild path is what actually runs.
        // Kept because it costs nothing and would anchor correctly again if
        // that removal is ever turned off.
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
                border: 1px solid #2c5cc5 !important;
                border-radius: 4px !important;
                background: #2c5cc5 !important;
                color: #ffffff !important;
                font-size: 13px !important;
                font-weight: 600 !important;
                cursor: pointer !important;
                display: inline-flex !important;
                align-items: center !important;
                gap: 4px !important;
                box-shadow: none !important;
                transition: background 120ms ease, border-color 120ms ease !important;
            }
            #${BUTTON_ID}:hover {
                background: #24499c !important;
                border-color: #24499c !important;
            }
            #${BUTTON_ID}:active {
                background: #1d3b7d !important;
                border-color: #1d3b7d !important;
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


    // The sibling-brand trap on a shared host (a link that is right while the
    // session sits on another brand) used to get only a warning here on
    // cms.viewlift.com. Since 3.80.0 buildCMSDestination switches there too.

    function warnAboutUnroutedBrand(clientContext) {
        const unroutedBrand = getUnroutedKnownBrandLabel(clientContext);
        if (unroutedBrand) {
            bvNotify(
                `CMS search: "${unroutedBrand}" has no CMS host configured yet - opening the standard CMS instead, which likely won't have this customer.`,
                { level: 'warn', ttl: 12000 }
            );
        }
    }

    // Builds the destination for a given ticket, either the plain search
    // page (no account id known) or the customer's own account page
    // (id known via the CMS API). Both go through the same GCP account
    // switch when one is needed, so a direct account link still lands on
    // the right organisation instead of an empty page.
    function buildCMSDestination(clientContext, { email, userId }) {
        const cmsUsersURL = getCMSUsersURLForClient(clientContext);
        const url = new URL(cmsUsersURL);
        // The organization the ticket needs on its host's v5 picker: the GCP
        // brands, or Altitude / DIRTVision / KnightTime on cms.viewlift.com
        // (which used to get only a warning, never a switch).
        const account = getCMSAccountForClient(clientContext) || getMultiBrandSiteRule(clientContext)?.switchKey || '';

        const finalPath = userId
            ? `${url.origin}/users/search/${encodeURIComponent(userId)}`
            : `${url.origin}/users/search?keyword=${encodeURIComponent(email)}&filter=all`;

        // The classic CMS has no account selector. Route through the v5
        // selector when the ticket identifies the account.
        if (account && bvCmsOrganizationsForHost(url.hostname).some(item => item.key === account)) {
            // A pending entry goes along either way: if "already on this
            // brand" below is stale (it is only the last brand seen here),
            // the CMS page finds the session elsewhere and switches itself.
            const pending = { key: account, returnUrl: finalPath, startedAt: Date.now() };
            const savePending = () => {
                try {
                    GM_setValue('betterCmsPendingAccountSwitch', JSON.stringify(pending));
                } catch (error) {
                    console.warn('[CMS Search] Could not save the pending account switch.', error);
                }
            };
            // ...but only when the session isn't already on that brand.
            // Measured 2026-08-13: opening an account id while the session
            // sits on a different org renders an empty shell (no account
            // data), so the switch is genuinely required when they differ -
            // yet going through /v5/overview when they ALREADY match is the
            // pure-waste second hop that reads as a "double lookup". The
            // captured credentials record which brand this host last really
            // used, so that check costs nothing.
            if (bvGetSiteForCmsHost(url.hostname) === account) {
                bvTimingMark('destination-direct', `${account} - session already on this brand`);
                savePending();
                return finalPath;
            }

            bvTimingMark(
                'destination-via-v5-switch',
                `wanted ${account}, stored slug for this host is "${bvGetSiteForCmsHost(url.hostname) || '(none)'}"`
            );

            url.pathname = '/v5/overview';
            url.searchParams.set('betterSwitch', account);
            pending.viaV5 = true;
            savePending();
            return url.href;
        }

        return finalPath;
    }

    // Resolves the CMS API "site" slug for a ticket. The explicit account
    // mapping already uses the real slugs (confirmed against CMS's own
    // tenant list: lightning / liv-golf / schn) but only covers the GCP host.
    //
    // For a brand that shares its host with other brands, the answer has to be
    // that brand's own slug or nothing: returning '' costs the
    // straight-into-the-account shortcut and nothing else (openCmsForEmail
    // falls back to the plain search page), which is far cheaper than
    // searching a sibling brand's tenant and believing the answer.
    //
    // The last-seen-slug fallback survives only where it cannot pick the wrong
    // brand - an unrecognized client on a host that serves a single one.
    function resolveCmsSite(clientContext) {
        const account = getCMSAccountForClient(clientContext);
        if (account) return account;

        const rule = getMultiBrandSiteRule(clientContext);
        if (rule) return findCapturedSite(rule.slug);

        try {
            return bvGetSiteForCmsHost(new URL(getCMSUsersURLForClient(clientContext)).hostname);
        } catch (error) {
            return '';
        }
    }

    function openCMSForEmail(email, clientContext, existingTab) {
        warnAboutUnroutedBrand(clientContext);

        const href = buildCMSDestination(clientContext, { email });
        bvTimingMark('navigate-search-page', existingTab ? 'reusing the holding tab' : 'new tab');
        console.log('[CMS Search] Opening CMS search for:', email, 'Client:', clientContext.primary || 'Unknown');

        if (existingTab) existingTab.location.href = href;
        else window.open(href, '_blank');
    }

    function openCMSAccount(userId, email, clientContext, existingTab) {
        warnAboutUnroutedBrand(clientContext);

        const href = buildCMSDestination(clientContext, { email, userId });
        bvTimingMark('navigate-account-page', existingTab ? 'reusing the holding tab' : 'new tab');
        console.log('[CMS Search] Opening CMS account directly for:', email, 'Client:', clientContext.primary || 'Unknown');

        if (existingTab) existingTab.location.href = href;
        else window.open(href, '_blank');
    }

    // How long to wait for the account lookup before giving up and just
    // opening the search page. Comfortably above a normal round trip, but
    // short enough that a slow API never leaves the agent watching a blank
    // tab wondering whether the click registered.
    const LOOKUP_DEADLINE_MS = 3500;

    // A blank white tab gives no signal that anything is happening, which is
    // exactly what "it sits on about:blank for ages" feels like even when
    // the wait is short. This paints something honest into the tab the
    // instant it opens, so the wait reads as progress rather than a hang.
    function showLookupPlaceholder(tab, email) {
        try {
            const safeEmail = String(email).replace(/[&<>"']/g, function (character) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
            });

            tab.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>Opening CMS…</title></head>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f7f9;font:14px -apple-system,Segoe UI,Arial,sans-serif;color:#12344d;">
  <div style="text-align:center;max-width:420px;padding:24px;">
    <div style="width:26px;height:26px;margin:0 auto 14px;border:3px solid #d5dbe1;border-top-color:#2c5cc5;border-radius:50%;animation:s .8s linear infinite;"></div>
    <div style="font-weight:600;margin-bottom:6px;">Looking up the CMS account…</div>
    <div style="color:#5a6c7d;font-size:13px;word-break:break-all;">${safeEmail}</div>
  </div>
  <style>@keyframes s{to{transform:rotate(360deg)}}</style>
</body></html>`);
            tab.document.close();
        } catch (error) {
            // A placeholder is a nicety - never let it stop the real journey.
        }
    }

    /* ------------------------------------------------------------
     * Prefetch
     *
     * The lookup used to start on click, so every single use paid the
     * full round trip while staring at a new tab. The answer almost never
     * changes between opening a ticket and pressing the button, so it is
     * fetched ahead of time instead: once shortly after the button
     * appears, and again the moment the pointer touches it. A hit makes
     * the click instant - the destination is known before it happens, so
     * no holding tab is needed at all.
     * ------------------------------------------------------------ */
    const PREFETCH_TTL_MS = 3 * 60 * 1000;
    let prefetchEntry = null;
    let prefetchInFlight = '';

    function prefetchKeyFor(email, site) {
        const ticketMatch = location.pathname.match(/\/a\/tickets\/(\d+)/i);
        return `${ticketMatch ? ticketMatch[1] : ''}|${String(email).toLowerCase()}|${site}`;
    }

    function readPrefetch(email, site) {
        if (!prefetchEntry) return null;
        if (prefetchEntry.key !== prefetchKeyFor(email, site)) return null;
        if (Date.now() - prefetchEntry.at > PREFETCH_TTL_MS) return null;
        return prefetchEntry;
    }

    function prefetchAccountLookup(email, clientContext) {
        if (!email) return;

        const site = resolveCmsSite(clientContext);
        if (!site || !bvGetCmsCredForSite(site)) return;

        const key = prefetchKeyFor(email, site);
        if (prefetchInFlight === key || readPrefetch(email, site)) return;

        prefetchInFlight = key;
        bvCmsUserSearch({
            site,
            searchTerm: email,
            onDone: function (error, result) {
                prefetchInFlight = '';
                // A failed prefetch is deliberately not cached - the click
                // should get a real attempt rather than inherit a stale error.
                if (error) return;
                prefetchEntry = { key, users: (result && result.users) || [], at: Date.now() };
            }
        });
    }

    // One email in, one lookup, straight into the account. Exposed on
    // window so the in-ticket email chips (Feature 5) can reuse the exact
    // same path for the alternate addresses a customer mentions - the CMS
    // button owns the ticket's official Contact Info email, the chips own
    // everything else, and neither has to guess which one is "right".
    function openCmsForEmail(email, clientContext) {
        const site = resolveCmsSite(clientContext);
        const cred = site ? bvGetCmsCredForSite(site) : null;

        bvTimingStart(email, site);
        bvTimingMark('click', cred ? 'credentials ready' : 'no usable credentials');

        // No usable credentials - fall back to the plain search page.
        if (!cred) {
            openCMSForEmail(email, clientContext);
            bvTimingReport('freshdesk-side-done');
            return;
        }

        // Already know the answer: skip the holding tab entirely and open
        // the real destination straight from the click.
        const prefetched = readPrefetch(email, site);
        if (prefetched) {
            bvTimingMark('prefetch-hit', `${prefetched.users.length} user(s) - no holding tab needed`);
            const users = prefetched.users;
            if (users.length === 1 && users[0] && users[0].id) {
                openCMSAccount(users[0].id, email, clientContext);
                return;
            }
            if (users.length > 1) {
                bvNotify(`CMS: ${users.length} accounts match "${email}" - opening the list to pick.`, { level: 'info', ttl: 9000 });
            } else {
                bvNotify(`CMS: no account found for ${email}.`, { level: 'warn', ttl: 9000 });
            }
            openCMSForEmail(email, clientContext);
            return;
        }

        bvTimingMark('prefetch-miss', 'holding tab + live lookup');

        // The tab has to be opened synchronously inside the click handler or
        // the popup blocker kills it - the async lookup below just points
        // this already-granted tab at the right destination once it knows.
        const tab = window.open('about:blank', '_blank');
        if (!tab) {
            bvNotify('CMS: the browser blocked the new tab. Allow pop-ups for Freshdesk and try again.', { level: 'warn', ttl: 9000 });
            return;
        }

        showLookupPlaceholder(tab, email);
        bvTimingMark('holding-tab-painted');

        // Whichever of the lookup and the deadline lands first wins; the
        // other becomes a no-op. Without this the tab could be navigated
        // twice (deadline fires, then a slow lookup answers), which reloads
        // the page under the agent.
        //
        // "deadline" is declared with let BEFORE settle deliberately: if the
        // lookup ever calls back synchronously, settle would otherwise touch
        // a const still in its temporal dead zone and throw.
        let deadline = 0;
        let settled = false;
        const settle = function (run) {
            if (settled) return;
            settled = true;
            window.clearTimeout(deadline);
            run();
        };

        // Never leave the agent staring at a placeholder: if the lookup is
        // slow, the plain search page is still a useful destination and one
        // they can work with immediately.
        deadline = window.setTimeout(function () {
            settle(function () {
                bvTimingMark('deadline-fired', `lookup did not answer within ${LOOKUP_DEADLINE_MS}ms`);
                console.warn('[CMS Search] Lookup exceeded the deadline - opening the search page instead.');
                openCMSForEmail(email, clientContext, tab);
            });
        }, LOOKUP_DEADLINE_MS);

        bvTimingMark('lookup-start');
        bvCmsUserSearch({
            site,
            searchTerm: email,
            onDone: function (error, result) {
                bvTimingMark(
                    'lookup-done',
                    error
                        ? `error: ${error.message}`
                        : `${((result && result.users) || []).length} user(s)`
                );
                if (error) {
                    settle(function () {
                        console.warn('[CMS Search] API lookup failed, falling back to the search page.', error.message);
                        if (error.message === 'cms-unauthorized') {
                            bvNotify('CMS session expired - open any CMS page once, then this will jump straight to accounts again.', { level: 'info', ttl: 9000 });
                        }
                        openCMSForEmail(email, clientContext, tab);
                    });
                    return;
                }

                const users = (result && result.users) || [];

                // Single unambiguous hit is the whole point: go straight in.
                if (users.length === 1 && users[0] && users[0].id) {
                    settle(function () {
                        openCMSAccount(users[0].id, email, clientContext, tab);
                    });
                    return;
                }

                // Anything else is a judgement call - hand over the list.
                settle(function () {
                    if (users.length > 1) {
                        bvNotify(`CMS: ${users.length} accounts match "${email}" - opening the list to pick.`, { level: 'info', ttl: 9000 });
                    } else {
                        bvNotify(`CMS: no account found for ${email}.`, { level: 'warn', ttl: 9000 });
                    }
                    openCMSForEmail(email, clientContext, tab);
                });
            }
        });
    }

    window.__bvOpenCmsForEmail = openCmsForEmail;

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

        // Warm the lookup before it is needed: on pointer approach, and once
        // shortly after the button appears. Both are cheap no-ops when the
        // answer is already cached or no credentials exist yet.
        // Throttled because resolving the customer email walks a lot of DOM;
        // the network side is already de-duplicated, this keeps the scan
        // from repeating on every pointer twitch.
        let lastWarmAt = 0;
        const warmUp = function () {
            // Don't spend a lookup on a ticket nobody is looking at - opening
            // a batch of tickets in background tabs shouldn't each fire one.
            if (document.visibilityState !== 'visible') return;
            if (Date.now() - lastWarmAt < 5000) return;
            lastWarmAt = Date.now();
            try {
                prefetchAccountLookup(getCustomerEmailFromContactInfo(), getFreshdeskClientContext());
            } catch (error) {
                console.warn('[CMS Search] Prefetch skipped.', error);
            }
        };
        button.addEventListener('mouseenter', warmUp);
        // Delayed rather than immediate so simply skimming past a ticket
        // doesn't fire a lookup for it - by 3.5s the agent has settled on
        // this ticket rather than passing through it.
        window.setTimeout(warmUp, 3500);

        button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();

            const email = getCustomerEmailFromContactInfo();

            if (!email) {
                alert('No pude encontrar el email del cliente. Abre Contact info o copia el email visible en el ticket y vuelve a intentar.');
                return;
            }

            // Only ever the ticket's own Contact Info email. Alternate
            // addresses mentioned in the conversation are handled by their
            // own chips, so this stays a single predictable action.
            openCmsForEmail(email, getFreshdeskClientContext());
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

        element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: bvEventView }));
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: bvEventView }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: bvEventView }));
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: bvEventView }));

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

    // The legacy fill-the-box-and-click-Search flow below is no longer
    // reachable: nothing has produced its "openCmsEmail" parameter since the
    // CMS button switched to CMS's own keyword/filter URL, and the account
    // lookup replaced it entirely. Leaving it *running* was not harmless
    // though - on every CMS page it polled for up to 10s (scanning every
    // input on the page each tick), and if a stale pending email were still
    // sitting in storage from an old version it would happily type that into
    // the search box. So the entry point is disabled and the leftovers are
    // cleared once.
    //
    // The functions themselves are left in place deliberately: removing ~150
    // lines of interconnected code is a change that deserves to be made when
    // someone can click through CMS afterwards, not silently.
    if (isCMSPage()) {
        try {
            sessionStorage.removeItem(CMS_PENDING_EMAIL_KEY);
        } catch (error) { /* storage unavailable */ }
        try {
            GM_deleteValue(CMS_PENDING_EMAIL_KEY);
        } catch (error) { /* storage unavailable */ }
    }

    window.__betterFreshdeskGetCustomerEmail = getCustomerEmailFromContactInfo;
    // Needed by the in-ticket email chips so their CMS lookup routes to the
    // same brand/host the CMS button would have used.
    window.__bvGetFreshdeskClientContext = getFreshdeskClientContext;

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

/* ============================================================
 * Feature 11: deliver a queued case into a Case helper chat
 *
 * The Freshdesk side (Feature 10) collects the case, queues it and opens the
 * chosen chat in a tab. This is the other end: it takes the case meant for
 * THIS chat, writes it into the composer and sends it.
 *
 * Why a tab and not Claude in Chrome's side panel: the panel is a separate
 * chrome-extension:// document. A userscript cannot open it (only the
 * extension itself can), and cannot read or type into it even while it is
 * open - the origin boundary does not care that it is visible. Verified
 * 2026-08-21 before building this.
 * ============================================================ */

if (location.hostname === 'claude.ai' || location.hostname === 'www.claude.ai') {

(function () {
  'use strict';

  // Both read live off claude.ai on 2026-08-21. data-testid rather than the
  // Tailwind classes next to them, which are generated and change constantly.
  const EDITOR_SELECTOR = 'div[contenteditable="true"][data-testid="chat-input"]';
  const SEND_SELECTOR = 'button[data-testid="chat-input-send"]';
  const EDITOR_WAIT_MS = 20000;
  const SEND_WAIT_MS = 15000;
  const SETTLE_MS = 400;

  function readQueue() {
    try {
      let value = GM_getValue(BV_CASE_TO_CLAUDE_KEY, null);
      if (typeof value === 'string') value = JSON.parse(value);
      if (!value) return [];
      return Array.isArray(value) ? value : [value];
    } catch (error) {
      console.warn('[Case helper] Could not read the queued case.', error);
      return [];
    }
  }

  function writeQueue(queue) {
    try {
      if (queue.length) GM_setValue(BV_CASE_TO_CLAUDE_KEY, queue);
      else GM_deleteValue(BV_CASE_TO_CLAUDE_KEY);
    } catch (error) {
      console.warn('[Case helper] Could not update the case queue.', error);
    }
  }

  function pathOf(url) {
    try {
      return new URL(url).pathname;
    } catch (error) {
      return '';
    }
  }

  // TAKEN, not peeked: the entry is removed before anything is pasted, so a
  // case can be missed but never posted twice. A miss is recoverable - the
  // Freshdesk side always leaves the same text on the clipboard, so Ctrl+V
  // finishes the job. A duplicate post into a chat is not recoverable.
  function takeCaseForThisPage() {
    const queue = readQueue();
    const now = Date.now();
    const fresh = entry => entry && now - Number(entry.createdAt || 0) < BV_CASE_TO_CLAUDE_TTL_MS;

    const index = queue.findIndex(entry =>
      fresh(entry) && entry.report && pathOf(entry.targetUrl) === location.pathname
    );

    if (index === -1) {
      // Still worth dropping anything stale, so a case queued for a tab that
      // was never opened cannot surface hours later in an unrelated chat.
      const kept = queue.filter(fresh);
      if (kept.length !== queue.length) writeQueue(kept);
      return null;
    }

    const entry = queue[index];
    queue.splice(index, 1);
    writeQueue(queue.filter(fresh));
    return entry;
  }

  function waitFor(test, timeoutMs) {
    return new Promise(resolve => {
      const started = Date.now();

      const tick = () => {
        let found = null;
        try {
          found = test();
        } catch (error) {
          found = null;
        }

        if (found) { resolve(found); return; }
        if (Date.now() - started > timeoutMs) { resolve(null); return; }
        window.setTimeout(tick, 200);
      };

      tick();
    });
  }

  function editorText(editor) {
    return String(editor.innerText || '').replace(/\u00a0/g, ' ').trim();
  }

  function settle() {
    return new Promise(resolve => window.setTimeout(resolve, SETTLE_MS));
  }

  async function deliver() {
    const entry = takeCaseForThisPage();
    if (!entry) return;

    const editor = await waitFor(() => document.querySelector(EDITOR_SELECTOR), EDITOR_WAIT_MS);
    if (!editor) {
      console.warn(
        '[Case helper] The chat composer never appeared. The case is still on the clipboard - Ctrl+V.'
      );
      return;
    }

    // A draft already in the box is the agent's own writing, not ours.
    const draft = editorText(editor);

    editor.focus();
    try {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', entry.report);
      editor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer
      }));
    } catch (error) {
      console.warn('[Case helper] The paste event failed - falling back to insertText.', error);
    }

    await settle();

    if (editorText(editor) === draft) {
      // ProseMirror ignored the synthetic paste - one more way in.
      try {
        editor.focus();
        document.execCommand('insertText', false, entry.report);
      } catch (error) {
        console.warn('[Case helper] insertText failed too.', error);
      }
      await settle();
    }

    if (editorText(editor) === draft) {
      console.error(
        '[Case helper] Nothing landed in the composer - claude.ai may have renamed it. ' +
        'The case is on the clipboard, paste it with Ctrl+V.'
      );
      return;
    }

    if (draft) {
      console.warn(
        '[Case helper] There was already a draft in this chat, so the case was appended but NOT ' +
        'sent - review it and press Enter yourself.'
      );
      return;
    }

    // Waiting for the button to be ENABLED covers both a composer that has
    // not registered the text yet and a chat that is still streaming an
    // earlier answer.
    const send = await waitFor(() => {
      const button = document.querySelector(SEND_SELECTOR);
      return button && !button.disabled ? button : null;
    }, SEND_WAIT_MS);

    if (!send) {
      console.warn(
        '[Case helper] The send button never became clickable. The case is written in the ' +
        'composer - press Enter yourself.'
      );
      return;
    }

    send.click();
    console.info('[Case helper] Case #' + entry.ticketId + ' sent to the Case helper chat.');
  }

  // The route bus, because a tab opened at /chat/<id> gets there only after
  // the SPA settles - the first pass usually runs before the path is right.
  onRouteChange(() => { deliver(); });

  // And a direct nudge, for a chat tab that is already open when the button
  // is clicked on the Freshdesk side.
  try {
    if (typeof GM_addValueChangeListener === 'function') {
      GM_addValueChangeListener(BV_CASE_TO_CLAUDE_KEY, function (_name, _oldValue, _newValue, remote) {
        if (remote) deliver();
      });
    }
  } catch (error) {
    console.warn('[Case helper] Could not subscribe to queued cases.', error);
  }
})();

}

})();
