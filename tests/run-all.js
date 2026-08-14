// Runs every test in this folder plus a syntax check of the userscript.
//
//   node tests/run-all.js
//
// There is no build step in this project and no test framework - each test
// file extracts the real helpers out of the shipped userscript and runs them
// against synthetic input, so they cannot drift from what actually ships.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const userscript = path.join(root, 'scripts', 'better-viewlift.user.js');

const steps = [
  { name: 'syntax check (better-viewlift.user.js)', args: ['--check', userscript] },
  ...fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.test.js'))
    .sort()
    .map(f => ({ name: f, args: [path.join(__dirname, f)] }))
];

let failed = 0;
for (const step of steps) {
  process.stdout.write(`\n=== ${step.name} ===\n`);
  try {
    const out = execFileSync(process.execPath, step.args, { encoding: 'utf8' });
    if (out.trim()) process.stdout.write(out);
    else process.stdout.write('ok\n');
  } catch (error) {
    failed++;
    process.stdout.write((error.stdout || '') + (error.stderr || ''));
    process.stdout.write(`FAILED: ${step.name}\n`);
  }
}

process.stdout.write(failed ? `\n${failed} step(s) FAILED\n` : '\nEverything passed.\n');
process.exit(failed ? 1 : 0);
