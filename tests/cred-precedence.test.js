// Checks which captured CMS session token wins when more than one source
// reports one. Two sources exist: the Authorization header lifted off the
// app's own requests, and the session cookie. They carry the same token but
// not necessarily the same formatting, so the tie-break matters.
//
// Pulls the real functions out of the shipped userscript and runs them
// against an in-memory stand-in for GM storage. Synthetic tokens only.
//
// Run with: node tests/cred-precedence.test.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'better-viewlift.user.js'), 'utf8');

function extractFunction(pattern, name) {
  const idx = src.search(pattern);
  if (idx === -1) throw new Error('could not find ' + name);

  // Skip past the parameter list before counting braces. bvRecordCmsCreds
  // takes a destructured object, so the first "{" after the function name is
  // the parameter pattern, not the body - counting from there stops at the
  // end of the parameters and yields a truncated, unparsable function.
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
  // in-memory stand-in for GM storage
  const __store = {};
  function GM_getValue(k, d) { return Object.prototype.hasOwnProperty.call(__store, k) ? __store[k] : d; }
  function GM_setValue(k, v) { __store[k] = v; }
  ${extractConst(/const BV_CMS_CREDS_KEY = .*;/, 'BV_CMS_CREDS_KEY')}
  ${extractFunction(/function bvGetCmsCreds/, 'bvGetCmsCreds')}
  ${extractFunction(/function bvSaveCmsCreds/, 'bvSaveCmsCreds')}
  ${extractFunction(/function bvTokenExpiresAt/, 'bvTokenExpiresAt')}
  ${extractFunction(/function bvRecordCmsCreds/, 'bvRecordCmsCreds')}
  module.exports = { bvRecordCmsCreds, bvGetCmsCreds, reset: () => { for (const k in __store) delete __store[k]; } };
`;

const mod = { exports: {} };
new Function('module', sandbox)(mod);
const { bvRecordCmsCreds, bvGetCmsCreds, reset } = mod.exports;

function fakeJwt(expEpochSeconds, marker) {
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64({ site: 'schn', exp: expEpochSeconds, m: marker })}.sig`;
}

const nowSec = Math.floor(Date.now() / 1000);
let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const sameExp = nowSec + 20 * 3600;
const laterExp = nowSec + 23 * 3600;
const headerToken = 'Bearer ' + fakeJwt(sameExp, 'header');
const cookieToken = fakeJwt(sameExp, 'cookie');

// 1. On a tie the header wins - the cookie must not swap a known-good
//    "Bearer "-prefixed value for an untested bare one.
reset();
bvRecordCmsCreds({ authorization: headerToken, host: 'cms-gcp.viewlift.com' });
bvRecordCmsCreds({ authorization: cookieToken, host: 'cms-gcp.viewlift.com', authSource: 'cookie' });
check('equal expiry: header value is kept over the cookie',
  bvGetCmsCreds().authorization.value, headerToken);

// 2. ...regardless of which arrived first.
reset();
bvRecordCmsCreds({ authorization: cookieToken, host: 'cms-gcp.viewlift.com', authSource: 'cookie' });
bvRecordCmsCreds({ authorization: headerToken, host: 'cms-gcp.viewlift.com' });
check('equal expiry: a later header still displaces a stored cookie value',
  bvGetCmsCreds().authorization.value, headerToken);

// 3. A genuinely newer token always wins - that is a re-login, and holding
//    on to the superseded one is the bug this ordering exists to prevent.
reset();
bvRecordCmsCreds({ authorization: headerToken, host: 'cms-gcp.viewlift.com' });
const freshCookie = fakeJwt(laterExp, 'cookie-after-relogin');
bvRecordCmsCreds({ authorization: freshCookie, host: 'cms-gcp.viewlift.com', authSource: 'cookie' });
check('newer expiry from the cookie replaces an older header token',
  bvGetCmsCreds().authorization.value, freshCookie);

// 4. An older sighting must never clobber a newer stored token.
reset();
bvRecordCmsCreds({ authorization: fakeJwt(laterExp, 'new'), host: 'cms-gcp.viewlift.com' });
bvRecordCmsCreds({ authorization: fakeJwt(sameExp, 'old'), host: 'cms-gcp.viewlift.com' });
check('an older token does not overwrite a newer one',
  tokenMarker(bvGetCmsCreds().authorization.value), 'new');

function tokenMarker(token) {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
  );
  return payload.m;
}

// 5. The per-brand key and API origin still land, and the host->brand map is
//    recorded (the cookie path relies on this to resolve non-GCP hosts).
reset();
bvRecordCmsCreds({
  site: 'schn', xApiKey: 'k-1', apiOrigin: 'https://cms-gcp.api.viewlift.com',
  authorization: headerToken, host: 'cms-gcp.viewlift.com'
});
const creds = bvGetCmsCreds();
check('brand key stored', creds.sites.schn.xApiKey, 'k-1');
check('brand api origin stored', creds.sites.schn.apiOrigin, 'https://cms-gcp.api.viewlift.com');
check('host to brand mapping stored', creds.hostSites['cms-gcp.viewlift.com'], 'schn');

// 6. A cookie-only capture (no xApiKey) must not wipe an existing brand key.
bvRecordCmsCreds({ site: 'schn', authorization: cookieToken, host: 'cms-gcp.viewlift.com', authSource: 'cookie' });
check('cookie-only capture leaves the brand key intact',
  bvGetCmsCreds().sites.schn.xApiKey, 'k-1');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll checks passed against the shipped source.');
process.exit(failures ? 1 : 0);
