// Checks where the unified toolbar gets inserted into Freshdesk's action bar.
//
// The bug this locks down (2026-08-22, found live on ticket #352003): the code
// looked up the Reply button with
// `actionBar.querySelector('button[data-test-email-action="reply"]')`, which
// matches at ANY depth, and then called `actionBar.insertBefore(toolbar, reply)`,
// which requires a DIRECT child. Freshdesk nests that button inside
// `.reply-bar-wrapper-top`, so every install pass threw
//
//   NotFoundError: Failed to execute 'insertBefore' on 'Node': The node before
//   which the new node is to be inserted is not a child of this node.
//
// three times per 7 seconds, uncaught. The toolbar was therefore never created,
// and the client brand chip lives inside it - which is what Sebastian reported
// as "no me está poniendo el tag de cada cliente".
//
// The fake insertBefore below enforces the direct-child rule on purpose: without
// that, this test could not tell the old code from the new.
//
// Run with: node tests/toolbar-placement.test.js
const fs = require('fs');
const path = require('path');

const fullSrc = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'better-viewlift.user.js'),
  'utf8'
);

const featureStart = fullSrc.indexOf('Feature 8: Unified ticket action bar');
if (featureStart === -1) throw new Error('could not find the Feature 8 section');
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
  ${extractFunction(/function insertToolbarBefore/, 'insertToolbarBefore')}
  module.exports = { insertToolbarBefore };
`;

const { insertToolbarBefore } = (() => {
  const mod = { exports: {} };
  new Function('module', sandbox)(mod);
  return mod.exports;
})();

// ---------------------------------------------------------------------------
// A DOM faithful on the one point that matters: insertBefore only accepts a
// reference node that is a direct child, and throws exactly like a browser
// otherwise.
// ---------------------------------------------------------------------------
function node(tag, attrs) {
  const self = {
    tagName: String(tag).toUpperCase(),
    attrs: attrs || {},
    children: [],
    parentElement: null,

    get firstElementChild() { return self.children[0] || null; },

    append(child) {
      child.parentElement = self;
      self.children.push(child);
      return child;
    },

    insertBefore(newNode, reference) {
      if (reference === null || reference === undefined) return self.append(newNode);

      const at = self.children.indexOf(reference);
      if (at === -1) {
        throw new Error(
          "NotFoundError: Failed to execute 'insertBefore' on 'Node': The node before " +
          'which the new node is to be inserted is not a child of this node.'
        );
      }

      newNode.parentElement = self;
      self.children.splice(at, 0, newNode);
      return newNode;
    },

    contains(other) {
      if (other === self) return true;
      return self.children.some(child => child.contains(other));
    },

    querySelector(selector) {
      const match = candidate =>
        selector === 'button[data-test-email-action="reply"]' &&
        candidate.tagName === 'BUTTON' &&
        candidate.attrs['data-test-email-action'] === 'reply';

      const walk = current => {
        for (const child of current.children) {
          if (match(child)) return child;
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };

      return walk(self);
    }
  };

  return self;
}

const replyButton = () => node('button', { 'data-test-email-action': 'reply' });

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label);
  if (!ok) console.log('      expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

// ---------------------------------------------------------------------------
// The real shape, read off the live page: section#mainactionbar >
// .page-actions__left.reply-bar-wrapper-top > ... > the Reply button.
// ---------------------------------------------------------------------------
{
  const bar = node('div');
  const wrapper = bar.append(node('div'));
  const reply = wrapper.append(replyButton());
  const toolbar = node('div');

  let threw = null;
  try {
    insertToolbarBefore(bar, toolbar);
  } catch (error) {
    threw = String(error.message).slice(0, 60);
  }

  check('a nested Reply button does not throw any more', threw, null);
  check('the toolbar lands in the Reply button\'s own parent', toolbar.parentElement, wrapper);
  check('immediately before the button', wrapper.children.indexOf(toolbar), wrapper.children.indexOf(reply) - 1);
  check('and the button is still there', wrapper.children.indexOf(reply), 1);
  check('nothing was added at the top level', bar.children.length, 1);
}

{
  // Deeper nesting is the same story.
  const bar = node('div');
  const outer = bar.append(node('div'));
  const inner = outer.append(node('div'));
  const reply = inner.append(replyButton());
  const toolbar = node('div');

  insertToolbarBefore(bar, toolbar);
  check('two levels down still works', toolbar.parentElement, inner);
  check('and still sits before the button', inner.children[0], toolbar);
  check('with the button after it', inner.children[1], reply);
}

{
  // If Freshdesk ever flattens it again, the direct-child case must keep working.
  const bar = node('div');
  const reply = bar.append(replyButton());
  const toolbar = node('div');

  insertToolbarBefore(bar, toolbar);
  check('a Reply button that IS a direct child works too', toolbar.parentElement, bar);
  check('and the toolbar goes first', bar.children[0], toolbar);
  check('with the button second', bar.children[1], reply);
}

{
  // Feature 6 removes the native Reply button on some pages.
  const bar = node('div');
  const existing = bar.append(node('span'));
  const toolbar = node('div');

  insertToolbarBefore(bar, toolbar);
  check('with no Reply button the toolbar goes to the front of the bar', bar.children[0], toolbar);
  check('ahead of whatever was there', bar.children[1], existing);
}

{
  // The degraded bare-section fallback container is empty.
  const bar = node('div');
  const toolbar = node('div');

  let threw = null;
  try {
    insertToolbarBefore(bar, toolbar);
  } catch (error) {
    threw = String(error.message).slice(0, 40);
  }

  check('an empty action bar does not throw', threw, null);
  check('and the toolbar is simply appended', bar.children[0], toolbar);
}

{
  // A Reply button that belongs to some other part of the page must not drag
  // the toolbar out of the action bar.
  const bar = node('div');
  const elsewhere = node('div');
  elsewhere.append(replyButton());
  const toolbar = node('div');

  insertToolbarBefore(bar, toolbar);
  check('a Reply button outside the bar is ignored', toolbar.parentElement, bar);
}

console.log(
  failures
    ? '\n' + failures + ' check(s) FAILED'
    : '\nAll checks passed against the shipped source.'
);
process.exit(failures ? 1 : 0);
