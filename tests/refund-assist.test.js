// Checks CMS Refund Assist (Feature 3b): the pick-charges / Cancel Now /
// refund-each workflow, and the pin that stops Feature 3 from refunding the
// wrong charge when Refund Assist drives it.
//
// What is worth pinning here (2026-09-30):
//   * the charges are read by HEADER name, so a column CMS adds or moves does
//     not shift the order number into the amount;
//   * only CHARGE rows with an eye are refundable - "No data found" and
//     non-charge rows never become checkboxes;
//   * totals are summed per currency, never USD + CAD;
//   * the plan card's Status / Plan Name come from the line after the label
//     (live DOM, MSN account, 2026-09-30), and a disabled CANCEL is no button;
//   * the Freshdesk note says what happened - cancellation first, the refund
//     list, what was not refunded and why - and a dry run says it is one;
//   * Feature 3 will not touch Refund while the open drawer is some other
//     order (stale drawer from the previous charge = double refund).
//
// Pulls the real functions out of the shipped userscript. The DOM is a shim
// of only what these helpers touch - whether MUI reacts is only provable live.
//
// Run with: node tests/refund-assist.test.js
const fs = require('fs');
const path = require('path');

const fullSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'better-viewlift.user.js'), 'utf8');

function sectionFrom(marker) {
  const idx = fullSrc.indexOf(marker);
  if (idx === -1) throw new Error('could not find section: ' + marker);
  return fullSrc.slice(idx);
}

const assistSrc = sectionFrom('Feature 3b: Refund Assist');
const workflowSrc = sectionFrom('Feature 3: CMS Percentage Refund Workflow');

function extractFunction(source, name) {
  const idx = source.search(new RegExp('function ' + name + '\\s*\\('));
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

function extractArray(source, name) {
  const idx = source.indexOf('const ' + name);
  if (idx === -1) throw new Error('could not find const ' + name);
  return source.slice(idx, source.indexOf('];', idx) + 2);
}

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

// ------------------------------------------------------------------ shims

function node(text, extra = {}) {
  return Object.assign({ textContent: text, innerText: text, children: [] }, extra);
}

function makeTable(headers, rows) {
  const ths = headers.map(h => node(h));
  const trs = rows.map(cells => {
    const tds = cells.map(c => node(c));
    return {
      children: tds,
      querySelector: sel => (sel === 'svg[data-testid="VisibilityIcon"]' && cells.hasEye !== false ? {} : null)
    };
  });
  return {
    querySelectorAll: sel => (sel === 'thead th' ? ths : sel === 'tbody tr' ? trs : [])
  };
}

function button(text, disabled = false) {
  return { textContent: text, disabled, getBoundingClientRect: () => ({ width: 10, height: 10 }) };
}

// ------------------------------------------------------------------ load

const context = {};
const loader = new Function('ctx', 'bvEventView', `
  const window = { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) };
  const location = { href: 'https://cms.monumentalsportsnetwork.com/users/search/abc' };
  const PANEL_ID = 'p'; const BUTTON_ID = 'b';
  ${extractFunction(assistSrc, 'cleanText')}
  ${extractFunction(assistSrc, 'lower')}
  ${extractFunction(assistSrc, 'isVisible')}
  ${extractFunction(assistSrc, 'getTableHeaders')}
  ${extractFunction(assistSrc, 'scrapeCharges')}
  ${extractFunction(assistSrc, 'isRefundable')}
  ${extractFunction(assistSrc, 'parseAmount')}
  ${extractFunction(assistSrc, 'formatTotal')}
  ${extractFunction(assistSrc, 'readPlanCard')}
  ${extractFunction(assistSrc, 'buildNote')}
  ${extractFunction(assistSrc, 'escapeHtml')}
  ${extractFunction(assistSrc, 'noteLinesToHtml')}
  ${extractFunction(assistSrc, 'scenarioActionsToUpdate')}
  ${extractArray(assistSrc, 'REFUNDED_SCENARIO_FALLBACK_ACTIONS')}
  Object.assign(ctx, { scrapeCharges, isRefundable, parseAmount, formatTotal, readPlanCard, buildNote,
    noteLinesToHtml, scenarioActionsToUpdate, REFUNDED_SCENARIO_FALLBACK_ACTIONS });
`);
loader(context, undefined);

const workflowCtx = {};
new Function('ctx', `
  let expectedOrder = '';
  ${extractFunction(workflowSrc, 'cleanText')}
  ${extractFunction(workflowSrc, 'triggerMatchesExpectedOrder')}
  ctx.setOrder = value => { expectedOrder = value; };
  ctx.triggerMatchesExpectedOrder = triggerMatchesExpectedOrder;
`)(workflowCtx);

const { scrapeCharges, isRefundable, parseAmount, formatTotal, readPlanCard, buildNote,
  noteLinesToHtml, scenarioActionsToUpdate, REFUNDED_SCENARIO_FALLBACK_ACTIONS } = context;

// ------------------------------------------------------------------ charges

const HEADERS = ['Date', 'Title', 'Transaction Type', 'Order Number', 'Total Amount', 'Payment Handler', 'Offer', 'Action'];
const table = makeTable(HEADERS, [
  ['9/29/2026', 'Monthly Plan', 'CHARGE', 'ch_AAA', 'USD 19.99', 'STRIPE', 'N/A', ''],
  ['8/29/2026', 'Monthly Plan', 'CHARGE', 'ch_BBB', 'USD 19.99', 'STRIPE', 'N/A', ''],
  ['7/29/2026', 'Monthly Plan', 'REFUND', 'ch_CCC', 'USD 19.99', 'STRIPE', 'N/A', '']
]);
const rows = scrapeCharges(table);
check('reads every row that has an order number', rows.length === 3, rows.length);
check('maps cells by header name', rows[0].order === 'ch_AAA' && rows[0].amount === 'USD 19.99' &&
  rows[0].handler === 'STRIPE' && rows[0].date === '9/29/2026', rows[0]);
check('a CHARGE row with an eye is refundable', isRefundable(rows[0]));
check('a non-CHARGE row is not refundable', !isRefundable(rows[2]));

const moved = scrapeCharges(makeTable(['Order Number', 'Date', 'Total Amount', 'Transaction Type', 'Action'], [
  ['ch_ZZZ', '1/1/2026', 'CAD 9.99', 'CHARGE', '']
]));
check('a reordered header still lands each value in its field', moved[0].order === 'ch_ZZZ' &&
  moved[0].amount === 'CAD 9.99' && moved[0].type === 'CHARGE', moved[0]);

const empty = scrapeCharges(makeTable(HEADERS, [['No data found']]));
check('"No data found" is not a charge', empty.length === 0, empty);

const noEyeCells = ['1/1/2026', 'Monthly Plan', 'CHARGE', 'ch_NOEYE', 'USD 5.00', 'STRIPE', 'N/A', ''];
noEyeCells.hasEye = false;
const noEye = scrapeCharges(makeTable(HEADERS, [noEyeCells]));
check('a charge without an eye button is not refundable', noEye.length === 1 && !isRefundable(noEye[0]), noEye);

// ------------------------------------------------------------------ totals

check('parses "USD 19.99"', JSON.stringify(parseAmount('USD 19.99')) === JSON.stringify({ currency: 'USD', value: 19.99 }), parseAmount('USD 19.99'));
check('parses thousands separators', parseAmount('USD 1,299.50').value === 1299.5, parseAmount('USD 1,299.50'));
check('sums one currency', formatTotal([{ amount: 'USD 19.99' }, { amount: 'USD 19.99' }]) === 'USD 39.98',
  formatTotal([{ amount: 'USD 19.99' }, { amount: 'USD 19.99' }]));
check('never adds two currencies together',
  formatTotal([{ amount: 'USD 10.00' }, { amount: 'CAD 5.00' }]) === 'USD 10.00 + CAD 5.00',
  formatTotal([{ amount: 'USD 10.00' }, { amount: 'CAD 5.00' }]));

// ------------------------------------------------------------------ plan card

// Line order read live from the MSN account's plan card on 2026-09-30.
const cardLines = ['Monthly', 'CANCEL', 'REVERT', 'Plan Name', 'Monthly Plan', 'Price', 'USD 19.99', 'Status',
  'DEFERRED_CANCELLATION', 'Country', 'US', 'End Date', '10/29/26', '6:47:20 PM GMT-6', 'Apply Offer', '​', 'APPLY'];
const cancelBtn = button('Cancel');
const card = {
  innerText: cardLines.join('\n'),
  querySelectorAll: () => [cancelBtn, button('Revert'), button('Apply')]
};
const plan = readPlanCard(card);
check('reads the plan name after its label', plan.name === 'Monthly Plan', plan.name);
check('reads the status after its label', plan.status === 'DEFERRED_CANCELLATION', plan.status);
check('reads the end date after its label', plan.endDate === '10/29/26', plan.endDate);
check('finds the enabled CANCEL button', plan.cancelButton === cancelBtn);
const disabledPlan = readPlanCard({ innerText: cardLines.join('\n'), querySelectorAll: () => [button('Cancel', true)] });
check('a disabled CANCEL is no cancel button', disabledPlan.cancelButton === null);

// ------------------------------------------------------------------ note

const charge = { date: '9/29/2026', title: 'Monthly Plan', order: 'ch_AAA', amount: 'USD 19.99', handler: 'STRIPE' };
const charge2 = { date: '8/29/2026', title: 'Monthly Plan', order: 'ch_BBB', amount: 'USD 19.99', handler: 'STRIPE' };
const ticket = 'https://viewlift.freshdesk.com/a/tickets/361631';

const okNote = buildNote({
  dryRun: false, cancelOk: true,
  cancelLines: ['Account cancelled now (Monthly Plan) - status: CANCELLED'],
  done: [charge, charge2], failed: [], skipped: []
}).map(line => line.text);
check('note leads with the cancellation', okNote[0] === 'Account cancelled now (Monthly Plan) - status: CANCELLED', okNote);
check('note lists every refunded charge, one short line each', okNote[1] === 'Refunded (100%):' &&
  okNote[2] === '9/29/2026 - USD 19.99 - ch_AAA' && okNote[3] === '8/29/2026 - USD 19.99 - ch_BBB', okNote);
check('note carries the total when there is more than one', okNote[4] === 'Total: USD 39.98', okNote);
check('note is short: no tool name, no links, nothing else', okNote.length === 5 &&
  !okNote.some(t => /refund assist|https?:/i.test(t)), okNote);

const single = buildNote({ dryRun: false, cancelOk: true, cancelLines: ['x'], done: [charge], failed: [], skipped: [] }).map(l => l.text);
check('one refund has no separate total line', !single.some(t => t.startsWith('Total')), single);

const partial = buildNote({
  dryRun: false, cancelOk: true, cancelLines: ['x'],
  done: [charge], failed: [{ charge: charge2, reason: 'Refund dialog still open' }], skipped: [{ date: '7/1', order: 'ch_DDD', amount: 'USD 1.00' }]
}).map(line => line.text);
check('a failed refund is listed with its reason', partial.includes('8/29/2026 - USD 19.99 - failed: Refund dialog still open'), partial);
check('charges after the failure are listed as not done', partial.includes('7/1 - USD 1.00 - not done'), partial);
check('a failed charge is not listed as refunded', !partial.some(t => t.includes('ch_BBB')), partial);

const cancelFailed = buildNote({
  dryRun: false, cancelOk: false, cancelLines: [],
  done: [], failed: [], skipped: [charge]
}).map(line => line.text);
check('a failed cancel says no refund was issued', cancelFailed[0] === 'Cancellation failed - no refunds issued', cancelFailed);
check('a failed cancel has no "Refunded" block', !cancelFailed.includes('Refunded (100%):'), cancelFailed);

const dry = buildNote({
  dryRun: true, cancelOk: true, cancelLines: ['Would cancel now: Monthly Plan (status ACTIVE)'],
  done: [charge], failed: [], skipped: []
}).map(line => line.text);
check('a dry run says so first', dry[0] === 'DRY RUN - nothing was cancelled or refunded', dry[0]);
check('a dry run never says "Refunded"', !dry.includes('Refunded (100%):') && dry.includes('Refunds prepared (100%):'), dry);

// ------------------------------------------------------------------ order pin

function triggerIn(text) {
  const scope = { innerText: text, textContent: text };
  return { closest: () => scope };
}
workflowCtx.setOrder('');
check('a hand-started run is not pinned', workflowCtx.triggerMatchesExpectedOrder(triggerIn('anything')));
workflowCtx.setOrder('ch_AAA');
check('the pinned order in the drawer passes', workflowCtx.triggerMatchesExpectedOrder(triggerIn('Details Completed Order Number ch_AAA Plan')));
check('a stale drawer for another order is refused', !workflowCtx.triggerMatchesExpectedOrder(triggerIn('Details Completed Order Number ch_BBB Plan')));
check('a Refund button outside any drawer is refused', !workflowCtx.triggerMatchesExpectedOrder({ closest: () => null }));

// ------------------------------------------------------------------ Freshdesk API

const html = noteLinesToHtml([{ text: 'Refunded (100%):', bold: true }, { text: '<img src=x onerror=alert(1)> & co' }]);
check('note HTML bolds headings and joins lines with <br>', html.startsWith('<div><strong>Refunded (100%):</strong><br>'), html);
check('note HTML escapes whatever came off the page', html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; co') &&
  !html.includes('<img'), html);

// The B2C Account Refunded definition read live on 2026-09-30.
const applied = scenarioActionsToUpdate(REFUNDED_SCENARIO_FALLBACK_ACTIONS, { tags: ['B2C_automation_question'] }, 43000111);
check('scenario status becomes a number', applied.update.status === 12, applied.update);
check('scenario ticket_type becomes type', applied.update.type === 'Refund', applied.update);
check('add_tag keeps the ticket\'s existing tags',
  JSON.stringify(applied.update.tags) === JSON.stringify(['B2C_automation_question', 'Refunded']), applied.update.tags);
check('responder -2 means the agent running it', applied.update.responder_id === 43000111, applied.update);
check('the customer reply is never sent through the API',
  applied.skipped.includes('add_reply') && !('add_reply' in applied.update), applied);

const again = scenarioActionsToUpdate([{ name: 'add_tag', value: 'Refunded' }], { tags: ['refunded'] }, 1);
check('a tag already on the ticket is not added twice', !('tags' in again.update), again.update);
const custom = scenarioActionsToUpdate([{ name: 'cf_platform_976229', value: 'ALL' }], { tags: [] }, 1);
check('cf_<name>_<account> becomes custom_fields.cf_<name>',
  custom.update.custom_fields && custom.update.custom_fields.cf_platform === 'ALL', custom.update);
const noMe = scenarioActionsToUpdate([{ name: 'responder_id', value: '-2' }], { tags: [] }, undefined);
check('"assign to me" with no agent id is skipped, never sent as -2',
  !('responder_id' in noMe.update) && noMe.skipped.includes('responder_id'), noMe);

const requestSrc = extractFunction(fullSrc, 'freshdeskApiRequest');
check('the API key only ever goes to viewlift.freshdesk.com',
  requestSrc.includes('url: `https://viewlift.freshdesk.com${path}`') && !requestSrc.includes('https://${location.hostname}'));

console.log(`\n${passed} passed, ${failed} failed`);
if (!failed) console.log('All checks passed against the shipped source.');
process.exit(failed ? 1 : 0);
