// Checks the CMS button's journey timing instrumentation.
//
// Why it exists (2026-08-20): "the SCHN CMS is slow on the initial search"
// could not be measured from outside the script - everything reachable from
// the page was fast, and the two remaining suspects (the LOOKUP_DEADLINE_MS
// wait, and the /users/search/<id> account route that automation cannot even
// click into) are invisible from there. So the script times itself across two
// tabs, which means the run is kept in GM storage. This test covers the parts
// that are easy to get quietly wrong: the off-by-default gate, the staleness
// cut-off, and the fact that only the email's DOMAIN is ever stored.
//
// Pulls the real functions out of the shipped userscript.
//
// Run with: node tests/cms-timing.test.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'better-viewlift.user.js'),
  'utf8'
);

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
  ${extractConst(/const BV_TIMING_FLAG = .*;/, 'BV_TIMING_FLAG')}
  ${extractConst(/const BV_TIMING_RUN_KEY = .*;/, 'BV_TIMING_RUN_KEY')}
  ${extractConst(/const BV_TIMING_MAX_AGE_MS = .*;/, 'BV_TIMING_MAX_AGE_MS')}
  ${extractFunction(/function bvTimingEnabled/, 'bvTimingEnabled')}
  ${extractFunction(/function bvTimingSetEnabled/, 'bvTimingSetEnabled')}
  ${extractFunction(/function bvTimingReadRun/, 'bvTimingReadRun')}
  ${extractFunction(/function bvTimingWriteRun/, 'bvTimingWriteRun')}
  ${extractFunction(/function bvTimingClearRun/, 'bvTimingClearRun')}
  ${extractFunction(/function bvTimingMark/, 'bvTimingMark')}
  ${extractFunction(/function bvTimingStart/, 'bvTimingStart')}
  ${extractFunction(/function bvTimingReport/, 'bvTimingReport')}
  module.exports = {
    bvTimingEnabled, bvTimingSetEnabled, bvTimingReadRun, bvTimingClearRun,
    bvTimingMark, bvTimingStart, bvTimingReport,
    BV_TIMING_RUN_KEY, BV_TIMING_FLAG, BV_TIMING_MAX_AGE_MS
  };
`;

function load() {
  const store = {};
  const dataset = {};
  const logs = [];
  let now = 1000000;

  const fakeWindow = {};
  const fakeDocument = { documentElement: { dataset } };
  const fakeConsole = {
    log: (...a) => logs.push(a.join(' ')),
    warn: (...a) => logs.push('WARN ' + a.join(' ')),
    table: rows => logs.push('TABLE:' + rows.length)
  };
  const fakeDate = { now: () => now };

  const mod = { exports: {} };
  new Function(
    'module', 'GM_getValue', 'GM_setValue', 'GM_deleteValue',
    'window', 'document', 'console', 'Date',
    sandbox
  )(
    mod,
    (k, d) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : d),
    (k, v) => { store[k] = v; },
    k => { delete store[k]; },
    fakeWindow, fakeDocument, fakeConsole, fakeDate
  );

  return {
    api: mod.exports,
    store,
    dataset,
    logs,
    fakeWindow,
    advance: ms => { now += ms; },
    nowValue: () => now
  };
}

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Off by default - instrumentation must cost nothing until asked for.
{
  const t = load();
  check('timing is off by default', t.api.bvTimingEnabled(), false);

  t.api.bvTimingStart('customer@example.com', 'schn');
  check('start writes nothing while off', t.api.bvTimingReadRun(), null);

  t.api.bvTimingMark('click');
  check('mark writes nothing while off', Object.keys(t.store).length, 0);
  check('and logs nothing while off', t.logs.length, 0);
}

// Each of the three channels can turn it on, because only one of them is
// reachable depending on where you are standing (page console vs GM menu).
{
  const t = load();
  t.dataset[t.api.BV_TIMING_FLAG] = 'true';
  check('the <html> data attribute enables it', t.api.bvTimingEnabled(), true);
}
{
  const t = load();
  t.fakeWindow['__' + t.api.BV_TIMING_FLAG] = true;
  check('the window global enables it', t.api.bvTimingEnabled(), true);
}
{
  const t = load();
  t.store[t.api.BV_TIMING_FLAG] = true;
  check('the GM value enables it', t.api.bvTimingEnabled(), true);
}

// setEnabled must mirror onto all three so DevTools can see and clear it.
{
  const t = load();
  t.api.bvTimingSetEnabled(true);
  check('setEnabled mirrors to the data attribute', t.dataset[t.api.BV_TIMING_FLAG], 'true');
  check('setEnabled mirrors to the window global', t.fakeWindow['__' + t.api.BV_TIMING_FLAG], true);
  check('setEnabled mirrors to GM storage', t.store[t.api.BV_TIMING_FLAG], true);

  t.api.bvTimingSetEnabled(false);
  check('setEnabled(false) removes the data attribute', t.api.BV_TIMING_FLAG in t.dataset, false);
  check('setEnabled(false) clears the flag', t.api.bvTimingEnabled(), false);
}

// The whole point: marks accumulate across what will be two different tabs.
{
  const t = load();
  t.api.bvTimingSetEnabled(true);
  t.api.bvTimingStart('customer@example.com', 'schn');

  t.api.bvTimingMark('click', 'credentials ready');
  t.advance(40);
  t.api.bvTimingMark('prefetch-miss');
  t.advance(3500);
  t.api.bvTimingMark('deadline-fired');
  t.advance(900);
  t.api.bvTimingMark('cms-api', 'v3.0/invoke 185ms');

  const run = t.api.bvTimingReadRun();
  check('every mark is recorded', run.stages.map(s => s.label), [
    'click', 'prefetch-miss', 'deadline-fired', 'cms-api'
  ]);
  check('offsets are measured from the click', run.stages.map(s => s.at), [0, 40, 3540, 4440]);
  check('the detail string is kept', run.stages[3].detail, 'v3.0/invoke 185ms');
}

// Privacy: a customer address must never end up in storage or the console.
{
  const t = load();
  t.api.bvTimingSetEnabled(true);
  t.api.bvTimingStart('jose.barboza6940@gmail.com', 'schn');

  const run = t.api.bvTimingReadRun();
  check('only the email domain is stored', run.domain, 'gmail.com');
  check(
    'the local part is nowhere in the stored run',
    JSON.stringify(run).includes('barboza'),
    false
  );
  check(
    'the local part is nowhere in the log output',
    t.logs.join(' | ').includes('barboza'),
    false
  );
  check('the site is stored so runs can be told apart', run.site, 'schn');
}

// A run left behind by an abandoned journey must not attach itself to the
// next CMS page an hour later and report a nonsense total.
{
  const t = load();
  t.api.bvTimingSetEnabled(true);
  t.api.bvTimingStart('customer@example.com', 'schn');
  t.api.bvTimingMark('click');

  t.advance(t.api.BV_TIMING_MAX_AGE_MS - 1);
  check('a run inside the age limit still reads', !!t.api.bvTimingReadRun(), true);

  t.advance(2);
  check('a stale run is ignored', t.api.bvTimingReadRun(), null);

  t.api.bvTimingMark('cms-page-script-start');
  check('and marks against a stale run are dropped', t.api.bvTimingReadRun(), null);
}

// Report prints once and clears, so the next click starts clean.
{
  const t = load();
  t.api.bvTimingSetEnabled(true);
  t.api.bvTimingStart('customer@example.com', 'schn');
  t.api.bvTimingMark('click');
  t.advance(1200);
  t.api.bvTimingReport('cms-settled');

  check('the final label is marked before printing', t.logs.some(l => l.includes('cms-settled')), true);
  check('a total is printed', t.logs.some(l => /TOTAL click -> cms-settled: 1200ms/.test(l)), true);
  check('the run is cleared after reporting', t.api.bvTimingReadRun(), null);
  check('the run key is gone from storage', t.api.BV_TIMING_RUN_KEY in t.store, false);

  const logsAfter = t.logs.length;
  t.api.bvTimingReport('cms-settled');
  check('reporting twice prints nothing the second time', t.logs.length, logsAfter);
}

// Corrupt or empty storage must not throw - this runs on every CMS page load.
{
  const t = load();
  t.api.bvTimingSetEnabled(true);
  t.store[t.api.BV_TIMING_RUN_KEY] = 'not json at all';
  check('unparsable stored run reads as none', t.api.bvTimingReadRun(), null);

  t.store[t.api.BV_TIMING_RUN_KEY] = JSON.stringify({ startedAt: t.nowValue() });
  check('a run with no stages array is rejected', t.api.bvTimingReadRun(), null);
}

if (failures) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed against the shipped source.');
