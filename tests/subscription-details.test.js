// Checks that the CMS screenshot button also carries the subscription panel
// across as TEXT, pasted under the CMS link in the Freshdesk private note.
//
// Why this needs a test (2026-08-27): the fields are scraped out of a React
// panel whose only stable feature is the label text sitting next to the value,
// and they then travel through GM storage into an agent's note - so both the
// scrape and the paste are worth pinning:
//
//   * a label reads the value NEXT to it, never the whole panel (the flat
//     layout puts every field in one parent - reading that parent would glue
//     the entire panel into a single value);
//   * an empty editable field ("Enter TVOD Redemption Code") is not a value;
//   * the note gets text nodes only, capped, and only under the link.
//
// Pulls the real functions out of the shipped userscript, so they cannot drift
// from what ships.
//
// Run with: node tests/subscription-details.test.js
const fs = require('fs');
const path = require('path');

const fullSrc = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'better-viewlift.user.js'),
  'utf8'
);

function sectionFrom(marker) {
  const idx = fullSrc.indexOf(marker);
  if (idx === -1) throw new Error('could not find section: ' + marker);
  return fullSrc.slice(idx);
}

const cmsSrc = sectionFrom('Feature 4: CMS Real Snapshot to Clipboard');
const noteSrc = sectionFrom('Feature 9: Queue CMS snapshots into a private note');

function extractFunction(source, pattern, name) {
  const idx = source.search(pattern);
  if (idx === -1) throw new Error('could not find ' + name);

  let i = source.indexOf('(', idx);
  let parenDepth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '(') parenDepth++;
    else if (source[i] === ')') { parenDepth--; if (parenDepth === 0) { i++; break; } }
  }

  let depth = 0;
  for (let j = source.indexOf('{', i); j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(idx, j + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}

function extractConst(source, name) {
  const idx = source.indexOf('const ' + name);
  if (idx === -1) throw new Error('could not find const ' + name);
  const end = source.indexOf(';', idx);
  return source.slice(idx, end + 1);
}

// ---------------------------------------------------------------------------
// Minimal fake DOM. Only what the scraper touches, and deliberately faithful
// on the one detail the scraper leans on: textContent concatenates children
// with NO separator, which is what stops a label+value wrapper from reading as
// a bare label.
// ---------------------------------------------------------------------------
function parseSelector(selector) {
  return String(selector).split(',').map(part => part.trim()).filter(Boolean);
}

function matchesOne(node, part) {
  if (part.startsWith('#')) return node.id === part.slice(1);
  const attr = part.match(/^\[([\w-]+)=['"]?([^'"\]]+)['"]?\]$/);
  if (attr) return node.attrs[attr[1]] === attr[2];
  return node.tagName === part.toUpperCase();
}

function el(tag, opts) {
  opts = opts || {};

  const node = {
    tagName: String(tag).toUpperCase(),
    id: opts.id || '',
    attrs: opts.attrs || {},
    value: opts.value,
    ownText: opts.text || '',
    children: [],
    parentElement: null
  };

  Object.defineProperty(node, 'textContent', {
    get() {
      return node.children.length
        ? node.children.map(child => child.textContent).join('')
        : node.ownText;
    },
    set(value) {
      node.children = [];
      node.ownText = String(value);
    }
  });

  Object.defineProperty(node, 'nextElementSibling', {
    get() {
      const siblings = node.parentElement ? node.parentElement.children : [];
      return siblings[siblings.indexOf(node) + 1] || null;
    }
  });

  Object.defineProperty(node, 'previousElementSibling', {
    get() {
      const siblings = node.parentElement ? node.parentElement.children : [];
      return siblings[siblings.indexOf(node) - 1] || null;
    }
  });

  node.appendChild = child => {
    child.parentElement = node;
    node.children.push(child);
    return child;
  };

  node.descendants = () => node.children.flatMap(child => [child].concat(child.descendants()));

  node.contains = other => other === node || node.descendants().includes(other);

  node.matches = selector => parseSelector(selector).some(part => matchesOne(node, part));

  node.querySelectorAll = selector => {
    const parts = parseSelector(selector);
    return node.descendants().filter(d => parts.some(part => matchesOne(d, part)));
  };

  node.querySelector = selector => node.querySelectorAll(selector)[0] || null;

  node.closest = selector => {
    const parts = parseSelector(selector);
    let current = node;
    while (current) {
      if (parts.some(part => matchesOne(current, part))) return current;
      current = current.parentElement;
    }
    return null;
  };

  (opts.children || []).forEach(child => node.appendChild(child));

  return node;
}

function text(tag, value) {
  return el(tag, { text: value });
}

// ---------------------------------------------------------------------------
function loadScraper(rootChildren) {
  const document = el('html', { children: rootChildren });

  const sandbox = `
    const WRAPPER_ID = "tm-viewlift-snapshot-tools";
    const BUTTON_ID = "tm-viewlift-real-snapshot-button";
    const BADGE_ID = "tm-viewlift-payment-handler-badge";
    ${extractFunction(cmsSrc, /function cleanText/, 'cleanText')}
    ${extractConst(cmsSrc, 'SUBSCRIPTION_DETAIL_LABELS')}
    ${extractConst(cmsSrc, 'SUBSCRIPTION_CYCLE_PATTERN')}
    ${extractConst(cmsSrc, 'SUBSCRIPTION_DETAIL_MAX_FIELDS')}
    ${extractConst(cmsSrc, 'SUBSCRIPTION_DETAIL_MAX_VALUE_LENGTH')}
    ${extractFunction(cmsSrc, /function isSubscriptionDetailLabel/, 'isSubscriptionDetailLabel')}
    ${extractFunction(cmsSrc, /function findSubscriptionPanel/, 'findSubscriptionPanel')}
    ${extractFunction(cmsSrc, /function readFieldOrText/, 'readFieldOrText')}
    ${extractFunction(cmsSrc, /function readLabeledValue/, 'readLabeledValue')}
    ${extractFunction(cmsSrc, /function readSubscriptionCycleHeading/, 'readSubscriptionCycleHeading')}
    ${extractFunction(cmsSrc, /function collectSubscriptionDetails/, 'collectSubscriptionDetails')}
    module.exports = { collectSubscriptionDetails, findSubscriptionPanel, readLabeledValue, isSubscriptionDetailLabel };
  `;

  const mod = { exports: {} };
  new Function('module', 'document', sandbox)(mod, document);
  return mod.exports;
}

// The panel as the CMS renders it today: a heading, then a flat run of label
// and value nodes - the layout that makes "read the label's parent" wrong.
function flatPanel() {
  return el('div', { id: 'page', children: [
    el('div', { id: 'account-header', children: [text('p', 'Status'), text('p', 'Active')] }),
    el('div', { id: 'panel', children: [
      text('h4', 'Subscription Plans'),
      text('p', 'TVOD Redemption Code'),
      el('div', { children: [el('input', { value: '', attrs: { placeholder: 'Enter TVOD Redemption Code' } })] }),
      text('p', 'ALL'),
      text('p', 'Plan Name'),
      text('p', 'tve-schn'),
      text('p', 'Country'),
      text('p', 'US'),
      text('p', 'Channel IDs'),
      text('p', 'ALL'),
      text('p', 'Payment Handler'),
      text('p', 'TVE'),
      text('p', 'Registered On'),
      text('p', '8/25/26'),
      text('p', '12:58:04 PM GMT-6')
    ] })
  ] });
}

// The panel exactly as a Stripe account renders it (ticket 2026-08-29): a
// billing-cycle heading with no label of its own, then every field of the plan
// - including the ones that used to fall off the end of the note.
function stripePanel() {
  return el('div', { id: 'page', children: [
    el('div', { id: 'panel', children: [
      text('h4', 'Subscription Plans'),
      text('p', 'TVOD Redemption Code'),
      el('div', { children: [el('input', { value: '', attrs: { placeholder: 'Enter TVOD Redemption Code' } })] }),
      text('p', 'Monthly'),
      text('p', 'Plan Name'),
      text('p', 'Altitude+ Monthly Plan'),
      text('p', 'Price'),
      text('p', 'USD 19.95'),
      text('p', 'Status'),
      text('p', 'DEFERRED_CANCELLATION'),
      text('p', 'Country'),
      text('p', 'US'),
      text('p', 'Receipt ID'),
      text('p', 'ch_3U3TcQEQqB3z7mPz0SVQU3eC'),
      text('p', 'Payment Unique ID'),
      text('p', 'cus_TDfwTS0Oy93V6d'),
      text('p', 'Transaction ID'),
      text('p', '–'),
      text('p', 'Payment Handler'),
      text('p', 'STRIPE'),
      text('p', 'Registered On'),
      text('p', '10/11/25'),
      text('p', '7:58:10 PM GMT-6'),
      text('p', 'End Date'),
      text('p', '9/11/26'),
      text('p', '10:18:21 PM GMT-6'),
      text('p', 'Cancellation Reason'),
      text('p', 'Not using enough')
    ] })
  ] });
}

// Two plans on one account - the same labels twice over.
function twoPlanPanel() {
  return el('div', { id: 'page', children: [
    el('div', { id: 'panel', children: [
      text('h4', 'Subscription Plans'),
      text('p', 'Monthly'),
      text('p', 'Plan Name'),
      text('p', 'Altitude+ Monthly Plan'),
      text('p', 'Status'),
      text('p', 'CANCELLED'),
      text('p', 'Annual'),
      text('p', 'Plan Name'),
      text('p', 'Altitude+ Annual Plan'),
      text('p', 'Status'),
      text('p', 'ACTIVE')
    ] })
  ] });
}

// The same fields as label/value rows - the other shape this panel takes.
function rowPanel() {
  const row = (label, value) => el('div', { children: [text('p', label), text('p', value)] });
  return el('div', { id: 'page', children: [
    el('div', { id: 'panel', children: [
      text('h4', 'Subscription Plans'),
      row('Plan Name', 'tve-schn'),
      row('Country', 'US'),
      row('Payment Handler', 'TVE')
    ] })
  ] });
}

// ---------------------------------------------------------------------------
let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label);
  if (!ok) console.log('      expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

// --- the flat layout ------------------------------------------------------
{
  const api = loadScraper([flatPanel()]);
  const details = api.collectSubscriptionDetails();
  const asMap = Object.fromEntries(details.map(d => [d.label, d.value]));

  check('the plan name is read from the node next to its label', asMap['Plan Name'], 'tve-schn');
  check('the country is read', asMap.Country, 'US');
  check('the channel ids are read', asMap['Channel IDs'], 'ALL');
  check('the payment handler is read', asMap['Payment Handler'], 'TVE');
  check(
    'a date and its time come across as one value',
    asMap['Registered On'],
    '8/25/26 12:58:04 PM GMT-6'
  );
  check(
    'an empty redemption field is left out - a placeholder is not a value',
    'TVOD Redemption Code' in asMap,
    false
  );
  check(
    'the fields keep the order they appear in on the page',
    details.map(d => d.label),
    ['Plan Name', 'Country', 'Channel IDs', 'Payment Handler', 'Registered On']
  );
  check(
    'the account header outside the panel is not scraped',
    details.every(d => d.label !== 'Status'),
    true
  );
}

// --- a filled-in redemption code IS a value -------------------------------
{
  const panel = flatPanel();
  panel.querySelector('input').value = 'SUMMER25';

  const api = loadScraper([panel]);
  const asMap = Object.fromEntries(api.collectSubscriptionDetails().map(d => [d.label, d.value]));

  check('a redemption code that was actually entered is kept', asMap['TVOD Redemption Code'], 'SUMMER25');
}

// --- the row layout -------------------------------------------------------
{
  const api = loadScraper([rowPanel()]);
  const asMap = Object.fromEntries(api.collectSubscriptionDetails().map(d => [d.label, d.value]));

  check('row layout: plan name', asMap['Plan Name'], 'tve-schn');
  check('row layout: country', asMap.Country, 'US');
  check('row layout: payment handler', asMap['Payment Handler'], 'TVE');
}

// --- the whole Stripe panel, field for field ------------------------------
{
  const api = loadScraper([stripePanel()]);
  const details = api.collectSubscriptionDetails();

  check(
    'every field the panel shows reaches the note, in page order',
    details.map(d => d.label + ': ' + d.value),
    [
      'Billing Cycle: Monthly',
      'Plan Name: Altitude+ Monthly Plan',
      'Price: USD 19.95',
      'Status: DEFERRED_CANCELLATION',
      'Country: US',
      'Receipt ID: ch_3U3TcQEQqB3z7mPz0SVQU3eC',
      'Payment Unique ID: cus_TDfwTS0Oy93V6d',
      'Transaction ID: –',
      'Payment Handler: STRIPE',
      'Registered On: 10/11/25 7:58:10 PM GMT-6',
      'End Date: 9/11/26 10:18:21 PM GMT-6',
      'Cancellation Reason: Not using enough'
    ]
  );

  check(
    'a single plan is one group, so the note gets no stray blank line',
    Array.from(new Set(details.map(d => d.group))),
    [0]
  );
}

// --- two plans on one account --------------------------------------------
{
  const api = loadScraper([twoPlanPanel()]);
  const details = api.collectSubscriptionDetails();

  check(
    'the second plan is kept rather than dropped as a repeat',
    details.map(d => d.label + ': ' + d.value),
    [
      'Billing Cycle: Monthly',
      'Plan Name: Altitude+ Monthly Plan',
      'Status: CANCELLED',
      'Billing Cycle: Annual',
      'Plan Name: Altitude+ Annual Plan',
      'Status: ACTIVE'
    ]
  );

  check(
    'and the two plans are separate groups',
    details.map(d => d.group),
    [0, 0, 0, 1, 1, 1]
  );
}

// --- a cycle word that is somebody's value, not a heading -----------------
{
  const api = loadScraper([el('div', { children: [
    el('div', { id: 'panel', children: [
      text('h4', 'Subscription Plans'),
      text('p', 'Plan Name'),
      text('p', 'tve-schn'),
      text('p', 'Free Trial'),
      text('p', 'Monthly'),
      text('p', 'Country'),
      text('p', 'US')
    ] })
  ] })]);

  const details = api.collectSubscriptionDetails();

  check(
    'a labelled cycle word is read under its own label, not as a new plan',
    details.map(d => d.label + ': ' + d.value),
    ['Plan Name: tve-schn', 'Free Trial: Monthly', 'Country: US']
  );
}

// --- no panel on the page -------------------------------------------------
{
  const api = loadScraper([el('div', { children: [text('p', 'Plan Name'), text('p', 'tve-schn')] })]);
  check(
    'with no Subscription Plans panel nothing is scraped, rather than guessing',
    api.collectSubscriptionDetails(),
    []
  );
}

// --- the queue payload carries it ----------------------------------------
{
  const captureStart = fullSrc.indexOf('async function captureRealTabSnapshot');
  const queuePush = fullSrc.indexOf('queue.push({', captureStart);
  if (queuePush === -1) throw new Error('could not find the snapshot queue payload');
  const payload = fullSrc.slice(queuePush, fullSrc.indexOf('});', queuePush));

  check(
    'the capture queues the scraped fields alongside the PNG',
    /subscriptionDetails:\s*collectSubscriptionDetails\(\)/.test(payload),
    true
  );
  check('and still queues the CMS page URL', /sourceUrl:\s*location\.href/.test(payload), true);
}

// --- the Freshdesk side ---------------------------------------------------
function loadNoteSide() {
  const events = [];
  const editor = el('div');
  editor.dispatchEvent = evt => { events.push(evt); return true; };

  const sandbox = `
    ${extractConst(noteSrc, 'SUBSCRIPTION_NOTE_MAX_ROWS')}
    ${extractFunction(noteSrc, /function cleanText/, 'cleanText')}
    ${extractFunction(noteSrc, /function appendSubscriptionDetails/, 'appendSubscriptionDetails')}
    module.exports = { appendSubscriptionDetails };
  `;

  const document = {
    createElement: tag => el(tag),
    createTextNode: value => ({ nodeValue: String(value), children: [] })
  };

  const mod = { exports: {} };
  new Function('module', 'document', 'InputEvent', 'Event', sandbox)(
    mod,
    document,
    function InputEvent(type, init) { return { type, inputType: init && init.inputType }; },
    function Event(type) { return { type }; }
  );

  return { api: mod.exports, editor, events };
}

function serialize(node) {
  if (node.nodeValue !== undefined) return node.nodeValue;
  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return '<br>';
  const inner = node.children.length ? node.children.map(serialize).join('') : node.ownText;
  return '<' + tag + '>' + inner + '</' + tag + '>';
}

{
  const { api, editor, events } = loadNoteSide();

  const added = api.appendSubscriptionDetails(editor, [
    { label: 'Plan Name', value: 'tve-schn' },
    { label: 'Country', value: 'US' }
  ]);

  check('appending reports success', added, true);
  check('one paragraph is appended', editor.children.length, 1);
  check(
    'it reads as a labelled block of plain text',
    serialize(editor.children[0]),
    '<p><strong>Subscription details</strong><br>Plan Name: tve-schn<br>Country: US</p>'
  );
  check('an input event is dispatched so the editor registers the change', events[0].type, 'input');
  check('then change', events[1].type, 'change');
}

{
  const { api, editor } = loadNoteSide();

  api.appendSubscriptionDetails(editor, [
    { label: 'Billing Cycle', value: 'Monthly', group: 0 },
    { label: 'Status', value: 'CANCELLED', group: 0 },
    { label: 'Billing Cycle', value: 'Annual', group: 1 },
    { label: 'Status', value: 'ACTIVE', group: 1 }
  ]);

  check(
    'a second plan is separated by a blank line instead of running on',
    serialize(editor.children[0]),
    '<p><strong>Subscription details</strong>' +
      '<br>Billing Cycle: Monthly<br>Status: CANCELLED' +
      '<br><br>Billing Cycle: Annual<br>Status: ACTIVE</p>'
  );
}

{
  const { api, editor, events } = loadNoteSide();
  check('an older snapshot with no details is a no-op', api.appendSubscriptionDetails(editor, undefined), false);
  check('an empty list is a no-op too', api.appendSubscriptionDetails(editor, []), false);
  check('nothing was appended', editor.children.length, 0);
  check('and nothing was dispatched', events.length, 0);
}

{
  const { api, editor } = loadNoteSide();

  api.appendSubscriptionDetails(editor, Array.from({ length: 100 }, (_, i) => ({
    label: 'Field ' + i,
    value: 'x'.repeat(400)
  })));

  const paragraph = editor.children[0];
  // 1 heading + 60 rows, each row a <br> plus its text.
  check('at most 60 rows reach the note', paragraph.children.length, 1 + 60 * 2);

  const firstRow = paragraph.children[2];
  check('and each value is capped', firstRow.nodeValue.length <= 'Field 0: '.length + 200, true);
}

{
  const { api, editor } = loadNoteSide();

  api.appendSubscriptionDetails(editor, [
    { label: '', value: 'orphan' },
    { label: 'Plan Name', value: '' },
    { label: 'Country', value: 'US' }
  ]);

  check(
    'rows missing a label or a value are dropped rather than pasted half-empty',
    serialize(editor.children[0]),
    '<p><strong>Subscription details</strong><br>Country: US</p>'
  );
}

// --- the paste path actually calls it -------------------------------------
{
  const paste = extractFunction(noteSrc, /async function pasteSnapshot/, 'pasteSnapshot');

  check(
    'pasteSnapshot appends the details',
    /appendSubscriptionDetails\(editor, snapshot && snapshot\.subscriptionDetails\)/.test(paste),
    true
  );
  check(
    'and does so UNDER the CMS link',
    paste.indexOf('appendSubscriptionDetails') > paste.indexOf('appendSourceLink(editor'),
    true
  );
}

console.log(
  failures
    ? '\n' + failures + ' check(s) FAILED'
    : '\nAll checks passed against the shipped source.'
);
process.exit(failures ? 1 : 0);
