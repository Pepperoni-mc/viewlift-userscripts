// Checks the "copy the whole case" button's collector: how the Freshdesk API
// payload becomes the text that lands on the clipboard.
//
// The behaviours worth locking down (2026-08-21):
//   - EVERY message is in the copy. The whole reason this feature exists is
//     the "+56 conversations" block Freshdesk collapses, so the paging loop
//     and the numbering are the point, not a detail.
//   - The ticket's description is message 1. It is NOT part of
//     /tickets/<id>/conversations, so it has to be prepended by hand - drop
//     that and every copied case silently loses the customer's first message.
//   - status choices arrive as {id: [label, ...]} and priority as {label: id}
//     from the SAME endpoint. Both have to resolve to a label.
//   - private/incoming decide who is speaking, not `source`.
//   - The DOM fallback must not copy Better Viewlift's own injected chips back
//     into the case text.
//
// Pulls the real functions out of the shipped userscript. The extraction is
// scoped to Feature 10's own section: several features declare their own
// cleanText/isVisible, and an unscoped search picks up an earlier copy.
//
// Run with: node tests/copy-case.test.js
const fs = require('fs');
const path = require('path');

const fullSrc = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'better-viewlift.user.js'),
  'utf8'
);

const featureStart = fullSrc.indexOf('Feature 10: Copy the whole case to the clipboard');
if (featureStart === -1) throw new Error('could not find the Feature 10 section');
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

function extractConst(pattern, name) {
  const m = src.match(pattern);
  if (!m) throw new Error('could not find ' + name);
  return m[0];
}

const sandbox = `
  ${extractConst(/const PER_PAGE = \d+;/, 'PER_PAGE')}
  ${extractConst(/const MAX_PAGES = \d+;/, 'MAX_PAGES')}
  ${extractConst(/const SOURCE_LABELS = \{[\s\S]*?\};/, 'SOURCE_LABELS')}
  ${extractConst(/const BLOCK_TAGS = [^\n]+/, 'BLOCK_TAGS')}
  ${extractConst(/const OUR_UI_ID = [^\n]+/, 'OUR_UI_ID')}
  ${extractConst(/const OUR_UI_CLASS = [^\n]+/, 'OUR_UI_CLASS')}
  ${extractFunction(/function cleanText/, 'cleanText')}
  ${extractFunction(/function formatWhen/, 'formatWhen')}
  ${extractFunction(/function normalizeBody/, 'normalizeBody')}
  ${extractFunction(/function choicesToIdLabelMap/, 'choicesToIdLabelMap')}
  ${extractFunction(/function buildFieldLabels/, 'buildFieldLabels')}
  ${extractFunction(/function authorFor/, 'authorFor')}
  ${extractFunction(/function kindFor/, 'kindFor')}
  ${extractFunction(/function attachmentLines/, 'attachmentLines')}
  ${extractFunction(/function buildMessageBlock/, 'buildMessageBlock')}
  ${extractFunction(/function buildReport/, 'buildReport')}
  ${extractFunction(/async function pagedList/, 'pagedList')}
  ${extractFunction(/function readTextSkippingOurUi/, 'readTextSkippingOurUi')}
  ${extractFunction(/async function collectViaApi/, 'collectViaApi')}
  module.exports = {
    formatWhen, choicesToIdLabelMap, buildFieldLabels, authorFor, kindFor,
    attachmentLines, buildReport, pagedList, readTextSkippingOurUi, collectViaApi,
    PER_PAGE, MAX_PAGES
  };
`;

// htmlToText is the one extracted-function dependency that needs a real DOM
// (innerHTML parsing), so the stub only has to cover the body_text path -
// every payload below sets body_text, which is what the live API returns.
function load(options) {
  const settings = options || {};
  const mod = { exports: {} };

  const args = [
    'module', 'location', 'GM_info', 'htmlToText', 'api',
    'getFieldLabels', 'getAgentNames', 'getGroupName'
  ];

  new Function(...args, sandbox)(
    mod,
    { origin: 'https://viewlift.freshdesk.com' },
    { script: { version: '9.9.9' } },
    html => (html ? '(html body)' : ''),
    settings.api || (() => { throw new Error('api() should not be called here'); }),
    settings.getFieldLabels || (async () => ({ status: {}, priority: {}, custom: {} })),
    settings.getAgentNames || (async () => ({})),
    settings.getGroupName || (async () => 'A Group')
  );

  return mod.exports;
}

const LOCAL = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false
});
// formatWhen renders LOCAL time on purpose, so an expected string cannot
// hardcode UTC or this file only passes in one timezone. sv-SE happens to
// format as "YYYY-MM-DD HH:mm" - an independent way to spell the same thing
// rather than a copy of the function under test.
const localWhen = iso => LOCAL.format(new Date(iso)).replace(',', '');

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label);
  if (!ok) console.log('      expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

// ---------------------------------------------------------------------------
// Label resolution. Both shapes come off /api/v2/ticket_fields, read live.
// ---------------------------------------------------------------------------
{
  const api = load();

  const status = api.choicesToIdLabelMap({
    2: ['Open', 'Being Processed'],
    8: ['Waiting on Development', 'Waiting on Development']
  });
  check('a status id resolves to its agent-facing label', status['8'], 'Waiting on Development');
  check('the customer-facing second label is ignored', status['2'], 'Open');

  const priority = api.choicesToIdLabelMap({ Low: 1, Medium: 2, High: 3, Urgent: 4 });
  check('priority is inverted into id -> label', priority['3'], 'High');
  check('and the whole scale survives it', priority['1'] + '/' + priority['4'], 'Low/Urgent');

  check('no choices is an empty map, not a crash', Object.keys(api.choicesToIdLabelMap(null)).length, 0);

  const labels = api.buildFieldLabels([
    { name: 'status', choices: { 4: ['Resolved', 'Resolved'] } },
    { name: 'priority', choices: { Low: 1 } },
    { name: 'cf_product', label: 'Brand' },
    { name: 'cf_platform', label: 'Platform' },
    { name: 'subject', label: 'Subject' }
  ]);
  check('a custom field keeps its human label', labels.custom.cf_product, 'Brand');
  check('a non-custom field is not treated as one', labels.custom.subject, undefined);
  check('status came through', labels.status['4'], 'Resolved');
  check('priority came through', labels.priority['1'], 'Low');
}

// ---------------------------------------------------------------------------
// Who is speaking, and when.
// ---------------------------------------------------------------------------
{
  const api = load();

  check('a private note is labelled as one', api.kindFor({ private: true, incoming: false }), 'PRIVATE NOTE');
  check('a private note wins even when incoming', api.kindFor({ private: true, incoming: true }), 'PRIVATE NOTE');
  check('an incoming message is the customer', api.kindFor({ incoming: true }), 'CUSTOMER');
  check('anything else is an agent reply', api.kindFor({}), 'AGENT REPLY');

  const context = { agentNames: { '43273665087': 'Sebastian Rojas Grant' }, requester: { id: 43276327116, name: 'Jose Barboza' } };
  check('an agent id resolves to the agent name', api.authorFor({ user_id: 43273665087 }, context), 'Sebastian Rojas Grant');
  check('the requester id resolves to the customer', api.authorFor({ user_id: 43276327116 }, context), 'Jose Barboza');
  check(
    'an unknown id falls back to the address it came from',
    api.authorFor({ user_id: 999, from_email: 'someone@else.com' }, context),
    'someone@else.com'
  );
  check('with nothing to go on it says so', api.authorFor({}, context), 'Unknown');

  check('timestamps get one fixed shape', api.formatWhen('2026-08-20T10:07:00Z').length, 16);
  check('a timestamp is not locale-formatted', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(api.formatWhen('2026-08-20T10:07:00Z')), true);
  check('an empty timestamp is empty, not "Invalid Date"', api.formatWhen(''), '');
  check('an unparsable timestamp is passed through as-is', api.formatWhen('whenever'), 'whenever');

  check(
    'an attachment is listed with its size',
    api.attachmentLines({ attachments: [{ name: 'shot.png', size: 249856 }] })[0],
    '   [attachment] shot.png (244 KB)'
  );
  check('no attachments means no lines', api.attachmentLines({}).length, 0);
}

// ---------------------------------------------------------------------------
// The report itself.
// ---------------------------------------------------------------------------
const PAYLOAD = {
  ticket: {
    id: 352184,
    subject: 'Cannot log in on Roku',
    status: 8,
    priority: 1,
    type: 'Billing',
    source: 1,
    tags: ['B2C_at_billing'],
    created_at: '2026-08-20T10:07:00Z',
    updated_at: '2026-08-21T09:15:00Z',
    due_by: '2026-09-19T10:07:00Z',
    to_emails: ['sc-appsupport@spacecityhn.com'],
    cc_emails: [],
    group_id: 43000666076,
    responder_id: 43273665087,
    description_text: 'I have downloaded the app but it keeps asking for a tv provider.',
    custom_fields: {
      cf_product: 'SCHN+',
      cf_platform: 'Roku',
      cf_b2b_client_name: null,
      cf_resolved_by: '',
      cf_generate_ai_sumary: false
    },
    attachments: []
  },
  requester: { id: 43276327116, name: 'Jose Barboza', email: 'jose@example.com', phone: '' },
  labels: {
    status: { 8: 'Waiting on Development' },
    priority: { 1: 'Low' },
    custom: { cf_product: 'Brand', cf_platform: 'Platform' }
  },
  agentNames: { '43273665087': 'Sebastian Rojas Grant' },
  groupName: 'SCHN Support',
  agentName: 'Sebastian Rojas Grant',
  conversations: [
    { user_id: 43276327116, incoming: true, private: false, body_text: 'Still broken today.', created_at: '2026-08-20T11:00:00Z' },
    { user_id: 43273665087, incoming: false, private: false, body_text: 'Could you try reinstalling?', created_at: '2026-08-20T11:30:00Z' },
    { user_id: 43273665087, incoming: false, private: true, body_text: 'Escalated to dev.', created_at: '2026-08-20T11:35:00Z', attachments: [{ name: 'log.txt', size: 2048 }] }
  ]
};

{
  const api = load();
  const report = api.buildReport(PAYLOAD);
  const lines = report.split('\n');
  const line = needle => lines.find(l => l.indexOf(needle) === 0) || '';

  check('the ticket number and subject head the report', lines[1], 'TICKET #352184 — Cannot log in on Roku');
  check('the ticket URL is right under it', lines[2], 'https://viewlift.freshdesk.com/a/tickets/352184');

  check('the status label is used, not the id', line('Status:'), 'Status:     Waiting on Development');
  check('the priority label is used, not the id', line('Priority:'), 'Priority:   Low');
  check('the source id is turned into a name', line('Source:'), 'Source:     Email');
  check('the group name is included', line('Group:'), 'Group:      SCHN Support');
  check('the assigned agent is included', line('Agent:'), 'Agent:      Sebastian Rojas Grant');
  check('tags are joined', line('Tags:'), 'Tags:       B2C_at_billing');
  check('the requester carries their address', line('Requester:'), 'Requester:  Jose Barboza <jose@example.com>');
  check('an empty phone is left out entirely', line('Phone:'), '');
  check('an empty cc list is left out entirely', line('CC:'), '');

  check('a filled custom field uses its label', line('Brand:'), 'Brand:      SCHN+');
  check('and another one', line('Platform:'), 'Platform:   Roku');
  check('a null custom field is skipped', /Client Name|cf_b2b_client_name/.test(report), false);
  check('an empty-string custom field is skipped', /Resolved By|cf_resolved_by/.test(report), false);
  check('a false custom field is skipped', /cf_generate_ai_sumary/.test(report), false);

  const heads = lines.filter(l => /^--- \d+ · /.test(l));
  check('every message got a block', heads.length, 4);
  check(
    'the description is message 1, from the requester',
    heads[0],
    '--- 1 · CUSTOMER · Jose Barboza · ' + localWhen('2026-08-20T10:07:00Z') + ' ---'
  );
  check('the description text is in the copy', report.indexOf('keeps asking for a tv provider') !== -1, true);
  check(
    'conversations continue the numbering from 2',
    heads[1],
    '--- 2 · CUSTOMER · Jose Barboza · ' + localWhen('2026-08-20T11:00:00Z') + ' ---'
  );
  check(
    'an agent reply is attributed to the agent',
    heads[2],
    '--- 3 · AGENT REPLY · Sebastian Rojas Grant · ' + localWhen('2026-08-20T11:30:00Z') + ' ---'
  );
  check(
    'a private note is marked as private',
    heads[3],
    '--- 4 · PRIVATE NOTE · Sebastian Rojas Grant · ' + localWhen('2026-08-20T11:35:00Z') + ' ---'
  );
  check('a message attachment is listed under its message', report.indexOf('[attachment] log.txt (2 KB)') !== -1, true);

  check('the trailer counts every message', /^4 messages · copied \d{4}-\d{2}-\d{2} \d{2}:\d{2} · Better Viewlift 9\.9\.9$/.test(lines[lines.length - 1]), true);
}

{
  // A case with nothing but its description still has to produce message 1.
  const api = load();
  const bare = api.buildReport({
    ticket: { id: 1, subject: '', description_text: 'hello', custom_fields: {} },
    requester: {},
    labels: { status: {}, priority: {}, custom: {} },
    conversations: []
  });

  check('a subjectless ticket says so rather than printing undefined', bare.split('\n')[1], 'TICKET #1 — (no subject)');
  check('the lone description is still message 1', /^--- 1 · CUSTOMER · Requester ---$/m.test(bare), true);
  check('and the trailer stays singular', /^1 message · copied /m.test(bare), true);
}

{
  // An empty message must not silently vanish from the numbering.
  const api = load();
  const withGap = api.buildReport({
    ticket: { id: 2, subject: 's', description_text: '', custom_fields: {} },
    requester: { name: 'A' },
    labels: { status: {}, priority: {}, custom: {} },
    conversations: [{ incoming: true, body_text: '', from_email: 'a@b.c' }]
  });

  check('a message with no text is kept and marked', (withGap.match(/\(no text\)/g) || []).length, 2);
  check('numbering is unaffected by empty bodies', /^--- 2 · CUSTOMER · a@b\.c ---$/m.test(withGap), true);
}

async function asyncChecks() {
  // ---------------------------------------------------------------------------
  // Paging - the actual "include the hidden conversations" mechanism.
  // ---------------------------------------------------------------------------
  {
    const calls = [];
    const total = 257;
    const api = load({
      api: async (url) => {
        calls.push(url);
        const page = Number((url.match(/[?&]page=(\d+)/) || [])[1] || 1);
        const per = Number((url.match(/per_page=(\d+)/) || [])[1] || 0);
        const start = (page - 1) * per;
        return Array.from({ length: Math.max(0, Math.min(per, total - start)) }, (_, i) => ({ id: start + i }));
      }
    });

    const all = await api.pagedList('/api/v2/tickets/1/conversations');
    check('every page is walked, not just the first', all.length, total);
    check('one call per page plus the short last one', calls.length, 3);
    check('the first call asks for a full page', /per_page=100&page=1$/.test(calls[0]), true);
    await api.pagedList('/api/v2/agents?state=fulltime');
    check(
      'a path that already has a query gets & rather than a second ?',
      /^\/api\/v2\/agents\?state=fulltime&per_page=100&page=1$/.test(calls[3]),
      true
    );
    check('ids are in order across the page boundary', all[99].id + '/' + all[100].id, '99/100');
  }

  {
    // A page that keeps returning full pages must stop at the ceiling instead of
    // looping forever.
    let served = 0;
    const api = load({
      api: async () => { served++; return Array.from({ length: 100 }, (_, i) => ({ id: i })); }
    });

    const all = await api.pagedList('/api/v2/tickets/1/conversations');
    check('an endless feed stops at MAX_PAGES', served, api.MAX_PAGES);
    check('and returns what it collected', all.length, api.MAX_PAGES * api.PER_PAGE);
  }

  {
    const api = load({ api: async () => [] });
    check('an empty first page yields nothing', (await api.pagedList('/x')).length, 0);
  }

  // ---------------------------------------------------------------------------
  // A broken lookup must not cost the whole case. Everything except the
  // conversations themselves is decoration - degrade, do not abort, or the
  // copy falls back to the page and silently loses every collapsed message.
  // ---------------------------------------------------------------------------
  {
    const paths = [];
    const api = load({
      api: async (path) => {
        paths.push(path);
        if (/\/tickets\/7\?/.test(path)) {
          return {
            id: 7, subject: 'Broken lookups', status: 8, priority: 3, group_id: 5,
            responder_id: 42, description_text: 'first message', custom_fields: {},
            requester: { id: 1, name: 'Cust' }
          };
        }
        if (/conversations/.test(path)) {
          return [{ user_id: 42, incoming: false, private: false, body_text: 'reply', created_at: '2026-08-20T11:00:00Z' }];
        }
        throw new Error('unexpected path ' + path);
      },
      getFieldLabels: async () => { throw new Error('403'); },
      getAgentNames: async () => { throw new Error('403'); },
      getGroupName: async () => ''
    });

    // Caught rather than awaited bare: without the .catch()es in the source
    // this rejects, and a crashed run reports worse than a named FAIL.
    let report = '';
    let aborted = null;
    try {
      report = await api.collectViaApi('7');
    } catch (error) {
      aborted = String(error && error.message || error);
    }

    check('a decoration lookup that 403s does not abort the copy', aborted, null);
    check('a failed label lookup still produces a report', report.indexOf('TICKET #7 — Broken lookups') !== -1, true);
    check('the conversation survived it', report.indexOf('reply') !== -1, true);
    check('the description survived it', report.indexOf('first message') !== -1, true);
    check('an unresolved status degrades to the raw id', /^Status:\s+8$/m.test(report), true);
    check('an unresolved priority degrades to the raw id', /^Priority:\s+3$/m.test(report), true);
    check('an unresolved author degrades rather than blanking', /· Unknown ·/.test(report), true);
    check('both messages are still numbered', (report.match(/^--- \d+ · /gm) || []).length, 2);
  }

  {
    // The conversations, on the other hand, ARE the feature: if they cannot be
    // read there is nothing worth copying and the caller has to know.
    const api = load({
      api: async (path) => {
        if (/conversations/.test(path)) throw new Error('HTTP 500');
        return { id: 8, subject: 's', custom_fields: {}, requester: {} };
      }
    });

    let threw = false;
    try { await api.collectViaApi('8'); } catch (error) { threw = true; }
    check('an unreadable conversation list fails loudly, so the DOM fallback runs', threw, true);
  }

  // ---------------------------------------------------------------------------
  // The DOM fallback's text reader.
  // ---------------------------------------------------------------------------
  function el(tag, options) {
    const spec = options || {};
    const node = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      id: spec.id || '',
      classList: spec.classes || [],
      childNodes: []
    };
    (spec.children || []).forEach(child => node.childNodes.push(child));
    return node;
  }

  function text(value) {
    return { nodeType: 3, nodeValue: value };
  }

  {
    const api = load();

    const root = el('div', { children: [
      el('p', { children: [text('Customer says hello')] }),
      // Feature 5's quick-copy chips, injected under the message.
      el('div', { classes: ['better-freshdesk-mentioned-emails'], children: [
        el('button', { children: [text('other@customer.com')] })
      ] }),
      el('div', { id: 'better-freshdesk-copy-case', children: [text('COPY BUTTON')] }),
      el('style', { children: [text('.x{color:red}')] }),
      el('p', { children: [text('and then this')] })
    ] });

    const read = api.readTextSkippingOurUi(root);
    check('the real message text is read', read.indexOf('Customer says hello') !== -1, true);
    check('our injected email chips are not copied into the case', read.indexOf('other@customer.com'), -1);
    check('our own toolbar button is not copied either', read.indexOf('COPY BUTTON'), -1);
    check('stylesheet text is not copied', read.indexOf('color:red'), -1);
    check('block elements become line breaks', read, 'Customer says hello\nand then this');
    check('a missing root reads as empty', api.readTextSkippingOurUi(null), '');
  }
}

asyncChecks().then(() => {
  console.log(
    failures
      ? '\n' + failures + ' check(s) FAILED'
      : '\nAll checks passed against the shipped source.'
  );
  process.exit(failures ? 1 : 0);
});
