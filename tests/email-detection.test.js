// Regression test that pulls the REAL current source of the email helpers
// out of the userscript and exercises them, so it tests the shipped code
// rather than a copy that can drift.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'scripts', 'better-viewlift.user.js'), 'utf8');

function extract(startPattern, name) {
  const idx = src.search(startPattern);
  if (idx === -1) throw new Error('could not find ' + name);
  // walk braces from the first { after the match
  let i = src.indexOf('{', idx);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(idx, j + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}

const pieces = [
  extract(/function cleanText\(value\) \{\s*return String\(value \|\| ''\)\.replace\(\/\\u00a0/, 'cleanText'),
  extract(/function trimGluedEmailSuffix/, 'trimGluedEmailSuffix'),
  extract(/function normalizeEmailMatches/, 'normalizeEmailMatches'),
  extract(/function isBlockedCmsSearchEmail/, 'isBlockedCmsSearchEmail')
];

// the constant tables isBlockedCmsSearchEmail depends on
const constants = [
  /const CMS_SEARCH_BLOCKED_EMAILS = \[[\s\S]*?\];/,
  /const GENERIC_SUPPORT_LOCAL_PART_RE = .*;/,
  /const OWN_DOMAIN_RE = .*;/,
  /const PLACEHOLDER_DOMAIN_RE = .*;/,
  /const PLACEHOLDER_LOCAL_PART_RE = .*;/
].map(re => { const m = src.match(re); if (!m) throw new Error('missing constant: ' + re); return m[0]; });

const sandbox = constants.join('\n') + '\n' + pieces.join('\n') +
  '\n;module.exports = { trimGluedEmailSuffix, normalizeEmailMatches, isBlockedCmsSearchEmail };';

const mod = { exports: {} };
new Function('module', sandbox)(mod);
const { normalizeEmailMatches, isBlockedCmsSearchEmail, trimGluedEmailSuffix } = mod.exports;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
}

// 1. The real reported garbage from ticket #350804
const pageText = [
  'https://viewlift.freshdesk.com/a/tickets/350804shaytaylor32@outlook.comContact Info',
  'fanassist@viewlift.com',
  'somebody@email.com',
  'TaylorEmailshaytaylor32@outlook.com',
  'shaytaylor32@outlook.com'
].join('\n');
const survivors = normalizeEmailMatches(pageText.match(EMAIL_RE) || [])
  .filter(e => !isBlockedCmsSearchEmail(e));
check('ticket #350804 garbage collapses to the one real address',
  survivors.map(e => e.toLowerCase()), ['shaytaylor32@outlook.com']);

// 2. Glue trimming, both directions
check('trailing label glued on is trimmed',
  trimGluedEmailSuffix('a@outlook.comContact'), 'a@outlook.com');
check('legit mixed-case domain untouched',
  trimGluedEmailSuffix('Mixed.Case@Outlook.com'), 'Mixed.Case@Outlook.com');
check('legit subdomain + plus tag untouched',
  trimGluedEmailSuffix('user+tag@sub.domain.co.uk'), 'user+tag@sub.domain.co.uk');

// 3. Blocklist behaviour
check('our own domain is blocked', isBlockedCmsSearchEmail('anyone@viewlift.com'), true);
check('support inbox on a new brand is blocked', isBlockedCmsSearchEmail('support@brandnew.tv'), true);
check('getsupport variant is blocked', isBlockedCmsSearchEmail('getsupport@brand.com'), true);
check('placeholder address is blocked', isBlockedCmsSearchEmail('somebody@email.com'), true);
check('a real customer address is NOT blocked', isBlockedCmsSearchEmail('jane.doe@gmail.com'), false);
check('a customer whose name starts with "info" is NOT blocked',
  isBlockedCmsSearchEmail('infosys.fan@gmail.com'), false);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll checks passed against the shipped source.');
process.exit(failures ? 1 : 0);
