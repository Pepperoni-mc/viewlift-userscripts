// Checks how the script decides a captured CMS session token is still
// usable. Pulls the real helpers out of the shipped userscript so this
// cannot drift from what actually runs.
//
// Uses synthetic tokens built here - no real credential is involved.
//
// Run with: node tests/token-expiry.test.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'better-viewlift.user.js'), 'utf8');

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

const sandbox = [
  extractConst(/const BV_CMS_CRED_MAX_AGE_MS = .*;/, 'BV_CMS_CRED_MAX_AGE_MS'),
  extractConst(/const BV_CMS_CRED_EXPIRY_MARGIN_MS = .*;/, 'BV_CMS_CRED_EXPIRY_MARGIN_MS'),
  extractFunction(/function bvTokenExpiresAt/, 'bvTokenExpiresAt'),
  extractFunction(/function bvCredsAreLive/, 'bvCredsAreLive'),
  'module.exports = { bvTokenExpiresAt, bvCredsAreLive, BV_CMS_CRED_MAX_AGE_MS };'
].join('\n');

const mod = { exports: {} };
new Function('module', sandbox)(mod);
const { bvTokenExpiresAt, bvCredsAreLive, BV_CMS_CRED_MAX_AGE_MS } = mod.exports;

// Build a syntactically valid JWT with the given exp. Signature is filler -
// nothing here verifies signatures, and no real token is used.
function fakeJwt(expEpochSeconds) {
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ site: 'schn', exp: expEpochSeconds })}.notarealsignature`;
}

const nowSec = Math.floor(Date.now() / 1000);
let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      expected ${expected}, got ${actual}`);
}

// exp parsing
check('reads exp out of a JWT',
  bvTokenExpiresAt(fakeJwt(nowSec + 3600)) > Date.now(), true);
check('tolerates a "Bearer " prefix',
  bvTokenExpiresAt('Bearer ' + fakeJwt(nowSec + 3600)) > Date.now(), true);
check('returns 0 for a non-JWT', bvTokenExpiresAt('just-an-opaque-string'), 0);
check('returns 0 for empty input', bvTokenExpiresAt(''), 0);
check('returns 0 for undefined', bvTokenExpiresAt(undefined), 0);

// liveness driven by the real claim - this is the behaviour that regressed
// when a flat 11h age limit was applied to a 24h token
const capturedLongAgo = Date.now() - 20 * 60 * 60 * 1000;
check('a 24h token captured 20h ago is still live (claim beats age heuristic)',
  bvCredsAreLive({ value: fakeJwt(nowSec + 4 * 3600), capturedAt: capturedLongAgo }), true);
check('an expired token is not live even if just captured',
  bvCredsAreLive({ value: fakeJwt(nowSec - 60), capturedAt: Date.now() }), false);
check('a token inside the safety margin is treated as gone',
  bvCredsAreLive({ value: fakeJwt(nowSec + 30), capturedAt: Date.now() }), false);
check('a token comfortably outside the margin is live',
  bvCredsAreLive({ value: fakeJwt(nowSec + 600), capturedAt: Date.now() }), true);

// fallback for tokens with no readable claim
check('opaque token falls back to the age limit - fresh is live',
  bvCredsAreLive({ value: 'opaque', capturedAt: Date.now() }), true);
check('opaque token falls back to the age limit - old is not',
  bvCredsAreLive({ value: 'opaque', capturedAt: Date.now() - BV_CMS_CRED_MAX_AGE_MS - 1000 }), false);

// defensive
check('missing auth record is not live', bvCredsAreLive(null), false);
check('auth record with no value is not live', bvCredsAreLive({ capturedAt: Date.now() }), false);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll checks passed against the shipped source.');
process.exit(failures ? 1 : 0);
