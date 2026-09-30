// Checks which client the refund panel thinks a ticket belongs to.
//
// The bug this locks down (2026-08-22, caught live on ticket #352003): the
// panel's own stored client key was one of the strings fed INTO the detector,
// and `livgolf` is the first rule tested. So one LIV Golf refund poisoned every
// later ticket - the stored value put "livgolf" in the context, livgolf matched
// first, the answer was stored again, and it confirmed itself forever. On a SCHN
// ticket the brand chip read SCHN while this said LIVGOLF, which would have
// filed the refund in the wrong client's tab of the log.
//
// Same shape as the 3.47.0 CMS-button bug: something that is not record data -
// there the saved view name, here our own cache - was being read as evidence.
//
// Run with: node tests/refund-client-detection.test.js
const fs = require('fs');
const path = require('path');

const fullSrc = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'better-viewlift.user.js'),
  'utf8'
);

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

const sandbox = `
  ${extractFunction(/function detectRefundClientKeyFromText/, 'detectRefundClientKeyFromText')}
  ${extractFunction(/function getRefundClientContextText/, 'getRefundClientContextText')}
  module.exports = { detectRefundClientKeyFromText, getRefundClientContextText };
`;

// STORAGE_KEYS as the panel declares them; only the names matter here.
const STORAGE_KEYS = {
  client: 'Refund Client',
  email: 'Refund Email',
  activeEmail: 'Refund Active Email',
  cms: 'CMS URL for User'
};

function load(options) {
  const settings = options || {};
  const stored = settings.stored || {};
  const fields = settings.fields || {};
  const mod = { exports: {} };

  // Only the elements the targeted-context selector list can match.
  const targeted = (settings.targeted || []).map(spec => ({
    textContent: spec.text || '',
    getAttribute: name => (name in (spec.attrs || {}) ? spec.attrs[name] : null)
  }));

  const doc = {
    title: settings.title || '',
    querySelectorAll: () => targeted,
    getElementById: id => (id in fields ? { value: fields[id] } : null)
  };

  new Function('module', 'document', 'location', 'safeGet', 'STORAGE_KEYS', sandbox)(
    mod,
    doc,
    { href: settings.href || 'https://viewlift.freshdesk.com/a/tickets/352003' },
    (key, fallback) => (key in stored ? stored[key] : fallback),
    STORAGE_KEYS
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

// ---------------------------------------------------------------------------
// The detector on its own.
// ---------------------------------------------------------------------------
{
  const api = load();
  const detect = api.detectRefundClientKeyFromText;

  check('a SCHN support address', detect('to sc-appsupport@spacecityhn.com'), 'schn');
  check('the SCHN token', detect('client name schn b2c'), 'schn');
  check('LIV Golf spelled out', detect('liv golf plus subscription'), 'livgolf');
  check('livgolfplus.com', detect('support@livgolfplus.com'), 'livgolf');
  check('Tampa', detect('tampa bay lightning'), 'tbl');
  check('Altitude', detect('altitude+ cancellation'), 'altitude');
  check('Monumental', detect('monumental sports network'), 'msn');
  check('Golden Knights', detect('vegas golden knights'), 'vgk');
  check('FOX', detect('fox sports app'), 'fox');
  check('the stored FOX client name', detect('client name fox one b2c'), 'fox');
  check('and the FOX support domain', detect('to support@fox.com'), 'fox');
  check('DIRTVision', detect('dirtvision billing'), 'dirt');
  check('nothing recognisable yields nothing', detect('hello there'), '');
  check('empty input yields nothing', detect(''), '');
}

// ---------------------------------------------------------------------------
// The regression: the panel's own memory must not be evidence.
// ---------------------------------------------------------------------------
{
  // Exactly the live situation: a SCHN ticket, with livgolf left over in storage
  // from an earlier refund.
  const api = load({
    title: '[#352003] [External] Space city : ViewLift',
    stored: {
      [STORAGE_KEYS.client]: 'livgolf',
      [STORAGE_KEYS.email]: 'customer@gmail.com',
      [STORAGE_KEYS.activeEmail]: 'customer@gmail.com',
      [STORAGE_KEYS.cms]: ''
    },
    fields: { 'refund-email': 'customer@gmail.com', 'refund-cms': '' },
    targeted: [
      { text: 'SCHN', attrs: {} },
      { text: 'sc-appsupport@spacecityhn.com', attrs: { href: 'mailto:sc-appsupport@spacecityhn.com' } }
    ]
  });

  const context = api.getRefundClientContextText();
  check('the stored client key is not in the detection context', context.indexOf('livgolf'), -1);
  check('the page context still is', context.indexOf('spacecityhn.com') !== -1, true);
  check(
    'so a SCHN ticket detects SCHN even after a LIV Golf refund',
    api.detectRefundClientKeyFromText(context),
    'schn'
  );
}

{
  // And the reverse, so the fix is not just "livgolf can never win".
  const api = load({
    title: '[#352100] LIV Golf renewal : ViewLift',
    stored: { [STORAGE_KEYS.client]: 'schn' },
    targeted: [{ text: 'LIV', attrs: {} }, { text: 'support@livgolfplus.com', attrs: { href: 'mailto:support@livgolfplus.com' } }]
  });

  const context = api.getRefundClientContextText();
  check('a stale schn key is not in the context either', context.indexOf('schn'), -1);
  check('and a LIV Golf ticket detects livgolf', api.detectRefundClientKeyFromText(context), 'livgolf');
}

{
  // The brand chip is part of the targeted context on purpose - it is the one
  // element on the page that already resolved the client correctly.
  const api = load({
    title: '[#1] no clue : ViewLift',
    targeted: [{ text: 'MSN', attrs: {} }]
  });

  check('the brand chip alone is enough', api.detectRefundClientKeyFromText(api.getRefundClientContextText()), 'msn');
}

{
  // With nothing to go on it must return nothing, so getRefundSheetKey()'s own
  // explicit stored-value fallback is what decides - not a guess in here.
  const api = load({ title: 'Tickets : ViewLift', href: 'https://viewlift.freshdesk.com/a/tickets' });
  check('an empty page detects nothing at all', api.detectRefundClientKeyFromText(api.getRefundClientContextText()), '');
}

console.log(
  failures
    ? '\n' + failures + ' check(s) FAILED'
    : '\nAll checks passed against the shipped source.'
);
process.exit(failures ? 1 : 0);
