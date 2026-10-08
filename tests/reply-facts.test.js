// Checks the Refund Assist customer reply rewrite (2026-10-08, #365225):
// the reply always names the amount refunded, and never says the
// subscription was cancelled when the run did not cancel it.
//
// Pulls REFUND_SENTENCES .. fitCancelSentence out of the shipped userscript;
// the editor is a shim of text nodes (all the tree walker sees).
//
// Run with: node tests/reply-facts.test.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'better-viewlift.user.js'), 'utf8');
const start = src.indexOf('  const REFUND_SENTENCES = [');
const end = src.indexOf('  async function checkAndSendReply(', start);
if (start === -1 || end === -1) throw new Error('could not find the reply rewrite section');

const fakeDocument = {
  createTreeWalker: editor => {
    let index = -1;
    return { nextNode: () => editor.nodes[++index] || null };
  }
};
const { fitRefundSentence, fitCancelSentence } = new Function('document', 'NodeFilter',
  src.slice(start, end) + '\nreturn { fitRefundSentence, fitCancelSentence };')(fakeDocument, { SHOW_TEXT: 4 });

function editor(texts) {
  const nodes = texts.map(nodeValue => ({ nodeValue }));
  return {
    nodes,
    get textContent() { return nodes.map(node => node.nodeValue).join(''); }
  };
}

let passed = 0;
let failed = 0;
function check(label, ok, detail) {
  if (ok) { passed += 1; console.log('PASS  ' + label); }
  else { failed += 1; console.log('FAIL  ' + label + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); }
}

// The reply #365225 actually got (B2C Account Refunded).
const english = () => editor([
  'Hello Terry,',
  'We would like to inform you that the subscription associated with the email address ',
  'jatsmile2@comcast.net',
  ' has been successfully canceled as per your request.',
  'The refund process has been initiated, and the funds should appear in your payment method within 14 business days.'
]);

let reply = english();
check('the refund sentence names the amount', fitRefundSentence(reply, 'USD 8.82', 1) === 'says USD 8.82' &&
  reply.nodes[4].nodeValue.startsWith('The refund of USD 8.82 has been initiated, and the funds'), reply.nodes[4].nodeValue);
check('a run that did not cancel rewrites "has been successfully canceled"', fitCancelSentence(reply, false) === 'says the subscription was NOT cancelled' &&
  reply.nodes[3].nodeValue === ' remains active and has not been canceled.', reply.nodes[3].nodeValue);
check('a second pass changes nothing', fitRefundSentence(reply, 'USD 8.82', 1) === '' && fitCancelSentence(reply, false) === '');

reply = english();
check('several refunds: the total and how many', fitRefundSentence(reply, 'USD 30.00', 2) === 'says USD 30.00 for 2 charges' &&
  reply.nodes[4].nodeValue.startsWith('The refund of USD 30.00 for your 2 charges has been initiated'), reply.nodes[4].nodeValue);
check('a cancelled account keeps the cancel sentence', fitCancelSentence(reply, true) === '' &&
  reply.nodes[3].nodeValue === ' has been successfully canceled as per your request.');

const spanish = editor([
  'Hola Ana,',
  'la suscripción asociada a la dirección de correo electrónico ',
  'a@b.com',
  ' se ha cancelado exitosamente según su solicitud.',
  'Se ha iniciado el proceso de reembolso y los fondos...'
]);
check('Spanish: amount and count', fitRefundSentence(spanish, 'USD 5.00', 2) !== 'not-found' &&
  spanish.nodes[4].nodeValue === 'Se ha iniciado el reembolso de USD 5.00 por sus 2 cargos y los fondos...', spanish.nodes[4].nodeValue);
check('Spanish: not cancelled', fitCancelSentence(spanish, false) !== 'not-found' &&
  spanish.nodes[3].nodeValue === ' sigue activa y no ha sido cancelada.', spanish.nodes[3].nodeValue);

check('no cancel sentence to fix = not-found (the reply is then NOT sent)', fitCancelSentence(editor(['Hello,']), false) === 'not-found');
check('no refund sentence to fix = not-found', fitRefundSentence(editor(['Hello,']), 'USD 1.00', 1) === 'not-found');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log('All checks passed against the shipped source.');
