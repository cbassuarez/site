#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const distDir = join(repoRoot, 'dist');

if (!existsSync(distDir)) {
  console.error(`[write-version] ${distDir} does not exist; run 'vite build' first`);
  process.exit(1);
}

const sha = (process.env.BUILD_SHA || '').trim();
const at = (process.env.BUILD_AT || '').trim();
const before = (process.env.BUILD_BEFORE || '').trim();

if (!sha) {
  console.warn('[write-version] BUILD_SHA not set; emitting dev manifest');
  writeManifest({ sha: 'dev', shortSha: 'dev', at: new Date().toISOString(), subjects: [], count: 0 });
  process.exit(0);
}

const shortSha = sha.slice(0, 7);
const builtAt = at || new Date().toISOString();

const ZERO_SHA = '0000000000000000000000000000000000000000';
let subjects = [];
try {
  let log;
  if (before && before !== ZERO_SHA) {
    log = execSync(`git log ${before}..${sha} --pretty=%s`, { encoding: 'utf8', cwd: repoRoot });
  } else {
    log = execSync(`git log -1 --pretty=%s ${sha}`, { encoding: 'utf8', cwd: repoRoot });
  }
  subjects = log.split('\n').map((s) => s.trim()).filter(Boolean);
} catch (err) {
  console.warn(`[write-version] failed to read git log (${err?.message || err}); falling back to single subject`);
  try {
    subjects = [execSync(`git log -1 --pretty=%s ${sha}`, { encoding: 'utf8', cwd: repoRoot }).trim()];
  } catch {
    subjects = [];
  }
}

writeManifest({ sha, shortSha, at: builtAt, subjects, count: subjects.length, before: before || null });

function writeManifest(payload) {
  const json = JSON.stringify(payload, null, 2) + '\n';
  writeFileSync(join(distDir, 'version.json'), json);
  const wellKnown = join(distDir, '.well-known');
  mkdirSync(wellKnown, { recursive: true });
  writeFileSync(join(wellKnown, 'version.json'), json);
  console.log(`[write-version] wrote manifest: ${payload.shortSha} @ ${payload.at} (${payload.count ?? 0} subjects)`);
}
