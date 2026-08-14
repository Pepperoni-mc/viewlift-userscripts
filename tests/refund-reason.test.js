// Checks how the CMS Percentage Refund workflow reads and sets the "Refund
// Reason" MUI Select - the field that kept coming back empty and stalled the
// whole auto-submit. Pulls the real helpers out of the shipped userscript so
// this cannot drift from what actually runs.
//
// The DOM here is a trimmed copy of the real "Issue percentage refund" dialog
// (pasted from live CMS on 2026-08-14), and the element shim below implements
// only the selector forms these helpers actually use. It is a shim, not a
// browser: it pins the decision logic (which source of truth wins, what gets
// dispatched, in what order), NOT whether MUI reacts - that part is only ever
// provable live.
//
// Run with: node tests/refund-reason.test.js
const fs = require('fs');
const path = require('path');
const fullSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'better-viewlift.user.js'), 'utf8');

// Several features in the userscript declare their own cleanText/getText/
// isVisible inside their own IIFE. Extraction must be scoped to the refund
// feature or it silently picks up an earlier feature's copy - which is exactly
// what happened the first time this test ran, and it hid the zero-width fix.
const FEATURE_MARKER = 'Feature 3: CMS Percentage Refund Workflow';
const featureStart = fullSrc.indexOf(FEATURE_MARKER);
if (featureStart === -1) throw new Error('could not find the refund feature: ' + FEATURE_MARKER);
const src = fullSrc.slice(featureStart);

function extractFunction(pattern, name) {
  const idx = src.search(pattern);
  if (idx === -1) throw new Error('could not find ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', idx); j < src.length; j++) {
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

// ---------------------------------------------------------------- DOM shim

class FakeEvent {
  constructor(type) { this.type = type; }
}

class FakeInputBase {
  get value() { return this._v === undefined ? '' : this._v; }
  set value(next) { this._v = String(next); }
}

let dispatched = [];

class El {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag.toLowerCase();
    this.attrs = attrs;
    this.children = children;
    this.own = '';
    children.forEach(child => { child.parent = this; });
    this.parent = null;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  get innerText() {
    return [this.own, ...this.children.map(child => child.innerText)].filter(Boolean).join(' ');
  }

  get textContent() { return this.innerText; }

  // Supports exactly what the helpers under test use: comma-separated lists of
  // `tag`, `.class`, `[attr="value"]` and combinations of the three.
  matches(selector) {
    return selector.split(',').map(s => s.trim()).filter(Boolean).some(part => {
      const tagMatch = part.match(/^[a-z][a-z0-9]*/i);
      if (tagMatch && tagMatch[0].toLowerCase() !== this.tag) return false;
      const classes = String(this.attrs.class || '').split(/\s+/);
      for (const cls of part.match(/\.[\w-]+/g) || []) {
        if (!classes.includes(cls.slice(1))) return false;
      }
      for (const attr of part.match(/\[[^\]]+\]/g) || []) {
        const inner = attr.slice(1, -1);
        const eq = inner.match(/^([\w-]+)="([^"]*)"$/);
        if (eq) { if (this.getAttribute(eq[1]) !== eq[2]) return false; }
        else if (this.getAttribute(inner) === null) return false;
      }
      return true;
    });
  }

  descendants() {
    return this.children.flatMap(child => [child, ...child.descendants()]);
  }

  querySelector(selector) {
    return this.descendants().find(node => node.matches(selector)) || null;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parent;
    }
    return null;
  }

  dispatchEvent(event) { dispatched.push(event.type); return true; }
  focus() {}
  getBoundingClientRect() { return { width: 120, height: 32 }; }
}

class Input extends El {
  constructor(attrs = {}) {
    super('input', attrs);
    this.value = attrs.value === undefined ? '' : attrs.value;
  }
}
Object.defineProperty(Input.prototype, 'value', {
  get() { return this._v === undefined ? '' : this._v; },
  set(next) { this._v = String(next); },
  configurable: true
});

const ZWSP = '​';

// The real dialog, trimmed to what the reason helpers touch. Note the two
// details that broke things live: the reason Select has NO .MuiFormControl-root
// wrapper (the label is a sibling inside a MuiStack), and an unselected Select
// renders a zero-width space rather than empty text.
function buildDialog(nativeValue = '', comboText = ZWSP) {
  const combobox = new El('div', {
    tabindex: '0', role: 'combobox', 'aria-expanded': 'false',
    'aria-haspopup': 'listbox', class: 'MuiSelect-select MuiSelect-outlined MuiInputBase-input'
  });
  combobox.own = comboText;

  const nativeInput = new Input({
    'aria-hidden': 'true', tabindex: '-1', class: 'MuiSelect-nativeInput', value: nativeValue
  });
  nativeInput._valueTracker = { value: nativeValue, setValue(v) { this.value = v; } };

  const label = new El('label', { class: 'MuiFormLabel-root MuiInputLabel-root', id: 'reasonLabel' });
  label.own = 'Refund Reason *';

  const select = new El('div', { class: 'MuiInputBase-root MuiOutlinedInput-root MuiSelect-root' },
    [combobox, nativeInput]);
  const reasonStack = new El('div', { class: 'MuiStack-root' }, [label, select]);

  const title = new El('h6', { class: 'MuiTypography-root MuiTypography-h6' });
  title.own = 'Issue percentage refund';

  const body = new El('div', { class: 'MuiStack-root' }, [reasonStack]);
  const dialog = new El('div', { role: 'dialog', class: 'MuiPaper-root' }, [title, body]);
  return { dialog, combobox, nativeInput };
}

// ------------------------------------------------------- helpers under test

// getRefundTrigger/isPercentageRefundOption search the whole document, so the
// sandbox needs one. It is backed by a tree built per assertion.
const docRoot = { current: new El('div', {}, []) };
const fakeDocument = {
  documentElement: { dataset: {} },
  querySelectorAll: sel => docRoot.current.descendants().filter(n => n.matches(sel)),
  querySelector: sel => docRoot.current.descendants().find(n => n.matches(sel)) || null
};

const sandbox = [
  extractConst(/const REFUND_REASON_VALUE = .*;/, 'REFUND_REASON_VALUE'),
  // Debug output is deliberately stubbed: this test is about the decisions,
  // and the real debugLog reads GM storage that does not exist under node.
  'function debugLog() {}',
  'function debugState() {}',
  'function readFlag() { return false; }',
  extractFunction(/function cleanText/, 'cleanText'),
  extractFunction(/\n    function getText/, 'getText'),
  extractFunction(/\n    function isVisible/, 'isVisible'),
  extractFunction(/function getReasonCurrentText/, 'getReasonCurrentText'),
  extractFunction(/function isReasonAlreadyROTH/, 'isReasonAlreadyROTH'),
  extractFunction(/function getReasonNativeInput/, 'getReasonNativeInput'),
  extractFunction(/function writeReasonNativeValue/, 'writeReasonNativeValue'),
  extractFunction(/function isRefundActionIconClick/, 'isRefundActionIconClick'),
  extractFunction(/function getRefundTrigger/, 'getRefundTrigger'),
  extractFunction(/function isPercentageRefundOption/, 'isPercentageRefundOption'),
  `module.exports = { cleanText, getText, getReasonCurrentText, isReasonAlreadyROTH,
     getReasonNativeInput, writeReasonNativeValue, isRefundActionIconClick,
     getRefundTrigger, isPercentageRefundOption, REFUND_REASON_VALUE };`
].join('\n');

const fakeWindow = { HTMLInputElement: Input, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) };
const mod = { exports: {} };
new Function('module', 'window', 'Event', 'document', sandbox)(mod, fakeWindow, FakeEvent, fakeDocument);
const {
  cleanText, getReasonCurrentText, isReasonAlreadyROTH,
  getReasonNativeInput, writeReasonNativeValue, isRefundActionIconClick,
  getRefundTrigger, isPercentageRefundOption, REFUND_REASON_VALUE
} = mod.exports;

// ------------------------------------------------------------------ checks

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check('the shipped reason value is still ROTH', REFUND_REASON_VALUE, 'ROTH');

// cleanText: MUI's empty-Select placeholder must not read as content.
check('a zero-width space reads as empty', cleanText(ZWSP), '');
check('a zero-width joiner reads as empty', cleanText('‍﻿'), '');
check('real text still survives', cleanText('  ROTH -  Other/Did not say '), 'ROTH - Other/Did not say');

// Reading the current selection.
check('an unselected reason reads as empty',
  getReasonCurrentText(buildDialog('', ZWSP).dialog), '');
check('an unselected reason is not treated as ROTH',
  isReasonAlreadyROTH(buildDialog('', ZWSP).dialog), false);
check('the hidden native input is the source of truth when set',
  getReasonCurrentText(buildDialog('ROTH', ZWSP).dialog), 'ROTH');
check('a set reason is recognised',
  isReasonAlreadyROTH(buildDialog('ROTH', ZWSP).dialog), true);
check('the visible combobox text is the fallback when the input is empty',
  getReasonCurrentText(buildDialog('', 'ROTH - Other/Did not say').dialog), 'ROTH - Other/Did not say');
check('a different selected reason is not mistaken for ROTH',
  isReasonAlreadyROTH(buildDialog('RDUP', 'RDUP - Duplicate charge').dialog), false);

// Finding the hidden input.
check('the hidden input is found inside the dialog',
  getReasonNativeInput(buildDialog().dialog) !== null, true);
check('a dialog without a MUI Select yields no hidden input',
  getReasonNativeInput(new El('div', { role: 'dialog' }, [])) === null, true);

// Writing the value - the path that replaced click-driven selection.
const written = buildDialog();
dispatched = [];
check('writing the reason reports success', writeReasonNativeValue(written.dialog, 'ROTH'), true);
check('the value lands on the hidden input', written.nativeInput.value, 'ROTH');
// React only sees a change when its own value tracker is rewound first - this
// is the single most fragile line in the fix.
check('React\'s value tracker was rewound to the previous value',
  written.nativeInput._valueTracker.value, '');
check('input fires before change', dispatched, ['input', 'change']);

dispatched = [];
check('writing without a hidden input fails loudly rather than silently',
  writeReasonNativeValue(new El('div', { role: 'dialog' }, []), 'ROTH'), false);
check('nothing is dispatched when there is no field', dispatched, []);

// The eye button that starts the whole workflow.
const eyeSvg = new El('svg', { 'data-testid': 'VisibilityIcon' }, [
  new El('path', { d: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5M12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5m0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3' })
]);
const ripple = new El('span', { class: 'MuiTouchRipple-root' });
const eyeButton = new El('button', { class: 'MuiIconButton-root', type: 'button' }, [eyeSvg, ripple]);

check('a click on the eye glyph starts the workflow',
  isRefundActionIconClick(eyeSvg.children[0]), true);
check('a click on the eye button\'s ripple still counts', isRefundActionIconClick(ripple), true);
check('a click on the button padding still counts', isRefundActionIconClick(eyeButton), true);

const closeButton = new El('button', { class: 'MuiIconButton-colorError' }, [
  new El('svg', { 'data-testid': 'CloseIcon' }, [new El('path', { d: 'M19 6.41 17.59 5 12 10.59Z' })])
]);
check('the dialog\'s close button does not start the workflow',
  isRefundActionIconClick(closeButton), false);

// The chain the eye kicks off: Refund -> Issue percentage refund -> dialog.
// The live Refund button is a plain MUI Button with a MoreHoriz icon and NO
// aria-haspopup/data-slot - demanding either of those is what broke this.
function buildRefundChain() {
  const icon = new El('span', { class: 'MuiButton-startIcon' }, [
    new El('svg', { 'data-testid': 'MoreHorizIcon' }, [])
  ]);
  const refundButton = new El('button', {
    class: 'MuiButtonBase-root MuiButton-root MuiButton-text MuiButton-textError MuiButton-colorError',
    type: 'button'
  }, [icon]);
  refundButton.own = 'Refund';

  const confirmButton = new El('button', { class: 'MuiButton-containedError', type: 'button' });
  confirmButton.own = 'Confirm Refund';

  const percentageItem = new El('li', { class: 'MuiMenuItem-root', role: 'menuitem', tabindex: '-1' });
  percentageItem.own = 'Issue percentage refund';

  const fullItem = new El('li', { class: 'MuiMenuItem-root', role: 'menuitem', tabindex: '-1' });
  fullItem.own = 'Issue full refund';

  return { root: new El('div', {}, [refundButton, percentageItem, fullItem, confirmButton]), refundButton, confirmButton, percentageItem, fullItem };
}

const chain = buildRefundChain();
docRoot.current = chain.root;
check('the plain MUI Refund button is found without aria-haspopup',
  getRefundTrigger() === chain.refundButton, true);
check('Confirm Refund is not mistaken for the Refund menu button',
  getRefundTrigger() === chain.confirmButton, false);
check('the percentage menu item is recognised',
  isPercentageRefundOption(chain.percentageItem), true);
check('a full refund is not treated as the percentage option',
  isPercentageRefundOption(chain.fullItem), false);

docRoot.current = new El('div', {}, [chain.confirmButton]);
check('no Refund button means no trigger', getRefundTrigger(), null);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed against the shipped source.');
process.exit(failures ? 1 : 0);
