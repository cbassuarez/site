#!/usr/bin/env node
// Bundle CodeMirror 6 packages into a single classic-script global for
// /labs/repl. The repl is served from public/ as static assets, so we
// can't import from npm at runtime — we build once and commit the
// output to public/labs/repl/codemirror.bundle.js.
//
// Re-run after upgrading any @codemirror/* dependency.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const entry = resolve(root, 'scripts/repl-cm-entry.js');
const out = resolve(root, 'public/labs/repl/codemirror.bundle.js');

await build({
  entryPoints: [entry],
  outfile: out,
  bundle: true,
  format: 'iife',
  globalName: 'CMRepl',
  target: ['es2020'],
  platform: 'browser',
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'info',
});

console.log('wrote', out);
