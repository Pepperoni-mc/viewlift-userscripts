// Checks the claude.ai end of the Case helper bridge: taking the queued case
// meant for THIS chat, writing it into the composer, and sending it.
//
// The rules that matter here (2026-08-21):
//   - AT MOST ONCE. The queue entry is removed before anything is pasted, so a
//     case can be missed but never posted twice into a chat. A miss is
//     recoverable (the Freshdesk side always leaves the same text on the
//     clipboard); a duplicate message in someone's chat is not.
//   - The case only lands in the chat it was queued FOR. Two chats, one script:
//     matching on the target pathname is what keeps Esteban's case out of
//     Sebastian's chat.
//   - A draft already in the composer is the agent's own writing: append, but
//     never auto-send on top of it.
//   - Never click send blind. The button has to exist AND be enabled, which is
//     also how claude.ai says "still streaming the previous answer".
//
// Run with: node tests/case-to-claude.test.js
const fs = require('fs');
const path = require('path');

const fullSrc = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'better-viewlift.user.js'),
  'utf8'
);

const featureStart = fullSrc.indexOf('Feature 11: deliver a queued case into a Case helper chat');
if (featureStart === -1) throw new Error('could not find the Feature 11 section');
const src = fullSrc.slice(featureStart);

function extractFunction(pattern, name) {
  const idx = src.search(pattern);
  if (idx === -1) throw new Error('could not find ' + name);

  let i = src.indexOf('(', idx);
  let parenDepth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') parenDepth++;
    else if (src[i] === ')') { parenDepth--; if (parenDepth === 0) { i++; break; } }
  }

  let depth = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(idx, j + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}

function extractConst(source, pattern, name) {
  const m = source.match(pattern);
  if (!m) throw new Error('could not find ' + name);
  return m[0];
}

const sandbox = `
  ${extractConst(fullSrc, /const BV_CASE_TO_CLAUDE_TTL_MS = [^\n]+/, 'BV_CASE_TO_CLAUDE_TTL_MS')}
  ${extractConst(fullSrc, /const BV_CASE_TO_CLAUDE_KEY = [^\n]+/, 'BV_CASE_TO_CLAUDE_KEY')}
  ${extractConst(src, /const EDITOR_SELECTOR = [^\n]+/, 'EDITOR_SELECTOR')}
  ${extractConst(src, /const SEND_SELECTOR = [^\n]+/, 'SEND_SELECTOR')}
  const EDITOR_WAIT_MS = 80;
  const SEND_WAIT_MS = 80;
  const SETTLE_MS = 5;
  ${extractFunction(/function readQueue/, 'readQueue')}
  ${extractFunction(/function writeQueue/, 'writeQueue')}
  ${extractFunction(/function pathOf/, 'pathOf')}
  ${extractFunction(/function takeCaseForThisPage/, 'takeCaseForThisPage')}
  ${extractFunction(/function waitFor/, 'waitFor')}
  ${extractFunction(/function editorText/, 'editorText')}
  ${extractFunction(/function settle/, 'settle')}
  ${extractFunction(/async function deliver/, 'deliver')}
  module.exports = {
    readQueue, takeCaseForThisPage, pathOf, editorText, deliver,
    KEY: BV_CASE_TO_CLAUDE_KEY, TTL: BV_CASE_TO_CLAUDE_TTL_MS,
    EDITOR_SELECTOR, SEND_SELECTOR
  };
`;

// ---------------------------------------------------------------------------
// A composer that behaves like the real one in the ways this code depends on:
// it grows when a paste event arrives, and the send button is disabled while it
// is empty (that is exactly how claude.ai gates sending).
// ---------------------------------------------------------------------------
function makeChat(options) {
  const settings = options || {};
  const sendClicks = [];

  const editor = {
    innerText: settings.draft || '',
    focused: false,
    focus() { this.focused = true; },
    dispatchEvent(event) {
      if (event.type !== 'paste') return true;
      if (settings.ignorePaste) return true;
      this.innerText += (this.innerText ? '\n' : '') + event.clipboardData.getData('text/plain');
      return true;
    }
  };

  const send = {
    get disabled() { return settings.sendStuck ? true : editor.innerText.trim().length === 0; },
    click() { sendClicks.push(editor.innerText); }
  };

  const doc = {
    querySelector(selector) {
      if (settings.noEditor && /chat-input"\]$/.test(selector)) return null;
      if (/data-testid="chat-input"/.test(selector)) return editor;
      if (/chat-input-send/.test(selector)) return settings.noSendButton ? null : send;
      return null;
    },
    execCommand(command, _ui, value) {
      if (command !== 'insertText' || settings.ignoreInsertText) return false;
      editor.innerText += (editor.innerText ? '\n' : '') + value;
      return true;
    }
  };

  return { editor, send, doc, sendClicks };
}

function load(options) {
  const settings = options || {};
  const store = settings.store || new Map();
  const mod = { exports: {} };
  const chat = settings.chat || makeChat({});
  const logs = [];

  const fakeConsole = {
    warn: (...args) => logs.push('warn: ' + args[0]),
    error: (...args) => logs.push('error: ' + args[0]),
    info: (...args) => logs.push('info: ' + args[0])
  };

  // The real waits are 15-20s of polling; capped here so the suite stays fast.
  const fastWindow = {
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 5))
  };

  class FakeDataTransfer {
    constructor() { this.data = {}; }
    setData(type, value) { this.data[type] = value; }
    getData(type) { return this.data[type] || ''; }
  }

  class FakeClipboardEvent {
    constructor(type, init) {
      this.type = type;
      this.clipboardData = (init || {}).clipboardData;
    }
  }

  const args = [
    'module', 'location', 'document', 'window', 'console',
    'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'DataTransfer', 'ClipboardEvent'
  ];

  new Function(...args, sandbox)(
    mod,
    { pathname: settings.pathname || '/chat/target-chat' },
    chat.doc,
    fastWindow,
    fakeConsole,
    (key, fallback) => (store.has(key) ? store.get(key) : fallback),
    (key, value) => store.set(key, value),
    key => store.delete(key),
    FakeDataTransfer,
    FakeClipboardEvent
  );

  return { api: mod.exports, store, chat, logs };
}

const shippedWait = name => Number((src.match(new RegExp('const ' + name + ' = (\\d+)')) || [])[1]);

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label);
  if (!ok) console.log('      expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const KEY = 'betterFreshdeskCaseToClaude';
const REPORT = 'TICKET #352003 — Space city\n--- 1 · CUSTOMER · someone ---\nhello';

function entry(overrides) {
  return Object.assign({
    ticketId: '352003',
    report: REPORT,
    targetUrl: 'https://claude.ai/chat/target-chat',
    session: 'esteban',
    createdAt: Date.now()
  }, overrides || {});
}

async function run() {
  // -------------------------------------------------------------------------
  // The real waits, which the sandbox above deliberately shortens.
  // -------------------------------------------------------------------------
  check('the composer gets time for a cold SPA load', shippedWait('EDITOR_WAIT_MS') >= 10000, true);
  check('the send button gets time for a streaming answer', shippedWait('SEND_WAIT_MS') >= 5000, true);
  check('and the paste gets time to register', shippedWait('SETTLE_MS') >= 200, true);

  // -------------------------------------------------------------------------
  // Taking the right case, once.
  // -------------------------------------------------------------------------
  {
    const store = new Map([[KEY, [entry()]]]);
    const { api } = load({ store });

    const taken = api.takeCaseForThisPage();
    check('the case queued for this chat is taken', taken && taken.ticketId, '352003');
    check('and it is gone from the queue immediately', store.has(KEY), false);
    check('so a second pass finds nothing to post again', api.takeCaseForThisPage(), null);
  }

  {
    // The whole point of storing the target: two chats, one script.
    const store = new Map([[KEY, [entry({ targetUrl: 'https://claude.ai/chat/the-other-one', session: 'sebastian' })]]]);
    const { api } = load({ store });

    check('a case for another chat is left alone', api.takeCaseForThisPage(), null);
    check('and stays in the queue for its own tab', store.get(KEY).length, 1);
  }

  {
    const store = new Map([[KEY, [
      entry({ targetUrl: 'https://claude.ai/chat/the-other-one' }),
      entry({ ticketId: '999' })
    ]]]);
    const { api } = load({ store });

    const taken = api.takeCaseForThisPage();
    check('with two queued, the right one is picked', taken && taken.ticketId, '999');
    check("and the other chat's case survives", store.get(KEY).length, 1);
    check('specifically the one for the other chat', store.get(KEY)[0].targetUrl, 'https://claude.ai/chat/the-other-one');
  }

  {
    // A case queued for a tab that was never opened must not resurface later.
    const store = new Map([[KEY, [entry({ createdAt: Date.now() - 10 * 60 * 1000 })]]]);
    const { api } = load({ store });

    check('a stale case is not delivered', api.takeCaseForThisPage(), null);
    check('and is purged rather than left to rot', store.has(KEY), false);
  }

  {
    const store = new Map([[KEY, [entry({ report: '' })]]]);
    const { api } = load({ store });
    check('an entry with no text is not delivered', api.takeCaseForThisPage(), null);
  }

  {
    const store = new Map([[KEY, 'not json at all']]);
    const { api } = load({ store });
    check('a corrupt queue reads as empty rather than throwing', api.readQueue().length, 0);
    check('and delivers nothing', api.takeCaseForThisPage(), null);
  }

  {
    // GM storage hands back a single object in some older shapes.
    const store = new Map([[KEY, entry()]]);
    const { api } = load({ store });
    check('a single stored object is read as a one-item queue', api.readQueue().length, 1);
    check('and is delivered', Boolean(api.takeCaseForThisPage()), true);
  }

  {
    const { api } = load({});
    check('a target URL yields its path', api.pathOf('https://claude.ai/chat/abc'), '/chat/abc');
    check('a broken target URL yields empty, not a throw', api.pathOf('not a url'), '');
  }

  // -------------------------------------------------------------------------
  // Delivering into the composer.
  // -------------------------------------------------------------------------
  {
    const store = new Map([[KEY, [entry()]]]);
    const { api, chat, logs } = load({ store });

    await api.deliver();

    check('the case is written into the composer', chat.editor.innerText, REPORT);
    check('the composer was focused first', chat.editor.focused, true);
    check('and it was sent', chat.sendClicks.length, 1);
    check('what was sent is what was written', chat.sendClicks[0], REPORT);
    check('the send is reported', logs.some(line => /info: .*352003 sent/.test(line)), true);
    check('the queue is empty afterwards', store.has(KEY), false);
  }

  {
    // ProseMirror ignoring a synthetic paste is a real possibility, so there is
    // a second way in.
    const store = new Map([[KEY, [entry()]]]);
    const { api, chat } = load({ store, chat: makeChat({ ignorePaste: true }) });

    await api.deliver();
    check('insertText covers a paste the editor ignored', chat.editor.innerText, REPORT);
    check('and it still gets sent', chat.sendClicks.length, 1);
  }

  {
    // Both ways in failing means claude.ai changed - say so, send nothing.
    const store = new Map([[KEY, [entry()]]]);
    const { api, chat, logs } = load({
      store,
      chat: makeChat({ ignorePaste: true, ignoreInsertText: true })
    });

    await api.deliver();
    check('nothing is sent when nothing could be written', chat.sendClicks.length, 0);
    check('and it says the clipboard still has it', logs.some(line => /error: .*Ctrl\+V/.test(line)), true);
  }

  {
    // Someone was halfway through writing something.
    const store = new Map([[KEY, [entry()]]]);
    const { api, chat, logs } = load({ store, chat: makeChat({ draft: 'my own half-written note' }) });

    await api.deliver();
    check('the draft is kept', chat.editor.innerText.indexOf('my own half-written note'), 0);
    check('the case is appended after it', chat.editor.innerText.indexOf(REPORT) > 0, true);
    check('but nothing is sent on top of a draft', chat.sendClicks.length, 0);
    check('and the reason is logged', logs.some(line => /warn: .*draft/.test(line)), true);
  }

  {
    // A composer that never shows up (wrong page, or renamed selector).
    const store = new Map([[KEY, [entry()]]]);
    const { api, chat, logs } = load({ store, chat: makeChat({ noEditor: true }) });

    await api.deliver();
    check('no composer means nothing sent', chat.sendClicks.length, 0);
    check('and a warning that points at the clipboard', logs.some(line => /warn: .*composer never appeared/.test(line)), true);
  }

  {
    // The send button stuck disabled is how claude.ai says "still answering".
    const store = new Map([[KEY, [entry()]]]);
    const { api, chat, logs } = load({ store, chat: makeChat({ sendStuck: true }) });

    await api.deliver();
    check('the case is still written', chat.editor.innerText, REPORT);
    check('but send is never forced', chat.sendClicks.length, 0);
    check('and it tells you to press Enter', logs.some(line => /warn: .*press Enter/.test(line)), true);
  }

  {
    const store = new Map();
    const { api, chat } = load({ store });
    await api.deliver();
    check('an empty queue is a no-op, not an error', chat.sendClicks.length, 0);
    check('and nothing is typed into the chat', chat.editor.innerText, '');
  }

  {
    // Landing on the wrong chat must not paste anything at all.
    const store = new Map([[KEY, [entry({ targetUrl: 'https://claude.ai/chat/somewhere-else' })]]]);
    const { api, chat } = load({ store });

    await api.deliver();
    check('nothing is written into a chat the case was not for', chat.editor.innerText, '');
    check('and nothing is sent', chat.sendClicks.length, 0);
  }

  console.log(
    failures
      ? '\n' + failures + ' check(s) FAILED'
      : '\nAll checks passed against the shipped source.'
  );
  process.exit(failures ? 1 : 0);
}

run();
