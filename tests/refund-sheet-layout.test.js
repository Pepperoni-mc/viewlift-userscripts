// Checks that the refund row is laid out the way each client's own tab in the
// Refund Log actually is.
//
// The bug this locks down (2026-08-22): the 11 client tabs have THREE different
// column orders, and the code modelled two of them with two unrelated ad-hoc
// rules - `REFUND_SHEET_DATE_FIRST` (used by the open-the-sheet button) and
// `shouldAddBlankColumnBetweenRefunderAndDate()` (used by the copy-row button).
// schn matched neither correctly, so its date was written one column past
// "Date/Week of", and the two buttons could produce different rows for the same
// client.
//
// HEADERS below were read off the live sheet, tab by tab, with
// `gviz/tq?tqx=out:csv&gid=<gid>&range=A1:N1`. They are the fixture: if a tab is
// ever re-ordered, re-read it and update this table, and the check below will
// tell you which layout no longer matches.
//
// Run with: node tests/refund-sheet-layout.test.js
const fs = require('fs');
const path = require('path');

const fullSrc = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'better-viewlift.user.js'),
  'utf8'
);

// Feature 1's section - several features declare their own helpers.
const featureStart = fullSrc.indexOf('Feature 1: Refund Capture Tool Enhanced');
if (featureStart === -1) throw new Error('could not find the Feature 1 section');
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
  ${extractConst(/const REFUND_SHEET_ID = [^\n]+/, 'REFUND_SHEET_ID')}
  ${extractConst(/const REFUND_ROW_BASE = \[[\s\S]*?\];/, 'REFUND_ROW_BASE')}
  ${extractConst(/const REFUND_LAYOUT_COMMENTS_DATE = [^\n]+/, 'REFUND_LAYOUT_COMMENTS_DATE')}
  ${extractConst(/const REFUND_LAYOUT_DATE_COMMENTS = [^\n]+/, 'REFUND_LAYOUT_DATE_COMMENTS')}
  ${extractConst(/const REFUND_LAYOUT_DATE_ONLY = [^\n]+/, 'REFUND_LAYOUT_DATE_ONLY')}
  ${extractConst(/const REFUND_SHEETS = \{[\s\S]*?\n  \};/, 'REFUND_SHEETS')}
  ${extractFunction(/function refundSheetUrl/, 'refundSheetUrl')}
  ${extractFunction(/function readRefundFields/, 'readRefundFields')}
  ${extractFunction(/function buildRefundRow/, 'buildRefundRow')}
  ${extractFunction(/function fetchNextRefundRow/, 'fetchNextRefundRow')}
  module.exports = { REFUND_SHEETS, REFUND_SHEET_ID, refundSheetUrl, buildRefundRow, fetchNextRefundRow };
`;

// The live headers, per tab.
const HEADERS = {
  tbl:       ['Email', 'Freshdesk ID', 'CMS URL for User', 'Payment Handler', 'Reason', 'Tag Refunded!', 'Amount Refunded', 'Refunder', 'Comments', 'Date/Week of'],
  schn:      ['Email', 'Freshdesk ID', 'CMS URL for User', 'Payment Handler', 'Reason', 'Tag Refunded!', 'Amount Refunded', 'Refunder', 'Date/Week of'],
  // Column A has no header text on this tab, but it is the email column.
  altitude:  ['', 'Freshdesk ID', 'CMS URL for User', 'Payment Handler', 'Reason', 'Tag Refunded!', 'Amount Refunded', 'Refunder', 'Comments', 'Date/Week of'],
  msn:       ['Email', 'Freshdesk ID', 'CMS URL for User', 'Payment Handler', 'Reason', 'Tag Refunded!', 'Amount Refunded', 'Refunder', 'Date/Week of', 'Comments'],
  vgk:       ['Email', 'Freshdesk ID', 'CMS URL for User', 'Payment Handler', 'Reason', 'Tag Refunded!', 'Amount Refunded', 'Refunder', 'Date/Week of', 'Comments'],
  chsn:      ['Email', 'Freshdesk ID', 'CMS URL for User', 'Payment Handler', 'Reason', 'Tag Refunded!', 'Amount Refunded', 'Refunder', 'Date/Week of', 'Comments'],
  fox:       ['Email', 'Freshdesk ID', 'CMS URL for User', 'Payment Handler', 'Reason', 'Tag Refunded!', 'Amount Refunded', 'Refunder', 'Date/Week of', 'Comments'],
  rootsport: ['Email', 'Freshdesk ID', 'CMS URL for User', 'Payment Handler', 'Reason', 'Tag Refunded!', 'Amount Refunded', 'Refunder', 'Comments', 'Date/Week of'],
  livgolf:   ['', 'Freshdesk ID', 'CMS URL for User', 'Payment Handler', 'Reason', 'Tag Refunded!', 'Amount Refunded', 'Refunder', 'Comments', 'Date/Week of'],
  dirt:      ['Email', 'Freshdesk ID', 'CMS URL for User', 'Payment Handler', 'Reason', 'Tag Refunded!', 'Amount Refunded', 'Refunder', 'Comments', 'Date/Week of'],
  lnp:       ['Email', 'Freshdesk ID', 'CMS URL for User', 'Payment Handler', 'Reason', 'Tag Refunded!', 'Amount Refunded', 'Refunder', 'Comments', 'Date/Week of']
};

const HEADER_TO_FIELD = {
  'Email': 'email',
  '': 'email',
  'Freshdesk ID': 'freshdesk',
  'CMS URL for User': 'cms',
  'Payment Handler': 'payment',
  'Reason': 'reason',
  'Tag Refunded!': 'tag',
  'Amount Refunded': 'amount',
  'Refunder': 'refunder',
  'Comments': 'comments',
  'Date/Week of': 'date'
};

// The panel as the user left it, so a built row can be read at a glance.
const PANEL = {
  'refund-email': 'customer@example.com',
  'refund-freshdesk': 'https://viewlift.freshdesk.com/a/tickets/352003',
  'refund-cms': 'https://cms.viewlift.com/users/search/abc',
  'refund-payment': 'Stripe',
  'refund-reason': 'ROTH',
  'refund-tag': 'yes',
  'refund-amount': '9.99',
  'refund-refunder': 'Esteban',
  'refund-date': '22-Aug'
};

function load(options) {
  const settings = options || {};
  const mod = { exports: {} };
  const panel = Object.assign({}, PANEL, settings.panel || {});

  const doc = {
    getElementById: id => (id in panel ? { value: panel[id] } : null)
  };

  new Function('module', 'document', 'getTodayShortDate', 'GM_xmlhttpRequest', 'console', sandbox)(
    mod,
    doc,
    () => '01-Jan',
    settings.GM_xmlhttpRequest || (() => { throw new Error('no request stub'); }),
    { warn: () => {}, error: () => {} }
  );

  return mod.exports;
}

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label);
  if (!ok) console.log('      expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const api = load();

// ---------------------------------------------------------------------------
// The layout table against the real headers. This is the whole point.
// ---------------------------------------------------------------------------
check('every client tab is covered', Object.keys(api.REFUND_SHEETS).sort().join(','), Object.keys(HEADERS).sort().join(','));

Object.keys(HEADERS).forEach(client => {
  const expected = HEADERS[client].map(header => {
    if (!(header in HEADER_TO_FIELD)) throw new Error('unmapped header "' + header + '" on ' + client);
    return HEADER_TO_FIELD[header];
  });
  const encoded = (api.REFUND_SHEETS[client] || {}).columns || [];
  check(
    client + ': the encoded columns match the tab\'s real headers',
    encoded.join(','),
    expected.join(',')
  );
});

// ---------------------------------------------------------------------------
// The three shapes, spelled out where the old code got them wrong.
// ---------------------------------------------------------------------------
{
  const row = api.buildRefundRow('schn');
  check('schn has no Comments column at all', row.length, 9);
  check('so its date sits right after the refunder', row[8], '22-Aug');
  check('and the refunder is where it should be', row[7], 'Esteban');
  check('nothing blank was inserted before the date', row.indexOf(''), -1);
}

{
  const row = api.buildRefundRow('msn');
  check('msn puts the date before Comments', row[8], '22-Aug');
  check('and leaves Comments empty at the end', row[9], '');
  check('with ten columns', row.length, 10);
}

{
  const row = api.buildRefundRow('tbl');
  check('tbl puts Comments before the date', row[8], '');
  check('so the date is last', row[9], '22-Aug');
  check('with ten columns', row.length, 10);
}

{
  // Same shape as tbl, and the one the old date-first set silently got right.
  const row = api.buildRefundRow('livgolf');
  check('livgolf follows the Comments-then-date shape', row[8] + '|' + row[9], '|22-Aug');
}

{
  const row = api.buildRefundRow('tbl');
  check('the email leads every row', row[0], 'customer@example.com');
  check('the freshdesk link is second', row[1], 'https://viewlift.freshdesk.com/a/tickets/352003');
  check('then the CMS link', row[2], 'https://cms.viewlift.com/users/search/abc');
  check('then the payment handler', row[3], 'Stripe');
  check('then the reason', row[4], 'ROTH');
  check('then the tag', row[5], 'yes');
  check('then the amount', row[6], '9.99');
}

{
  // An unknown client must still produce a usable row rather than nothing.
  const row = api.buildRefundRow('something-new');
  check('an unknown client falls back to the tbl shape', row.length, 10);
}

{
  const empty = load({ panel: { 'refund-tag': '', 'refund-refunder': '', 'refund-date': '' } });
  const row = empty.buildRefundRow('tbl');
  check('an empty tag defaults to yes', row[5], 'yes');
  check('an empty refunder defaults to Sebastian', row[7], 'Sebastian');
  check("an empty date falls back to today's", row[9], '01-Jan');
}

// ---------------------------------------------------------------------------
// The sheet URL per client.
// ---------------------------------------------------------------------------
{
  check(
    'each client opens its own tab',
    api.refundSheetUrl('schn'),
    'https://docs.google.com/spreadsheets/d/' + api.REFUND_SHEET_ID + '/edit?gid=273386395#gid=273386395'
  );
  check('msn opens a different gid', /gid=291960457/.test(api.refundSheetUrl('msn')), true);
  check('an unknown client opens the tbl tab', api.refundSheetUrl('nope'), api.refundSheetUrl('tbl'));
  check('every tab has a gid', Object.values(api.REFUND_SHEETS).every(sheet => /^\d+$/.test(sheet.gid)), true);
  check(
    'and every gid is distinct',
    new Set(Object.values(api.REFUND_SHEETS).map(sheet => sheet.gid)).size,
    Object.keys(HEADERS).length
  );
}

// ---------------------------------------------------------------------------
// Where to land in the sheet. Row 1 is the header, so the first free row is
// count + 2 - checked against the tbl tab, whose count was 101 with data
// ending on row 102.
// ---------------------------------------------------------------------------
{
  const requests = [];
  const api2 = load({
    GM_xmlhttpRequest: options => {
      requests.push(options);
      options.onload({ responseText: '"count Freshdesk ID"\n"101"\n' });
    }
  });

  let landed = null;
  api2.fetchNextRefundRow('tbl', row => { landed = row; });
  check('101 records means the next free row is 103', landed, 103);
  check('it asks only for a count, never for the rows', /select%20count\(B\)/.test(requests[0].url), true);
  check('and asks the right tab', /gid=469886271/.test(requests[0].url), true);
  check('over https to the sheet', requests[0].url.indexOf('https://docs.google.com/spreadsheets/') , 0);
}

{
  const api2 = load({ GM_xmlhttpRequest: options => options.onload({ responseText: 'not a count at all' }) });
  let landed = null;
  api2.fetchNextRefundRow('tbl', row => { landed = row; });
  check('an unparsable answer reports 0 so the caller can fall back', landed, 0);
}

{
  const api2 = load({ GM_xmlhttpRequest: options => options.onerror() });
  let landed = null;
  api2.fetchNextRefundRow('tbl', row => { landed = row; });
  check('a network error reports 0 rather than throwing', landed, 0);
}

{
  const api2 = load({ GM_xmlhttpRequest: options => options.ontimeout() });
  let landed = null;
  api2.fetchNextRefundRow('tbl', row => { landed = row; });
  check('a timeout reports 0 too', landed, 0);
}

{
  const api2 = load({ GM_xmlhttpRequest: () => { throw new Error('blocked'); } });
  let landed = null;
  api2.fetchNextRefundRow('tbl', row => { landed = row; });
  check('a blocked request still calls back', landed, 0);
}

{
  const api2 = load({ GM_xmlhttpRequest: options => options.onload({ responseText: '"count Freshdesk ID"\n"0"\n' }) });
  let landed = null;
  api2.fetchNextRefundRow('lnp', row => { landed = row; });
  check('an empty tab lands on row 2, under the header', landed, 2);
}

console.log(
  failures
    ? '\n' + failures + ' check(s) FAILED'
    : '\nAll checks passed against the shipped source.'
);
process.exit(failures ? 1 : 0);
