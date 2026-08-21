// Checks that a CMS snapshot pasted into a Freshdesk private note carries a
// clickable link to the CMS page it was taken on, right under the image.
//
// Why this needs a test at all (2026-08-21): the link is built from a value
// that travelled through GM storage between two tabs and ends up as an `href`
// in the agent's note, so it is untrusted input. The rules locked down here:
// only http(s) on a real CMS host becomes a link, the paragraph is APPENDED as
// DOM nodes (never by re-serialising the editor, which would drop the image
// Froala is still uploading), and an older queued snapshot with no sourceUrl
// still pastes fine.
//
// Pulls the real functions out of the shipped userscript. The extraction is
// scoped to Feature 9's own section: several features declare their own
// cleanText, and an unscoped search picks up an earlier feature's copy.
//
// Run with: node tests/snapshot-source-link.test.js
const fs = require('fs');
const path = require('path');

const fullSrc = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'better-viewlift.user.js'),
  'utf8'
);

const featureStart = fullSrc.indexOf('Feature 9: Queue CMS snapshots into a private note');
if (featureStart === -1) throw new Error('could not find the Feature 9 section');
const src = fullSrc.slice(featureStart);

function extractFunction(source, pattern, name) {
  const idx = source.search(pattern);
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

const sandbox = `
  ${extractFunction(fullSrc, /function isCMSHost/, 'isCMSHost')}
  ${extractFunction(src, /function cleanText/, 'cleanText')}
  ${extractFunction(src, /function toSafeCmsUrl/, 'toSafeCmsUrl')}
  ${extractFunction(src, /function appendSourceLink/, 'appendSourceLink')}
  module.exports = { toSafeCmsUrl, appendSourceLink };
`;

// ---------------------------------------------------------------------------
// Minimal fake DOM. Only what appendSourceLink touches: createElement,
// createTextNode, appendChild and dispatchEvent.
// ---------------------------------------------------------------------------
function makeNode(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    childNodes: [],
    appendChild(node) { this.childNodes.push(node); return node; }
  };
}

function serialize(node) {
  if (node.nodeValue !== undefined) return node.nodeValue;
  const inner = node.childNodes.map(serialize).join('');
  if (node.tagName === 'A') return '<a href="' + node.href + '">' + (inner || node.textContent || '') + '</a>';
  const tag = node.tagName.toLowerCase();
  return '<' + tag + '>' + inner + '</' + tag + '>';
}

function load() {
  const events = [];
  const editor = makeNode('div');
  const original = makeNode('img');
  editor.appendChild(original);          // the image Froala just pasted
  editor.dispatchEvent = evt => { events.push(evt); return true; };

  const doc = {
    createElement: makeNode,
    createTextNode: value => ({ nodeValue: String(value) })
  };

  const mod = { exports: {} };
  new Function('module', 'document', 'InputEvent', 'Event', sandbox)(
    mod,
    doc,
    function InputEvent(type, init) { return { type, inputType: init && init.inputType }; },
    function Event(type) { return { type }; }
  );

  return { api: mod.exports, editor, original, events };
}

// ---------------------------------------------------------------------------
let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label);
  if (!ok) console.log('      expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

// --- what counts as a linkable CMS URL ------------------------------------
{
  const { api } = load();

  check(
    'a real CMS account page is accepted',
    api.toSafeCmsUrl('https://cms.viewlift.com/users/search/abc123'),
    'https://cms.viewlift.com/users/search/abc123'
  );
  check(
    'the search query is kept - it is what makes the link land on the same rows',
    api.toSafeCmsUrl('https://cms-gcp.viewlift.com/users/search?keyword=a%40b.com&filter=all'),
    'https://cms-gcp.viewlift.com/users/search?keyword=a%40b.com&filter=all'
  );
  check(
    'the qcp host is accepted',
    /^https:\/\/cms-qcp/.test(api.toSafeCmsUrl('https://cms-qcp.viewlift.com/users')),
    true
  );
  check(
    'the MSN CMS host is accepted',
    /monumentalsportsnetwork/.test(api.toSafeCmsUrl('https://cms.monumentalsportsnetwork.com/users')),
    true
  );
  check(
    'a look-alike host is rejected',
    api.toSafeCmsUrl('https://cms.viewlift.com.evil.example/users'),
    ''
  );
  check(
    'a non-CMS host is rejected',
    api.toSafeCmsUrl('https://viewlift.freshdesk.com/a/tickets/1'),
    ''
  );
  check('a javascript: URL is rejected', api.toSafeCmsUrl('javascript:alert(1)'), '');
  check('a data: URL is rejected', api.toSafeCmsUrl('data:text/html,hello'), '');
  check('a relative path is rejected', api.toSafeCmsUrl('/users/search/abc'), '');
  check('empty input is rejected', api.toSafeCmsUrl(''), '');
  check('a missing sourceUrl is rejected', api.toSafeCmsUrl(undefined), '');
}

// --- what lands in the editor ---------------------------------------------
{
  const { api, editor, original, events } = load();
  const url = 'https://cms.viewlift.com/users/search/abc123';
  const added = api.appendSourceLink(editor, url);

  check('appending reports success', added, true);
  check('the image is still the first child', editor.childNodes[0], original);
  check('the link paragraph is appended after it', editor.childNodes.length, 2);

  const paragraph = editor.childNodes[1];
  check('it is a paragraph', paragraph.tagName, 'P');
  check(
    'it reads as a labelled link to the CMS page',
    serialize(paragraph),
    '<p>CMS: <a href="' + url + '">' + url + '</a></p>'
  );

  const anchor = paragraph.childNodes[1];
  check('the anchor opens in a new tab', anchor.target, '_blank');
  check('and cannot reach back through window.opener', anchor.rel, 'noopener noreferrer');

  check('an input event is dispatched so the editor registers the change', events.length, 2);
  check('input comes first', events[0].type, 'input');
  check('then change', events[1].type, 'change');
}

// --- a rejected URL must not touch the note at all ------------------------
{
  const { api, editor, events } = load();

  check('a rejected URL reports failure', api.appendSourceLink(editor, 'javascript:alert(1)'), false);
  check('nothing was appended', editor.childNodes.length, 1);
  check('and nothing was dispatched', events.length, 0);
}

{
  const { api, editor } = load();
  check(
    'an older queued snapshot without a sourceUrl is a no-op, not an error',
    api.appendSourceLink(editor, undefined),
    false
  );
  check('the image is left exactly as it was', editor.childNodes.length, 1);
}

// --- the producer side ----------------------------------------------------
// The URL has to be recorded on the CMS tab at capture time; the Freshdesk tab
// has no way to know which page the shot came from. Guard the queue payload.
{
  const captureStart = fullSrc.indexOf('async function captureRealTabSnapshot');
  const queuePush = fullSrc.indexOf('queue.push({', captureStart);
  if (queuePush === -1) throw new Error('could not find the snapshot queue payload');
  const payload = fullSrc.slice(queuePush, fullSrc.indexOf('});', queuePush));

  check(
    'the capture queues the CMS page URL alongside the PNG',
    /sourceUrl:\s*location\.href/.test(payload),
    true
  );
  check('and still queues the PNG itself', /dataUrl:\s*snapshotDataUrl/.test(payload), true);
  check('and the ticket it belongs to', /ticketUrl/.test(payload), true);
}

// --- the paste path actually calls it ------------------------------------
{
  const paste = extractFunction(src, /async function pasteSnapshot/, 'pasteSnapshot');
  check(
    'pasteSnapshot appends the link',
    /appendSourceLink\(editor, snapshot && snapshot\.sourceUrl\)/.test(paste),
    true
  );
  check(
    'and does so after the image, at the end',
    paste.indexOf('appendSourceLink') > paste.lastIndexOf('editor.innerHTML'),
    true
  );
}

console.log(
  failures
    ? '\n' + failures + ' check(s) FAILED'
    : '\nAll checks passed against the shipped source.'
);
process.exit(failures ? 1 : 0);
