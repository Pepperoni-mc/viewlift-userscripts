// Checks how a ticket's brand is read off the ticket RECORD (2026-09-30):
// Client Name (cf_b2b_client_name) first, the support inbox
// (email_config_id) when Client Name is empty or names nothing known.
//
// Why: every older detector guessed from page text, and in a combined filter
// view that text is the view's ("ALTITUDE + LIV + MSN"), not the ticket's.
// The Client Name values and inbox ids below are the real ones, read from
// /api/v2/ticket_fields and /api/v2/email_configs.
//
// Run with: node tests/ticket-brand.test.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'better-viewlift.user.js'), 'utf8');

function extractFunction(name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx === -1) throw new Error('could not find ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', src.indexOf(')', idx)); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(idx, j + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}

function extractArray(name) {
  const idx = src.indexOf('const ' + name + ' = [');
  if (idx === -1) throw new Error('could not find ' + name);
  return src.slice(idx, src.indexOf('];', idx) + 2);
}

const ctx = {};
new Function('ctx', `
  ${extractArray('BV_TICKET_BRANDS')}
  ${extractFunction('bvBrandFromTicketRecord')}
  ctx.brandOf = bvBrandFromTicketRecord;
`)(ctx);

let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  -> expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const ticket = (client, inbox) => ({ custom_fields: { cf_b2b_client_name: client }, email_config_id: inbox });
const key = (client, inbox) => (ctx.brandOf(ticket(client, inbox)) || {}).key || '';

// Every B2C Client Name in the picklist that has a brand here.
check('SCHN+ B2C', key('SCHN+ B2C'), 'schn');
check('TBL B2C', key('TBL B2C'), 'tbl');
check('LivGolf B2C', key('LivGolf B2C'), 'livgolf');
check('MSN B2C (Monumental Sports Network)', key('MSN B2C (Monumental Sports Network)'), 'msn');
check('Altitude B2C', key('Altitude B2C'), 'altitude');
check('DIRTVision B2C', key('DIRTVision B2C'), 'dirt');
check('VGK B2C', key('VGK B2C'), 'vgk');
check('VGK (KnightTime Plus)', key('VGK (KnightTime Plus)'), 'vgk');
check('CHSN B2C', key('CHSN B2C'), 'chsn');
check('FOX One B2C', key('FOX One B2C'), 'fox');
check('MOTV (My Outdoor TV/Outdoor Sports Group)', key('MOTV (My Outdoor TV/Outdoor Sports Group)'), 'motv');

// The inbox decides when Client Name cannot.
check('empty Client Name -> SCHN inbox (sc-appsupport@spacecityhn.com)', key('', 43000168570), 'schn');
check('empty Client Name -> Fox One MX inbox (soportemx@fox.com)', key('', 43000168571), 'fox');
check('both MSN inboxes are MSN', key('', 43000131225) + '/' + key('', 43000162164), 'msn/msn');
check('a Client Name with no brand ("ViewLift Core") falls back to the inbox', key('ViewLift Core', 43000166896), 'dirt');

// Client Name wins a disagreement - Sebastian: "la más acertada".
check('Client Name beats the inbox when they disagree', key('Altitude B2C', 43000168570), 'altitude');
check('the source says which one decided', ctx.brandOf(ticket('SCHN+ B2C', 0)).source, 'Client Name "SCHN+ B2C"');
check('...and says so for the inbox too', ctx.brandOf(ticket('', 43000168570)).source, 'support inbox');

// Nothing known: no guess, so the old page-text fallback takes over.
check('unknown Client Name and unknown inbox -> no brand', ctx.brandOf(ticket('Caliente B2C', 43000166921)), null);
check('a record with no fields at all -> no brand', ctx.brandOf({}), null);

// The CMS button's routing is fed this text instead of the page.
check('the FOX context carries the fox.com inbox domain', ctx.brandOf(ticket('FOX One B2C')).context, 'FOX One fox.com');

if (failed) {
  console.log(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed against the shipped source.');
