// Checks the client chip in the Freshdesk toolbar against the client names
// Freshdesk actually stores.
//
// The bug this locks down (2026-08-22): every Tampa ticket read "CASE". The chip
// had no Tampa rule at all - and matching on "tampa" or "lightning" would not
// have been enough either, because the field says **"TBL B2C"** and the words
// only turn up in some subjects.
//
// CLIENT_NAMES below is the real `cf_b2b_client_name` value of each B2C brand,
// read off the Freshdesk API (`/api/v2/tickets?per_page=100`) on 2026-08-22
// together with the support domain each brand's mail actually arrives on. It is
// the fixture: if a brand is renamed in Freshdesk, update it here and this test
// says which rule stopped matching.
//
// FOX joined on 2026-09-30, when the user brought the FOX queue in scope and
// confirmed its CMS (foxone.cms.viewlift.com). Its rule used to match only
// "fox sports", which the stored name "FOX One B2C" does not contain, so every
// FOX ticket read "CASE".
//
// Run with: node tests/brand-chip.test.js
const fs = require('fs');
const path = require('path');

const fullSrc = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'better-viewlift.user.js'),
  'utf8'
);

const featureStart = fullSrc.indexOf('Feature 8: Unified ticket action bar');
if (featureStart === -1) throw new Error('could not find the Feature 8 section');
const src = fullSrc.slice(featureStart);

const rulesSource = (src.match(/const BRAND_RULES = \[[\s\S]*?\n  \];/) || [])[0];
if (!rulesSource) throw new Error('could not find BRAND_RULES');

const BRAND_RULES = (() => {
  const mod = { exports: {} };
  new Function('module', rulesSource + '\nmodule.exports = BRAND_RULES;')(mod);
  return mod.exports;
})();

// The chip's own resolution step, from installToolbar: first rule whose pattern
// matches wins, otherwise the generic label.
function chipFor(context) {
  const hit = BRAND_RULES.find(rule => rule.patterns.some(pattern => pattern.test(context)));
  return hit ? hit.label : 'CASE';
}

// client name -> [expected chip, support domain]
const CLIENT_NAMES = {
  'TBL B2C': ['TBL', 'tampabaylightning.com'],
  'SCHN+ B2C': ['SCHN', 'spacecityhn.com'],
  'Altitude B2C': ['ALTITUDE', 'altitudeplus.com'],
  'LivGolf B2C': ['LIV', 'livgolfplus.com'],
  'DIRTVision B2C': ['DIRT', 'dirtvision.com'],
  'MSN B2C (Monumental Sports Network)': ['MSN', 'monumentalsports.com'],
  'FOX One B2C': ['FOX', 'fox.com']
};

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label);
  if (!ok) console.log('      expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

// ---------------------------------------------------------------------------
// Every B2C brand, by the name in the field and by the address it writes from.
// ---------------------------------------------------------------------------
Object.keys(CLIENT_NAMES).forEach(clientName => {
  const [expected, domain] = CLIENT_NAMES[clientName];
  check('"' + clientName + '" reads as ' + expected, chipFor(clientName), expected);
  check('  and so does mail to @' + domain, chipFor('to: support@' + domain), expected);
});

// ---------------------------------------------------------------------------
// Tampa specifically, since that is what was reported.
// ---------------------------------------------------------------------------
{
  check('the abbreviation alone is enough', chipFor('TBL B2C'), 'TBL');
  check('a subject that spells out the team works too', chipFor('Re: Your Lightning App Subscription Renewal'), 'TBL');
  check('as does the city', chipFor('#1 tampa bay Fan letter'), 'TBL');
  check('and it is no longer the generic label', chipFor('TBL B2C') === 'CASE', false);
}

// ---------------------------------------------------------------------------
// A chip is only useful if it is not wrong. First match wins, so brands must
// not shadow each other on their own real names.
// ---------------------------------------------------------------------------
{
  Object.keys(CLIENT_NAMES).forEach(clientName => {
    const [expected] = CLIENT_NAMES[clientName];
    const others = BRAND_RULES
      .filter(rule => rule.label !== expected && rule.patterns.some(pattern => pattern.test(clientName)))
      .map(rule => rule.label);
    check('"' + clientName + '" is claimed by no other brand', others.join(','), '');
  });
}

// ---------------------------------------------------------------------------
// FOX specifically: the rule only knew "fox sports" until 2026-09-30.
// ---------------------------------------------------------------------------
{
  check('the stored client name reads as FOX', chipFor('FOX One B2C'), 'FOX');
  check('so does the product name on its own', chipFor('FOX One'), 'FOX');
  check('and the old FOX Sports wording still works', chipFor('fox sports app issue'), 'FOX');
  check('and it is no longer the generic label', chipFor('FOX One B2C') === 'CASE', false);
}

{
  check('an unknown client falls back to the generic label', chipFor('Some New Client B2C'), 'CASE');
  check('and so does nothing at all', chipFor(''), 'CASE');
  check('every rule has a label and at least one pattern', BRAND_RULES.every(rule => rule.label && rule.patterns.length > 0), true);
}

console.log(
  failures
    ? '\n' + failures + ' check(s) FAILED'
    : '\nAll checks passed against the shipped source.'
);
process.exit(failures ? 1 : 0);
