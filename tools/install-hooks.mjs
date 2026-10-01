// Switches on the git hooks in .githooks/ (the pre-commit checks) for this clone: npm install runs it
// (the prepare script), or npm run hooks. Does nothing outside a git repository.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!fs.existsSync(path.join(root, '.git'))) { console.log('(not a git repository yet: the pre-commit checks switch on after git init and npm run hooks)'); process.exit(0); }
try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root });
  console.log('git hooks on: every commit runs npm run check, npm run check-models and npm test first');
} catch (err) { console.log(`couldn't switch the git hooks on: ${err.message}`); }
