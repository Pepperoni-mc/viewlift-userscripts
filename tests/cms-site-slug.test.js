// Which CMS *tenant* the header CMS button searches - not which host.
//
// The regression this locks down (2026-08-23): Sebastian reported the CMS
// button opening the wrong CMS on DIRTVision tickets. The host was right
// (cms.viewlift.com, live-confirmed on #352811 the day before); the tenant was
// not. cms.viewlift.com serves Altitude, DIRTVision and Vegas Golden Knights,
// and resolveCmsSite() used to answer "whichever slug this host was last seen
// using" for all three - so a DIRT ticket looked up while the session had last
// been on Altitude ran the API search against Altitude's tenant, with
// Altitude's API key, and opened whatever Altitude account shared the email.
//
// The rule now: on a shared host it is the brand's own slug or nothing.
// Nothing costs only the straight-into-the-account shortcut.
//
// Run with: node tests/cms-site-slug.test.js
const fs = require('fs');
const path = require('path');

const fullSrc = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'better-viewlift.user.js'),
  'utf8'
);

const featureStart = fullSrc.indexOf('Feature 3: Freshdesk Header CMS User Search');
if (featureStart === -1) throw new Error('could not find the Feature 3 section');
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

function extractConst(pattern, name) {
  const m = src.match(pattern);
  if (!m) throw new Error('could not find ' + name);
  return m[0];
}

// The organization list lives in the shared prelude, above Feature 3.
const orgsSrc = (() => {
  const a = fullSrc.indexOf('  const BV_CMS_ORGANIZATIONS = [');
  const b = fullSrc.indexOf('\n  }\n', fullSrc.indexOf('function bvCmsOrganizationsForHost', a));
  if (a < 0 || b < 0) throw new Error('could not find BV_CMS_ORGANIZATIONS');
  return fullSrc.slice(a, b + 4);
})();

// bvGetCmsCreds / bvGetSiteForCmsHost / bvNotify live in the shared helper
// scope above every feature, so they come in as injected stubs - which is also
// what lets a test say "the session was last on Altitude" without a browser.
const sandbox = `
  ${extractConst(/const CMS_USERS_URLS = \{[\s\S]*?\};/, 'CMS_USERS_URLS')}
  ${extractFunction(/function cleanText/, 'cleanText')}
  ${extractFunction(/function getCMSKeyFromClientText/, 'getCMSKeyFromClientText')}
  ${extractFunction(/function getCMSUsersURLForClient/, 'getCMSUsersURLForClient')}
  ${extractFunction(/function getCMSAccountForClient/, 'getCMSAccountForClient')}
  ${extractConst(/const MULTI_BRAND_CMS_SITES = \[[\s\S]*?\n    \];/, 'MULTI_BRAND_CMS_SITES')}
  ${extractFunction(/function getMultiBrandSiteRule/, 'getMultiBrandSiteRule')}
  ${extractFunction(/function findCapturedSite/, 'findCapturedSite')}
  ${extractFunction(/function resolveCmsSite/, 'resolveCmsSite')}
  ${orgsSrc}
  ${extractFunction(/function buildCMSDestination/, 'buildCMSDestination')}
  module.exports = {
    resolveCmsSite,
    getMultiBrandSiteRule,
    buildCMSDestination,
    getCMSAccountForClient
  };
`;

// capturedSites: the slugs the CMS itself has reported (bvRecordCmsCreds).
// hostSites: which slug each CMS host was last seen on.
function load({ capturedSites = [], hostSites = {} } = {}) {
  const notices = [];
  const stored = {};
  const mod = { exports: {} };
  const creds = {
    authorization: null,
    sites: Object.fromEntries(capturedSites.map(s => [s, { xApiKey: 'k', apiOrigin: 'o' }])),
    hostSites
  };

  new Function(
    'module', 'console', 'bvGetCmsCreds', 'bvGetSiteForCmsHost', 'bvNotify', 'bvTimingMark', 'GM_setValue',
    sandbox
  )(
    mod,
    { warn: () => {}, log: () => {} },
    () => creds,
    host => creds.hostSites[host] || '',
    message => notices.push(message),
    () => {},
    (key, value) => { stored[key] = value; }
  );

  return { api: mod.exports, notices, stored };
}

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const dirtTicket = {
  primary: 'Cannot watch the race | DIRTVision B2C | Client Name DIRTVision B2C',
  fallback: '352811 Cannot watch the race To: support@dirtvision.com my stream will not load'
};
const altitudeTicket = {
  primary: 'Altitude+ cancellation | Altitude B2C | Client Name Altitude B2C',
  fallback: '352179 To: customersupport@altitudeplus.com'
};
const vgkTicket = {
  primary: 'Knight Time login | Vegas Golden Knights',
  fallback: '352900 knight time app will not sign in'
};
const schnTicket = {
  primary: 'Stream stuck | SCHN+ B2C',
  fallback: '352400 sc-appsupport@spacecityhn.com'
};

// ---------------------------------------------------------------------------
// The report itself: a DIRT ticket must never borrow a sibling brand's slug.
// ---------------------------------------------------------------------------
{
  const { api } = load({
    capturedSites: ['altitude'],
    hostSites: { 'cms.viewlift.com': 'altitude' }
  });

  check(
    'a DIRT ticket does NOT resolve to Altitude just because the host was last on it',
    api.resolveCmsSite(dirtTicket),
    ''
  );
  check(
    'the same session still resolves an Altitude ticket to Altitude',
    api.resolveCmsSite(altitudeTicket),
    'altitude'
  );
}

// ---------------------------------------------------------------------------
// Nothing here hardcodes a guessed slug: the brand's real one is learned from
// whatever the CMS has already reported, whatever it turns out to be called.
// ---------------------------------------------------------------------------
{
  const { api } = load({
    capturedSites: ['altitude', 'dirtvision'],
    hostSites: { 'cms.viewlift.com': 'altitude' }
  });

  check(
    'once DIRTVision\'s own slug has been seen, the DIRT ticket uses it',
    api.resolveCmsSite(dirtTicket),
    'dirtvision'
  );
  check(
    'and Altitude is unaffected by it being there',
    api.resolveCmsSite(altitudeTicket),
    'altitude'
  );
}

{
  const { api } = load({ capturedSites: ['dirt-vision'] });
  check(
    'a differently-spelled real slug is matched by pattern, not by a guess',
    api.resolveCmsSite(dirtTicket),
    'dirt-vision'
  );
}

{
  const { api } = load({ capturedSites: ['vgk'] });
  check('Vegas Golden Knights resolves to its own captured slug', api.resolveCmsSite(vgkTicket), 'vgk');
}

// ---------------------------------------------------------------------------
// Everything that already worked keeps working.
// ---------------------------------------------------------------------------
{
  const { api } = load({
    capturedSites: ['schn', 'lightning', 'altitude'],
    hostSites: { 'cms-gcp.viewlift.com': 'lightning', 'cms.viewlift.com': 'altitude' }
  });

  check('SCHN still comes from the explicit GCP mapping', api.resolveCmsSite(schnTicket), 'schn');
  check(
    'an unrecognized client still falls back to the last slug seen on its host',
    api.resolveCmsSite({ primary: 'Some ticket nobody can place', fallback: '' }),
    'altitude'
  );
  check(
    'a client on no shared host at all is not treated as multi-brand',
    api.getMultiBrandSiteRule(schnTicket),
    null
  );
}

// ---------------------------------------------------------------------------
// cms.viewlift.com switches organization like cms-gcp does (3.80.0): it used
// to get only a warning, so an Altitude session opened KnightTime accounts as
// an empty shell.
// ---------------------------------------------------------------------------
const pendingOf = stored => JSON.parse(stored.betterCmsPendingAccountSwitch || 'null');

{
  const { api, stored } = load({ hostSites: { 'cms.viewlift.com': 'altitude' } });
  const href = api.buildCMSDestination(vgkTicket, { email: 'a@b.co', userId: 'abc' });
  check('a VGK ticket on an Altitude session goes through the v5 picker', href, 'https://cms.viewlift.com/v5/overview?betterSwitch=vegas-golden-knights');
  check('and returns to the account afterwards', pendingOf(stored).returnUrl, 'https://cms.viewlift.com/users/search/abc');
  check('as a v5 switch', pendingOf(stored).viaV5, true);
}

{
  const { api, stored } = load({ hostSites: { 'cms.viewlift.com': 'vegas-golden-knights' } });
  const href = api.buildCMSDestination(vgkTicket, { email: 'a@b.co', userId: 'abc' });
  check('a VGK ticket on a VGK session goes straight to the account', href, 'https://cms.viewlift.com/users/search/abc');
  check('still leaving a brand check for the CMS page', pendingOf(stored).key, 'vegas-golden-knights');
  check('not marked as already switched', pendingOf(stored).viaV5, undefined);
}

{
  const { api } = load({ hostSites: { 'cms.viewlift.com': 'vegas-golden-knights' } });
  check('Altitude and DIRT get their own picker keys',
    [api.buildCMSDestination(altitudeTicket, { email: 'a@b.co' }).includes('betterSwitch=altitude'),
     api.buildCMSDestination(dirtTicket, { email: 'a@b.co' }).includes('betterSwitch=dirtvision')].join(), 'true,true');
}

{
  const { api } = load({ hostSites: { 'cms-gcp.viewlift.com': 'lightning' } });
  check('a GCP brand still switches on cms-gcp', api.buildCMSDestination(schnTicket, { email: 'a@b.co', userId: 'x' }), 'https://cms-gcp.viewlift.com/v5/overview?betterSwitch=schn');
}

if (failures) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed against the shipped source.');
