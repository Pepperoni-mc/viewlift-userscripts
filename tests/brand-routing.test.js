// Checks which CMS instance the Freshdesk header CMS button routes a ticket to.
//
// The regression this locks down (2026-08-20, ticket #352179): brand detection
// used to read the breadcrumb at the top of a ticket page as its
// highest-priority signal. That breadcrumb is not ticket data - it is the name
// of the saved view the agent arrived from. It only ever looked correct because
// the views happened to be named after single brands ("Altitude", "MSN",
// "SCHN"). Renaming one to "ALTITUDE + LIV + MSN" made every ticket opened from
// it resolve to whichever brand getCMSKeyFromClientText tests first - MSN - so
// an Altitude ticket opened MSN's CMS.
//
// Pulls the real functions out of the shipped userscript and runs them against
// a minimal fake DOM. The extraction is scoped to Feature 3's own section:
// several features declare their own cleanText/isVisible, and an unscoped
// search picks up an earlier feature's copy (see memory.md).
//
// Run with: node tests/brand-routing.test.js
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

const sandbox = `
  // The ticket-record brand (BV_TICKET_BRANDS) is stubbed per test: null =
  // not resolved yet, so the page-text routing below is what gets exercised.
  const bvGetTicketBrand = () => (typeof globalThis.__resolvedBrand === 'undefined' ? null : globalThis.__resolvedBrand);
  ${extractConst(/const CMS_USERS_URLS = \{[\s\S]*?\};/, 'CMS_USERS_URLS')}
  ${extractFunction(/function cleanText/, 'cleanText')}
  ${extractFunction(/function addClientContextText/, 'addClientContextText')}
  ${extractFunction(/function getClientFieldContext/, 'getClientFieldContext')}
  ${extractFunction(/function isTicketDetailPage/, 'isTicketDetailPage')}
  ${extractFunction(/function getViewNameChrome/, 'getViewNameChrome')}
  ${extractFunction(/function getTicketSubjectFromTitle/, 'getTicketSubjectFromTitle')}
  ${extractFunction(/function getFreshdeskClientContext/, 'getFreshdeskClientContext')}
  ${extractFunction(/function getCMSKeyFromClientText/, 'getCMSKeyFromClientText')}
  ${extractFunction(/function getCMSUsersURLForClient/, 'getCMSUsersURLForClient')}
  module.exports = {
    getFreshdeskClientContext,
    getCMSKeyFromClientText,
    getCMSUsersURLForClient,
    getTicketSubjectFromTitle,
    CMS_USERS_URLS
  };
`;

// ---------------------------------------------------------------------------
// Minimal fake DOM. Selectors are matched by exact string: the code under test
// uses a fixed set of them, so there is no need for a CSS engine here.
// ---------------------------------------------------------------------------
const VIEW_NAME_SELECTOR =
  '[data-test-title="main-title"], .header-primary .breadcrumb-title';
const LABEL_SELECTOR = 'label,[data-test-id*="label" i],[class*="label" i],span';
const BREADCRUMB_SELECTOR = '.header-primary .breadcrumb__item';

function el(text, attrs) {
  const attributes = attrs || {};
  return {
    innerText: text,
    textContent: text,
    value: undefined,
    getAttribute: name => (name in attributes ? attributes[name] : null),
    querySelector: () => null,
    parentElement: null
  };
}

// A "Client Name" field as Freshdesk renders it: the label sits beside the
// control, both inside a shared container a couple of levels up.
function clientNameField(value) {
  const label = el('Client Name');
  const control = el(value);
  const container = {
    innerText: 'Client Name ' + value,
    textContent: 'Client Name ' + value,
    querySelector: selector =>
      /ember-power-select-selected-item|combobox|select|input/.test(selector) ? control : null,
    parentElement: null
  };
  label.parentElement = container;
  return { label, container };
}

function makeDom(spec) {
  const viewName = spec.viewName || '';
  const clientField = spec.clientName ? clientNameField(spec.clientName) : null;

  const map = {};
  map[VIEW_NAME_SELECTOR] = viewName ? [el(viewName)] : [];
  map['[data-test-title="main-title"] a'] = viewName ? [el(viewName, { href: '/a/tickets' })] : [];
  map['[data-test-title="main-title"]'] = viewName ? [el(viewName)] : [];
  map['.header-primary .breadcrumb-title a'] = viewName ? [el(viewName, { href: '/a/tickets' })] : [];
  map['.header-primary .breadcrumb-title'] = viewName ? [el(viewName)] : [];
  map[BREADCRUMB_SELECTOR] = viewName
    ? [el(viewName), el(String(spec.ticketId || ''), { 'data-test-id': 'breadcrumb-item' })]
    : [];
  map[LABEL_SELECTOR] = clientField ? [clientField.label] : [];
  map['a[href^="mailto:"]'] = (spec.mailto || []).map(a => el(a, { href: 'mailto:' + a }));

  const emptySelectors = [
    '[data-test-id*="ticket-subject" i]',
    '[data-test-title*="ticket-subject" i]',
    '[data-test-id*="client" i]',
    '[data-test-title*="client" i]',
    '[aria-label*="client" i]',
    '[name*="client" i]'
  ];
  emptySelectors.forEach(s => { if (!(s in map)) map[s] = []; });

  return {
    title: spec.title || '',
    body: { innerText: spec.bodyText || '' },
    querySelectorAll: selector => map[selector] || [],
    querySelector: selector => (map[selector] || [])[0] || null
  };
}

function load(spec) {
  const dom = makeDom(spec);
  const mod = { exports: {} };
  const fakeConsole = { warn: () => {}, log: () => {} };
  new Function('module', 'document', 'location', 'console', sandbox)(
    mod,
    dom,
    { pathname: spec.pathname },
    fakeConsole
  );
  return mod.exports;
}

// ---------------------------------------------------------------------------
let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// The exact shape read live off ticket #352179 on 2026-08-20.
const altitudeTicket = {
  pathname: '/a/tickets/352179',
  ticketId: '352179',
  title: '[#352179] Altitude+ cancellation : ViewLift',
  viewName: 'ALTITUDE + LIV + MSN',
  clientName: 'Altitude B2C',
  bodyText:
    'ALTITUDE + LIV + MSN 352179 New Search Set Agent CMS Altitude+ cancellation ' +
    'Curtis Simmons reported via email To: customersupport@altitudeplus.com ' +
    'Hello, I am trying to cancel my subscription'
};

{
  const api = load(altitudeTicket);
  const ctx = api.getFreshdeskClientContext();

  check(
    'the combined view name is kept out of the primary context',
    /MSN/.test(ctx.primary),
    false
  );
  check(
    'the combined view name is kept out of the fallback text too',
    /\bMSN\b/i.test(ctx.fallback),
    false
  );
  check(
    'the ticket subject leads the primary context',
    ctx.primary.startsWith('Altitude+ cancellation'),
    true
  );
  check(
    'an Altitude ticket opened from "ALTITUDE + LIV + MSN" routes to the standard CMS',
    api.getCMSUsersURLForClient(ctx),
    'https://cms.viewlift.com/users/search'
  );
  check(
    'and specifically NOT to MSN (the bug in #352179)',
    api.getCMSUsersURLForClient(ctx) === api.CMS_USERS_URLS.msn,
    false
  );
}

// The mirror image: an MSN ticket reached from a view whose name says TAMPA.
{
  const api = load({
    pathname: '/a/tickets/352200',
    ticketId: '352200',
    title: '[#352200] Cannot watch the game : ViewLift',
    viewName: 'TAMPA + DIRT',
    clientName: 'MSN B2C',
    bodyText: 'TAMPA + DIRT 352200 Cannot watch the game monumental sports network'
  });
  const ctx = api.getFreshdeskClientContext();

  check(
    'an MSN ticket opened from "TAMPA + DIRT" still routes to MSN',
    api.getCMSUsersURLForClient(ctx),
    'https://cms.monumentalsportsnetwork.com/users/search'
  );
}

// A brand's own support address outranks a stray brand token elsewhere.
{
  const api = load({
    pathname: '/a/tickets/352300',
    ticketId: '352300',
    title: '[#352300] Refund request : ViewLift',
    viewName: 'My queue',
    clientName: '',
    bodyText:
      'Refund request To: customersupport@altitudeplus.com ' +
      'Previously I also wrote to MSN support about this'
  });
  const ctx = api.getFreshdeskClientContext();

  check(
    'altitudeplus.com beats a stray "MSN" mention in the thread',
    api.getCMSUsersURLForClient(ctx),
    'https://cms.viewlift.com/users/search'
  );
}

{
  const api = load({
    pathname: '/a/tickets/352400',
    ticketId: '352400',
    title: '[#352400] Stream stuck : ViewLift',
    viewName: 'Everything',
    clientName: '',
    bodyText: 'Stream stuck sc-appsupport@spacecityhn.com please help'
  });
  const ctx = api.getFreshdeskClientContext();

  check(
    'spacecityhn.com routes SCHN to the GCP host',
    api.getCMSUsersURLForClient(ctx),
    'https://cms-gcp.viewlift.com/users/search'
  );
}

// Off a ticket page the breadcrumb is not a view name, so it stays readable.
{
  const api = load({
    pathname: '/a/tickets/filters/all_tickets',
    title: 'Helpdesk : ViewLift',
    viewName: 'Altitude',
    clientName: '',
    bodyText: 'Altitude ticket list'
  });
  const ctx = api.getFreshdeskClientContext();

  check(
    'off a ticket page the breadcrumb is still read (behaviour preserved)',
    /Altitude/.test(ctx.primary),
    true
  );
}

{
  const api = load(altitudeTicket);
  check(
    'the subject is recovered from document.title without the id or the suffix',
    api.getTicketSubjectFromTitle(),
    'Altitude+ cancellation'
  );
}

{
  const api = load(altitudeTicket);
  check(
    'an empty context does not resolve to a brand on its own',
    api.getCMSKeyFromClientText(''),
    ''
  );
  check(
    'a zero-width-padded brand token still matches',
    api.getCMSKeyFromClientText('​ altitude ​'),
    'standard'
  );
}

// ---------------------------------------------------------------------------
// Which CMS instance each client's ticket opens, by the client name Freshdesk
// actually stores in cf_b2b_client_name and the address the mail arrives on.
// Both read off the Freshdesk API on 2026-08-22.
//
// Tampa was the report that prompted this: its field says "TBL B2C", which
// contains neither "tampa" nor "lightning", so it matched nothing and fell
// through to the standard host - the wrong CMS. DIRT is here because it is the
// opposite case and had to be confirmed rather than assumed.
// ---------------------------------------------------------------------------
{
  const api = load(altitudeTicket);
  const key = text => api.getCMSKeyFromClientText(text);
  const host = text => {
    const url = api.getCMSUsersURLForClient({ primary: text, fallback: '' });
    return url ? new URL(url).hostname : '';
  };

  check('"TBL B2C" is the Tampa client name and routes to GCP', key('TBL B2C'), 'gcp');
  check('and its support domain does too', key('to customersupport@tampabaylightning.com'), 'gcp');
  check('a subject naming the team as well', key('Re: Your Lightning App Subscription'), 'gcp');
  check('so a Tampa ticket opens the GCP host', host('Client Name TBL B2C'), 'cms-gcp.viewlift.com');
  check('and specifically NOT the standard one', host('Client Name TBL B2C') === 'cms.viewlift.com', false);

  check('"DIRTVision B2C" routes to the standard host', key('DIRTVision B2C'), 'standard');
  check('and its support domain agrees', key('to support@dirtvision.com'), 'standard');
  check('so DIRT opens the CMS without gcp', host('Client Name DIRTVision B2C'), 'cms.viewlift.com');

  check('"SCHN+ B2C" still routes to GCP', key('SCHN+ B2C'), 'gcp');
  check('"LivGolf B2C" too', key('LivGolf B2C'), 'gcp');
  check('"Altitude B2C" stays on the standard host', key('Altitude B2C'), 'standard');
  check('"MSN B2C (Monumental Sports Network)" goes to the MSN host', key('MSN B2C (Monumental Sports Network)'), 'msn');
  check('and the address MSN mail really arrives on does too', key('to support@monumentalsports.com'), 'msn');
  check('which is a third host, not either of the others', host('Client Name MSN B2C'), 'cms.monumentalsportsnetwork.com');

  // FOX One, routed for the first time on 2026-09-30. Until then it was in
  // UNROUTED_KNOWN_BRANDS and every FOX ticket opened cms.viewlift.com - a
  // host that has none of these customers - behind a warning notification.
  check('"FOX One B2C" routes to its own CMS', key('FOX One B2C'), 'fox');
  check('and the address FOX mail arrives on does too', key('to support@fox.com'), 'fox');
  check('so a FOX ticket opens the foxone host', host('Client Name FOX One B2C'), 'foxone.cms.viewlift.com');
  check('and no longer the standard one it used to fall through to', host('Client Name FOX One B2C') === 'cms.viewlift.com', false);
  check('the URL comes from the mapping, not a literal', api.CMS_USERS_URLS.fox, 'https://foxone.cms.viewlift.com/users/search');

  // The bare /\bfox\b/ fallback is deliberately the very last rule. It has to
  // catch a FOX ticket that only says "fox", and lose to every real brand.
  check('a lone "fox" with no other brand present still reaches FOX', key('cancel my fox subscription'), 'fox');
  check('but it loses to another brand token', key('DIRTVision B2C - handled by Megan Fox'), 'standard');
  check('and to another brand support address', key('to customersupport@altitudeplus.com about the fox'), 'standard');
  check('and to MOTV, which is known but still has no host', key('MOTV ticket - the fox logo is missing'), '');
}

// 2026-09-30: once the ticket record has given the brand, it IS the context -
// the combined view name and page text no longer get a say.
{
  globalThis.__resolvedBrand = { key: 'schn', label: 'SCHN', context: 'SCHN spacecityhn.com' };
  const api = load(altitudeTicket);
  const ctx = api.getFreshdeskClientContext();
  check('a resolved ticket brand replaces the page text entirely', ctx.primary === 'SCHN spacecityhn.com' && ctx.fallback === '', true);
  check('and routes by it, not by the view (ALTITUDE + LIV + MSN)', api.getCMSUsersURLForClient(ctx), 'https://cms-gcp.viewlift.com/users/search');
  delete globalThis.__resolvedBrand;
}

if (failures) {
  console.log(`\n${failures} check(s) FAILED`);


  process.exit(1);
}
console.log('\nAll checks passed against the shipped source.');
