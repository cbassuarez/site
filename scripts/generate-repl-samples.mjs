#!/usr/bin/env node
// Build public/labs/repl/samples/manifest.json from the same audio tree
// chunk-surfer pulls. Mirrors the world definitions in
// public/labs/chunk-surfer/index.html (lines ~516–584). Run after adding
// new audio under public/audio/.
//
//   node scripts/generate-repl-samples.mjs

import { readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const audioDir = join(repoRoot, 'public', 'audio');
const outPath = join(repoRoot, 'public', 'labs', 'repl', 'samples', 'manifest.json');

if (!existsSync(audioDir)) {
  console.error(`[gen] ${audioDir} missing — nothing to generate`);
  process.exit(1);
}

// Names for the_tub's first 20 stems (matches chunk-surfer's ordering).
const TUB_STEM_NAMES = [
  'xither_forge', 'wetair_veil', 'trillion_hull', 'acharia_arc', 'xemf_mass',
  'xither_glass', 'wetair_core', 'trillion_air', 'acharia_depth', 'xemf_sheen',
  'xither_floor', 'wetair_shine', 'trillion_low', 'acharia_spark', 'xemf_grain',
  'xither_lift', 'wetair_drift', 'trillion_fog', 'acharia_haze', 'xemf_bloom',
];

function existsFile(rel) {
  return existsSync(join(audioDir, rel));
}

function listFilesIn(world) {
  const dir = join(audioDir, world);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.(mp3|wav|ogg|flac)$/i.test(f)).sort();
}

const samples = [];
const groups = [];

// ── main_b3: main_b3_01.mp3 .. main_b3_64.mp3
{
  const files = listFilesIn('main_b3');
  const groupSamples = [];
  for (const file of files) {
    const m = file.match(/^main_b3_(\d{2})\.(mp3|wav|ogg|flac)$/i);
    if (!m) continue;
    const name = `b3-${m[1]}`;
    samples.push({ name, url: `/audio/main_b3/${file}`, group: 'main_b3' });
    groupSamples.push(name);
  }
  if (groupSamples.length) groups.push({ id: 'main_b3', label: 'main b3', samples: groupSamples });
}

// ── the_tub: 20 named stems + ultrachunk S####.wav
{
  const tubGroup = [];
  for (let i = 0; i < TUB_STEM_NAMES.length; i++) {
    const idx = String(i).padStart(2, '0');
    const stem = TUB_STEM_NAMES[i];
    const file = `${idx}_${stem}.wav`;
    if (existsFile(`the_tub/${file}`)) {
      const name = `tub-${stem.replace(/_/g, '-')}`;
      samples.push({ name, url: `/audio/the_tub/${file}`, group: 'the_tub' });
      tubGroup.push(name);
    }
  }
  for (const file of listFilesIn('the_tub')) {
    const m = file.match(/^S(\d{4})\.wav$/i);
    if (!m) continue;
    const name = `tub-s${m[1]}`;
    samples.push({ name, url: `/audio/the_tub/${file}`, group: 'the_tub' });
    tubGroup.push(name);
  }
  if (tubGroup.length) groups.push({ id: 'the_tub', label: 'THE TUB', samples: tubGroup });
}

// ── amplifications: amp_001.mp3 .. amp_064.mp3
for (const [folder, prefix, label] of [
  ['amplifications', 'amp', 'amplifications'],
  ['soundnoisemusic', 'snm', 'soundnoisemusic'],
  ['lux_nova', 'lux', 'lux_nova'],
]) {
  const files = listFilesIn(folder);
  const groupSamples = [];
  for (const file of files) {
    const m = file.match(/^[a-z]+_(\d{3})\.(mp3|wav|ogg|flac)$/i);
    if (!m) continue;
    const name = `${prefix}-${m[1]}`;
    samples.push({ name, url: `/audio/${folder}/${file}`, group: folder });
    groupSamples.push(name);
  }
  if (groupSamples.length) groups.push({ id: folder, label, samples: groupSamples });
}

// Deduplicate name collisions defensively.
const seen = new Set();
const dedup = [];
for (const s of samples) {
  if (seen.has(s.name)) continue;
  seen.add(s.name);
  dedup.push(s);
}

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: 'public/audio/ (mirrors chunk-surfer)',
  groups,
  samples: dedup,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`[gen] wrote ${outPath}`);
console.log(`[gen] ${dedup.length} samples across ${groups.length} groups:`);
for (const g of groups) console.log(`        ${g.id.padEnd(16)} ${g.samples.length}`);
