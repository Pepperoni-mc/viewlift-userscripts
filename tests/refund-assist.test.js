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
  const REFUND_MATCH_CHARS = 16;
  ${extractFunction(assistSrc, 'markRefundedCharges')}
  ${extractFunction(assistSrc, 'firstNameOf')}
  ${extractFunction(assistSrc, 'parseAmount')}
  ${extractFunction(assistSrc, 'formatTotal')}
  ${extractFunction(assistSrc, 'formatRefundAmount')}
  ${extractFunction(assistSrc, 'isRefundRecord')}
  ${extractFunction(assistSrc, 'refundRecordFor')}
  ${extractFunction(assistSrc, 'recordToRow')}
  ${extractFunction(assistSrc, 'readPlanCard')}
  ${extractFunction(assistSrc, 'buildNote')}
  ${extractFunction(assistSrc, 'escapeHtml')}
  ${extractFunction(assistSrc, 'noteLinesToHtml')}
  ${extractFunction(assistSrc, 'lineToHtml')}
  ${extractFunction(assistSrc, 'noteToHtml')}
  ${extractFunction(assistSrc, 'noteToText')}
  ${extractFunction(assistSrc, 'chargeCells')}
  function isCMSHost(h) { return /^cms.monumentalsportsnetwork.com$/.test(h); }
  ${extractFunction(assistSrc, 'scenarioActionsToUpdate')}
  ${extractArray(assistSrc, 'REFUNDED_SCENARIO_FALLBACK_ACTIONS')}
  Object.assign(ctx, { isRefundRecord, refundRecordFor, recordToRow, formatRefundAmount, firstNameOf, markRefundedCharges, scrapeCharges, isRefundable, parseAmount, formatTotal, readPlanCard, buildNote,
    noteLinesToHtml, noteToHtml, noteToText, scenarioActionsToUpdate, REFUNDED_SCENARIO_FALLBACK_ACTIONS });
`);
loader(context, undefined);

const workflowCtx = {};
new Function('ctx', `
  let expectedOrder = '';
  ${extractFunction(workflowSrc, 'cleanText')}
  ${extractFunction(workflowSrc, 'triggerMatchesExpectedOrder')}
  ${extractFunction(workflowSrc, 'textHasOrder')}
  ctx.setOrder = value => { expectedOrder = value; };
  ctx.triggerMatchesExpectedOrder = triggerMatchesExpectedOrder;
`)(workflowCtx);

const { isRefundRecord, refundRecordFor, recordToRow, formatRefundAmount, firstNameOf, markRefundedCharges, scrapeCharges, isRefundable, parseAmount, formatTotal, readPlanCard, buildNote,
  noteLinesToHtml, noteToHtml, noteToText, scenarioActionsToUpdate, REFUNDED_SCENARIO_FALLBACK_ACTIONS } = context;

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

// The refund log's Amount Refunded, as the team types repeat charges by hand.
check('one refund is just its amount', formatRefundAmount([{ amount: 'USD 19.99' }]) === 'USD 19.99', formatRefundAmount([{ amount: 'USD 19.99' }]));
check('two of the same amount -> "x2"', formatRefundAmount([{ amount: 'USD 19.99' }, { amount: 'USD 19.99' }]) === 'USD 19.99 x2',
  formatRefundAmount([{ amount: 'USD 19.99' }, { amount: 'USD 19.99' }]));
check('different amounts are listed, never summed', formatRefundAmount([{ amount: 'USD 19.99' }, { amount: 'USD 9.99' }, { amount: 'USD 19.99' }]) === 'USD 19.99 x2 + USD 9.99',
  formatRefundAmount([{ amount: 'USD 19.99' }, { amount: 'USD 9.99' }, { amount: 'USD 19.99' }]));

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
check('reads the bare heading as the billing cycle', plan.cycle === 'Monthly', plan.cycle);
check('reads the price after its label', plan.price === 'USD 19.99', plan.price);
const noCycle = readPlanCard({ innerText: ['Plan Name', 'Weird Plan', 'Status', 'ACTIVE'].join('\n'), querySelectorAll: () => [] });
check('a card without a cycle heading reports no cycle', noCycle.cycle === '', noCycle);
const disabledPlan = readPlanCard({ innerText: cardLines.join('\n'), querySelectorAll: () => [button('Cancel', true)] });
check('a disabled CANCEL is no cancel button', disabledPlan.cancelButton === null);

// ------------------------------------------------------------------ note

// Modelled on the note Sebastian pasted as the target (2026-09-30).
const CMS_URL = 'https://cms.monumentalsportsnetwork.com/users/search/96a60516-4889-4c51-937d-620875cbc005';
const annualPlan = { name: 'Annual Plan', cycle: 'Yearly', price: 'USD 179.99', status: 'CANCELLED' };
const refundRow = { date: '9/30/2026', title: 'Annual Plan', type: 'REFUND', order: 're_3UL9b7JtJXFjDDk501KK4Zho', amount: 'USD 179.99', handler: 'STRIPE', offer: 'N/A' };
const charge = { date: '9/29/2026', title: 'Annual Plan', type: 'CHARGE', order: 'ch_3UL9b7JtJXFjDDk50hpPSre8', amount: 'USD 179.99', handler: 'STRIPE', offer: 'N/A', refundRow };
const charge2 = { date: '8/29/2026', title: 'Annual Plan', type: 'CHARGE', order: 'ch_BBB', amount: 'USD 19.99', handler: 'STRIPE', offer: 'N/A' };

const okNote = buildNote({ dryRun: false, cancelOk: true, plan: annualPlan, cmsUrl: CMS_URL, done: [charge], failed: [], skipped: [] });
const okLines = okNote.lines.map(line => line.text);
check('note opens with the plan name in brackets, then the CMS link', okLines[0] === '(Annual Plan)' &&
  okLines[1] === 'CMS: ' + CMS_URL && okNote.lines[1].href === CMS_URL, okLines);
check('note has the Subscription details block in the asked order',
  JSON.stringify(okLines.slice(2)) === JSON.stringify(['Subscription details', 'Billing Cycle: Yearly',
    'Plan Name: Annual Plan', 'Price: USD 179.99', 'Status: CANCELLED']) && okNote.lines[2].bold === true, okLines);
check('the table has the REFUND row (re_ id) above its CHARGE row', JSON.stringify(okNote.rows) === JSON.stringify([
  ['9/30/2026', 'Annual Plan', 'REFUND', 're_3UL9b7JtJXFjDDk501KK4Zho', 'USD 179.99', 'STRIPE', 'N/A'],
  ['9/29/2026', 'Annual Plan', 'CHARGE', 'ch_3UL9b7JtJXFjDDk50hpPSre8', 'USD 179.99', 'STRIPE', 'N/A']
]), okNote.rows);
check('a clean run has nothing below the table', okNote.after.length === 0, okNote.after);
check('no tool name anywhere in the note', !okLines.some(t => /refund assist/i.test(t)), okLines);

const text = noteToText(okNote);
check('clipboard copy is the lines, a blank line, then tab-separated rows', text.startsWith('(Annual Plan)\nCMS: ') &&
  text.includes('Status: CANCELLED\n\n9/30/2026\tAnnual Plan\tREFUND\tre_3UL9b7JtJXFjDDk501KK4Zho\tUSD 179.99\tSTRIPE\tN/A\n9/29/2026\t'), text);

const noteHtml = noteToHtml(okNote);
check('note HTML links the CMS account', noteHtml.includes(`CMS: <a href="${CMS_URL}"`), noteHtml);
check('note HTML renders the rows as a table', /<table[^>]*><tbody><tr><td[^>]*>9\/30\/2026/.test(noteHtml) &&
  /<td[^>]*>re_3UL9b7JtJXFjDDk501KK4Zho/.test(noteHtml), noteHtml);
// Live 2026-09-30: Freshdesk kept the bare <table> but the columns ran together.
check('table cells carry their own padding and a trailing gap', /<td style="padding:[^"]+">9\/30\/2026&nbsp;/.test(noteHtml), noteHtml);
const offHost = noteToHtml({ lines: [{ text: 'CMS: https://evil.example/x', href: 'https://evil.example/x' }], rows: [], after: [] });
check('only a CMS host ever becomes a link', !offHost.includes('<a '), offHost);

const noRefundYet = buildNote({ dryRun: false, cancelOk: true, plan: annualPlan, cmsUrl: CMS_URL,
  done: [charge2], failed: [], skipped: [] });
// 2026-09-30: no "Refund row not shown in CMS yet" line in the ticket any
// more - the run keeps refreshing instead, and the panel reports a miss.
check('a refund CMS never listed keeps its charge row, with no warning in the note', noRefundYet.rows.length === 1 &&
  noRefundYet.after.length === 0, noRefundYet);

const partial = buildNote({
  dryRun: false, cancelOk: true, plan: annualPlan, cmsUrl: CMS_URL,
  done: [charge], failed: [{ charge: charge2, reason: 'Refund dialog still open' }],
  skipped: [{ date: '7/1', order: 'ch_DDD', amount: 'USD 1.00' }]
});
const partialAfter = partial.after.map(line => line.text);
check('a failed refund is listed below the table with its reason',
  partialAfter.includes('8/29/2026 - USD 19.99 - ch_BBB - failed: Refund dialog still open'), partialAfter);
check('charges after the failure are listed as not done', partialAfter.includes('7/1 - USD 1.00 - ch_DDD - not done'), partialAfter);
check('a failed charge is not in the table', !partial.rows.some(cells => cells.includes('ch_BBB')), partial.rows);

const cancelFailed = buildNote({ dryRun: false, cancelOk: false, plan: null, cmsUrl: CMS_URL, done: [], failed: [], skipped: [charge] });
check('a failed cancel says no refund was issued', cancelFailed.lines[0].text === 'Cancellation failed - no refunds issued', cancelFailed.lines);
check('a failed cancel has an empty table', cancelFailed.rows.length === 0, cancelFailed.rows);

const dry = buildNote({ dryRun: true, cancelOk: true, plan: annualPlan, cmsUrl: CMS_URL, done: [charge2], failed: [], skipped: [] });
check('a dry run says so first', dry.lines[0].text === 'DRY RUN - nothing was cancelled or refunded', dry.lines[0]);
check('a dry run does not complain about missing refund ids', dry.after.length === 0, dry.after);

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

// 2026-10-01: Google Play renewals are prefixes of each other, and the drawer's
// text runs "Order NumberGPA..." with no separator in front.
workflowCtx.setOrder('GPA.3303-1537-6618-70405');
check('a renewal drawer (..0) does not pass for the base order',
  !workflowCtx.triggerMatchesExpectedOrder(triggerIn('Details Completed Order NumberGPA.3303-1537-6618-70405..0 Plan')));
check('the base order drawer passes, with no separator in front',
  workflowCtx.triggerMatchesExpectedOrder(triggerIn('Details Completed Order NumberGPA.3303-1537-6618-70405 Plan')));
workflowCtx.setOrder('GPA.3303-1537-6618-70405..1');
check('..1 does not pass for ..10',
  !workflowCtx.triggerMatchesExpectedOrder(triggerIn('Order NumberGPA.3303-1537-6618-70405..10')));
check('..1 passes for ..1', workflowCtx.triggerMatchesExpectedOrder(triggerIn('Order NumberGPA.3303-1537-6618-70405..1\nPlan')));

// ------------------------------------------------------------------ already refunded

// The live table right after Sebastian's real run, 2026-09-30.
const afterRun = markRefundedCharges(scrapeCharges(makeTable(HEADERS, [
  ['9/30/2026', 'Monthly Plan', 'REFUND', 're_3ULBgIJtJXFjDDk50gHhfbdI', 'USD 19.99', 'STRIPE', 'N/A', ''],
  ['9/29/2026', 'Monthly Plan', 'CHARGE', 'ch_3ULBgIJtJXFjDDk50HJk2L25', 'USD 19.99', 'STRIPE', 'N/A', ''],
  ['4/22/2026', 'Monthly Plan', 'CHARGE', 'ch_3TPDpmJtJXFjDDk50HeBD874', 'USD 19.99', 'STRIPE', 'N/A', ''],
  ['3/22/2026', 'Monthly Plan', 'CHARGE', 'ch_3TDyqRJtJXFjDDk51pz5PzRT', 'USD 19.99', 'STRIPE', 'N/A', '']
])));
check('a charge with a matching REFUND row is marked refunded', afterRun[1].refundedBy === 're_3ULBgIJtJXFjDDk50gHhfbdI', afterRun[1]);
check('an already-refunded charge cannot be picked again', !isRefundable(afterRun[1]));
check('the other charges stay refundable (shared account suffix is not a match)',
  isRefundable(afterRun[2]) && isRefundable(afterRun[3]) && !afterRun[2].refundedBy, afterRun.slice(2));

// Google Play (live, cms-gcp, 2026-09-30): the REFUND row reuses the charge's order number.
const gpa = markRefundedCharges(scrapeCharges(makeTable(HEADERS, [
  ['9/30/2026', 'Monthly Plan', 'REFUND', 'GPA.3393-7153-0266-92083..5', 'USD 19.99', 'ANDROID', 'N/A', ''],
  ['9/26/2026', 'Monthly Plan', 'CHARGE', 'GPA.3393-7153-0266-92083..5', 'USD 19.99', 'ANDROID', 'N/A', ''],
  ['8/26/2026', 'Monthly Plan', 'CHARGE', 'GPA.3393-7153-0266-92083..4', 'USD 19.99', 'ANDROID', 'N/A', '']
])));
check('a Google Play charge pairs with the REFUND row that has its own order number',
  gpa[1].refundedRow === gpa[0] && gpa[1].refundedRow.type === 'REFUND', gpa[1]);
check('the paired refund row is the REFUND, not the charge itself', gpa[1].refundedRow !== gpa[1]);
check('the next Google Play charge (..4) is not paired with ..5', !gpa[2].refundedBy && isRefundable(gpa[2]), gpa[2]);
check('Stripe pairing still stores the REFUND row', afterRun[1].refundedRow === afterRun[0], afterRun[1]);

// ------------------------------------------------------------------ account contact

check('first name only', firstNameOf('John Vera') === 'John', firstNameOf('John Vera'));
check('accented names survive', firstNameOf('José Pérez') === 'José', firstNameOf('José Pérez'));
check('no name -> no greeting change', firstNameOf('') === '' && firstNameOf('   ') === '');
check('an email in the name field is not a name', firstNameOf('john@x.com') === '', firstNameOf('john@x.com'));
check('an initial is not a name', firstNameOf('J.') === '' && firstNameOf('J') === '', firstNameOf('J.'));

// ------------------------------------------------------------------ CMS API mode

// Billing-history records, shaped as /v3/billing/history returns them (2026-10-01).
const records = [
  { transactiontype: 'REFUND', gatewayChargeId: 'ch_3ULBgIJtJXFjDDk50HJk2L25', gatewayRefundId: 're_3ULBgIJtJXFjDDk50gHhfbdI', totalAmount: 19.99, currencyCode: 'USD', planTitle: 'Monthly Plan', paymentHandler: 'STRIPE', completedAt: '2026-10-01T15:00:00Z' },
  { transactiontype: 'CHARGE', gatewayChargeId: 'ch_3ULBgIJtJXFjDDk50HJk2L25', totalAmount: 19.99, currencyCode: 'USD', planTitle: 'Monthly Plan', paymentHandler: 'STRIPE' },
  { transactiontype: 'REFUND', gatewayChargeId: 'GPA.3358-3903-1484-26377', gatewayRefundId: '', totalAmount: 21.34, currencyCode: 'USD', planTitle: 'Monthly Plan (Monumental+)', paymentHandler: 'ANDROID', completedAt: '2026-10-01T15:00:00Z' },
  { transactiontype: 'CHARGE', gatewayChargeId: 'GPA.3303-1537-6618-70405..0', totalAmount: 19.99, currencyCode: 'USD', planTitle: 'Monthly Plan', paymentHandler: 'ANDROID' }
];
check('a REFUND record is recognised by its transaction type', isRefundRecord(records[0]) && !isRefundRecord(records[1]));
check('a Stripe charge finds its REFUND by gatewayChargeId', refundRecordFor(records, 'ch_3ULBgIJtJXFjDDk50HJk2L25') === records[0]);
check('a Google Play charge finds its REFUND (same number)', refundRecordFor(records, 'GPA.3358-3903-1484-26377') === records[2]);
check('an unrefunded charge finds none - so it is refunded once', refundRecordFor(records, 'GPA.3303-1537-6618-70405..0') === null);
check('a prefix of a refunded order is not taken for it', refundRecordFor(records, 'GPA.3358-3903-1484') === null);
const row = recordToRow(records[0], { title: 'Monthly Plan', order: 'ch_x', amount: 'USD 19.99', handler: 'STRIPE', offer: 'N/A' });
check('the note row carries the refund id, not the charge id', row.order === 're_3ULBgIJtJXFjDDk50gHhfbdI', row);
check('and the table-style amount', row.amount === 'USD 19.99', row.amount);
check('and type REFUND', row.type === 'REFUND');
const gpaRow = recordToRow(records[2], { title: 'N/A', order: 'GPA.3358-3903-1484-26377', amount: 'USD 21.34', handler: 'ANDROID' });
check('a refund with no separate refund id keeps the shared order number', gpaRow.order === 'GPA.3358-3903-1484-26377', gpaRow);

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
