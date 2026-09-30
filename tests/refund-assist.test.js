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
  Object.assign(ctx, { scrapeCharges, isRefundable, parseAmount, formatTotal, readPlanCard, buildNote });
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

const { scrapeCharges, isRefundable, parseAmount, formatTotal, readPlanCard, buildNote } = context;

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
  dryRun: false, ticketURL: ticket, cancelOk: true,
  cancelLines: ['Monthly Plan cancelled with Cancel Now - status: CANCELLED'],
  done: [charge, charge2], failed: [], skipped: []
}).map(line => line.text);
check('note leads with the cancellation', okNote.indexOf('Cancellation:') === 1 &&
  okNote[2].includes('cancelled with Cancel Now'), okNote);
check('note lists every refunded charge', okNote.includes('Refunds issued (100%):') &&
  okNote.some(t => t.includes('ch_AAA') && t.includes('USD 19.99')) && okNote.some(t => t.includes('ch_BBB')), okNote);
check('note carries the total', okNote.includes('Total refunded: USD 39.98'), okNote);
check('a real run is not labelled dry run', !okNote[0].includes('DRY RUN'), okNote[0]);
check('note links the CMS account and the ticket', okNote.some(t => t.startsWith('CMS: https://cms.')) &&
  okNote.includes('Ticket: ' + ticket), okNote);

const partial = buildNote({
  dryRun: false, ticketURL: ticket, cancelOk: true, cancelLines: ['x'],
  done: [charge], failed: [{ charge: charge2, reason: 'Refund dialog still open' }], skipped: [{ date: '7/1', order: 'ch_DDD', amount: 'USD 1.00' }]
}).map(line => line.text);
check('a failed refund is listed with its reason', partial.some(t => t.includes('ch_BBB') && t.includes('failed: Refund dialog still open')), partial);
check('charges after the failure are listed as skipped', partial.some(t => t.includes('ch_DDD') && t.includes('skipped')), partial);
check('the total only counts what was refunded', partial.includes('Total refunded: USD 19.99'), partial);

const cancelFailed = buildNote({
  dryRun: false, ticketURL: ticket, cancelOk: false, cancelLines: [],
  done: [], failed: [], skipped: [charge]
}).map(line => line.text);
check('a failed cancel says no refund was issued', cancelFailed.some(t => /Cancellation: FAILED - no refunds were issued/.test(t)), cancelFailed);
check('a failed cancel has no "Refunds issued" block', !cancelFailed.includes('Refunds issued (100%):'), cancelFailed);

const dry = buildNote({
  dryRun: true, ticketURL: ticket, cancelOk: true, cancelLines: ['[dry run] Would cancel Monthly Plan'],
  done: [charge], failed: [], skipped: []
}).map(line => line.text);
check('a dry run says so in the heading', dry[0].includes('DRY RUN'), dry[0]);
check('a dry run never says "Refunds issued"', !dry.includes('Refunds issued (100%):') &&
  dry.includes('Refunds prepared (100%, not confirmed):'), dry);

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

console.log(`\n${passed} passed, ${failed} failed`);
if (!failed) console.log('All checks passed against the shipped source.');
process.exit(failed ? 1 : 0);
