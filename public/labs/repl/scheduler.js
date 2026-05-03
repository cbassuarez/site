// Scheduler — runs a parsed Program against the Web Audio clock with a
// look-ahead loop (~25 ms horizon, 100 ms tick). Hot-swappable: update()
// installs a new program without dropping the master clock.
//
// Slots in a block are nested: each top-level slot is either a leaf
// (note/rest/sample) or a group whose children subdivide that slot's time
// evenly. Recursive dispatch handles arbitrary nesting depth.
//
// Public API:
//   const sched = ReplScheduler.create({ audioCtx, masterBus });
//   sched.start();                 // begin at t = 0
//   sched.stop();                  // halt + reset bar counter
//   sched.update(program);         // hot-swap; clock keeps running
//   sched.now()  → { bar, beat, transport, blockStates }
//   sched.onMissingSample(fn);

(function (root) {
  'use strict';

  const LOOKAHEAD_MS = 100;
  const SCHEDULE_AHEAD_S = 0.12;

  function create(opts) {
    const audioCtx = opts.audioCtx;
    const masterBus = opts.masterBus;
    if (!audioCtx || !masterBus) throw new Error('scheduler: audioCtx + masterBus required');

    let program = null;
    let running = false;
    let timer = null;
    let originTime = 0;
      const missingSampleSeen = new Set();
      let onMissingCallback = null;

      const RANDOM_PITCH_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
      const RANDOM_PITCH_OCTAVES = [2, 3, 4, 5];

      function noteToFreq(name, accidental, octave) {
        const semitoneOffsets = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
        let semis = semitoneOffsets[String(name || '').toUpperCase()];
        if (semis == null) return null;

        if (accidental === '#') semis += 1;
        if (accidental === 'b') semis -= 1;

        const oct = Number(octave);
        if (!Number.isFinite(oct)) return null;

        const midi = (oct + 1) * 12 + semis;
        return 440 * Math.pow(2, (midi - 69) / 12);
      }

      function randomArrayItem(items) {
        if (!items || items.length === 0) return null;
        return items[Math.floor(Math.random() * items.length)];
      }
      
      function chooseAttractorPitchClass(block) {
        const a = blockAttractor(block);
        if (!a) return randomArrayItem(RANDOM_PITCH_CLASSES);

        return attractorChoice(block, RANDOM_PITCH_CLASSES, (pc, i, signals) => {
          // A lightweight diatonic bias field:
          // density/periodicity lean toward stable A-C-E-G;
          // rupture/volatility open toward B-D-F.
          const stable = pc === 'A' || pc === 'C' || pc === 'E' || pc === 'G';
          const unstable = pc === 'B' || pc === 'D' || pc === 'F';
          return 1
            + (stable ? signals.periodicity * 2 + signals.density : 0)
            + (unstable ? signals.volatility * 1.5 + signals.rupture * 2 : 0)
            + signals.intensity * (i + 1) * 0.08;
        });
      }

      function chooseAttractorOctave(block) {
        const a = blockAttractor(block);
        if (!a) return randomArrayItem(RANDOM_PITCH_OCTAVES);

        return attractorChoice(block, RANDOM_PITCH_OCTAVES, (oct, i, signals) => {
          if (oct <= 2) return 1 + signals.density * 2 + signals.pressure;
          if (oct >= 5) return 1 + signals.rupture * 2 + signals.volatility;
          return 1 + signals.periodicity + signals.intensity;
        });
      }

      function resolveRandomPitch(node, spec) {
        if (!spec) return null;

        if (spec.frozen && node._frozenRandomPitch) {
          return node._frozenRandomPitch;
        }

          const pitchClass = spec.pitchClass || chooseAttractorPitchClass(node._blockForAttractor || null);
          const accidental = spec.pitchClass ? (spec.accidental || '') : '';
          const octave = spec.octave != null ? spec.octave : chooseAttractorOctave(node._blockForAttractor || null);

        const freq = noteToFreq(pitchClass, accidental, octave);
        if (!freq) return null;

        const resolved = {
          name: `${pitchClass}${accidental}${octave}`,
          freq,
        };

        if (spec.frozen) {
          node._frozenRandomPitch = resolved;
        }

        return resolved;
      }
      
      function clearNodeRuntimeState(node) {
        if (!node) return;

        if (node.kind === 'leaf') {
          delete node._frozenRandomPitch;
          return;
        }

        if (node.kind === 'group' && Array.isArray(node.children)) {
          for (const child of node.children) {
            clearNodeRuntimeState(child);
          }
        }
      }

      function disconnectBlockAttractorBus(block) {
        if (!block || !block._attractorBus) return;

        const bus = block._attractorBus;
        const nodes = [
          bus.input,
          bus.preGain,
          bus.filter,
          bus.saturator,
          bus.dryGain,
          bus.delay,
          bus.delayFeedback,
          bus.wetGain,
          bus.output,
        ];

        for (const node of nodes) {
          if (!node || typeof node.disconnect !== 'function') continue;
          try { node.disconnect(); } catch (_) {}
        }

        block._attractorBus = null;
      }

      function clearBlockRuntimeState(block) {
        if (!block) return;

        disconnectBlockAttractorBus(block);

        block._paramState = {};
        block._speedState = {};
        block._speedSlotIdx = 0;
        block._speedNextTime = null;
        block._lastDispatchedSlotIdx = 0;
        block._lastDispatchedTime = null;
        block._lastDispatchedDuration = null;
        block._attractorSmoothed = null;
        block._organism = null;

        if (Array.isArray(block.slots)) {
          for (const slot of block.slots) {
            clearNodeRuntimeState(slot);
          }
        }
      }

    function barSeconds(prog) {
      if (!prog) return 60 / 110 * 4;
      const beatSeconds = 60 / prog.tempo;
      return prog.meter.num * beatSeconds;
    }

      function start() {
        if (running) return;
        running = true;
        originTime = audioCtx.currentTime + 0.05;
        if (program) {
            for (const block of program.blocks) {
              block._scheduledThrough = 0;
              clearBlockRuntimeState(block);
              block._speedSlotIdx = 0;
              block._speedNextTime = originTime;
            }
        }
        tick();
        timer = setInterval(tick, LOOKAHEAD_MS);
      }

      function stop() {
        running = false;
        if (timer) {
          clearInterval(timer);
          timer = null;
        }

        if (typeof root.SampleVoice !== 'undefined' && root.SampleVoice.stopAll) {
          root.SampleVoice.stopAll(audioCtx.currentTime);
        }

        if (program) {
            for (const block of program.blocks) {
              block._scheduledThrough = 0;
              clearBlockRuntimeState(block);
            }
        }
      }

      function update(newProgram) {
        const oldProgram = program;
        const oldBarSec = program ? barSeconds(program) : null;

        if (oldProgram && Array.isArray(oldProgram.blocks)) {
          for (const block of oldProgram.blocks) {
            disconnectBlockAttractorBus(block);
          }
        }

        program = newProgram;
        for (const block of program.blocks) {
          if (block._scheduledThrough == null) block._scheduledThrough = 0;
          clearBlockRuntimeState(block);
          block._leafOffsets = null;
          block._leafCounts = null;
          block._leafTotal = null;
          ensureLeafOffsets(block);
          block._speedSlotIdx = 0;
          block._speedNextTime = running
            ? Math.max(audioCtx.currentTime, originTime)
            : originTime;
        }
      if (running && oldBarSec) {
        const newBarSec = barSeconds(program);
        const elapsed = audioCtx.currentTime - originTime;
        const elapsedBars = elapsed / oldBarSec;
        originTime = audioCtx.currentTime - elapsedBars * newBarSec;
          for (const block of program.blocks) {
            block._scheduledThrough = 0;
            clearBlockRuntimeState(block);
            block._speedSlotIdx = Math.max(0, Math.floor((audioCtx.currentTime - originTime) / (newBarSec / block.slotsPerBar)));
            block._speedNextTime = Math.max(audioCtx.currentTime, originTime);
          }
      }
    }

    function onMissingSample(fn) { onMissingCallback = fn; }

    function reportMissingSample(name) {
      if (missingSampleSeen.has(name)) return;
      missingSampleSeen.add(name);
      if (onMissingCallback) onMissingCallback(name);
    }

      function clamp(v, lo, hi) {
        const n = Number(v);
        if (!Number.isFinite(n)) return lo;
        return n < lo ? lo : n > hi ? hi : n;
      }

      function lerp(a, b, t) {
        return a + (b - a) * t;
      }

      function randomBetween(lo, hi) {
        return lo + Math.random() * (hi - lo);
      }

      function randomChoice(values) {
        if (!values || values.length === 0) return null;
        return values[Math.floor(Math.random() * values.length)];
      }
      
      function blockAttractor(block) {
        if (!block || !block.attractor || typeof root.ReplAttractors === 'undefined') {
          return null;
        }

        return root.ReplAttractors.peek(block.attractor);
      }

      function attractorAmount(block, key, fallback) {
        const a = blockAttractor(block);
        if (!a) return fallback;
        const v = Number(a[key]);
        return Number.isFinite(v) ? clamp(v, 0, 1) : fallback;
      }

      function attractorBiasRange(block, name, lo, hi) {
        const a = blockAttractor(block);
        if (!a) return randomBetween(lo, hi);

        const intensity = clamp(a.intensity, 0, 1);
        const volatility = clamp(a.volatility, 0, 1);
        const pressure = clamp(a.pressure, 0, 1);
        const density = clamp(a.density, 0, 1);
        const periodicity = clamp(a.periodicity, 0, 1);
        const rupture = clamp(a.rupture, 0, 1);

        let center = 0.5;
        let spread = 1;

        switch (name) {
          case 'pan':
            center = 0.5 + (volatility - 0.5) * 0.35;
            spread = 0.45 + volatility * 0.55;
            break;

          case 'gain':
            center = 0.25 + intensity * 0.55 + rupture * 0.15;
            spread = 0.35 + volatility * 0.4;
            break;

          case 'force':
            center = 0.25 + intensity * 0.65;
            spread = 0.3 + rupture * 0.5;
            break;

          case 'decay':
            center = 0.2 + periodicity * 0.55 + density * 0.2;
            spread = 0.25 + volatility * 0.45;
            break;

          case 'crush':
            center = rupture * 0.7 + pressure * 0.2;
            spread = 0.25 + rupture * 0.5;
            break;

          case 'tone':
            center = 0.2 + pressure * 0.35 + intensity * 0.35;
            spread = 0.25 + volatility * 0.45;
            break;

          case 'harm':
            center = 0.2 + density * 0.5 + intensity * 0.25;
            spread = 0.3 + volatility * 0.35;
            break;

          case 'octave':
            center = 0.35 + pressure * 0.35 - density * 0.15;
            spread = 0.35 + rupture * 0.35;
            break;

          case 'rate':
            center = 0.45 + pressure * 0.25 + volatility * 0.15;
            spread = 0.25 + volatility * 0.45;
            break;

          case 'start':
            center = density * 0.55 + volatility * 0.25;
            spread = 0.3 + rupture * 0.3;
            break;

          case 'speed':
            center = 0.35 + periodicity * 0.2 + volatility * 0.35 + rupture * 0.25;
            spread = 0.25 + volatility * 0.5;
            break;

          default:
            center = intensity;
            spread = 1;
            break;
        }

        const u = clamp(center + (Math.random() - 0.5) * spread, 0, 1);
        return lo + (hi - lo) * u;
      }

      function attractorChoice(block, values, weightsFn) {
        if (!values || values.length === 0) return null;
        const a = blockAttractor(block);
        if (!a || typeof weightsFn !== 'function') return randomChoice(values);

        let total = 0;
        const weights = values.map((v, i) => {
          const w = Math.max(0.0001, Number(weightsFn(v, i, a)) || 0.0001);
          total += w;
          return w;
        });

        let r = Math.random() * total;
        for (let i = 0; i < values.length; i++) {
          r -= weights[i];
          if (r <= 0) return values[i];
        }

        return values[values.length - 1];
      }
      
      function copyAttractorSignals(a) {
        if (!a) return null;
        return {
          intensity: clamp(a.intensity, 0, 1),
          volatility: clamp(a.volatility, 0, 1),
          pressure: clamp(a.pressure, 0, 1),
          density: clamp(a.density, 0, 1),
          periodicity: clamp(a.periodicity, 0, 1),
          rupture: clamp(a.rupture, 0, 1),
          age: clamp(a.age, 0, 1),
          confidence: clamp(a.confidence, 0, 1),
          source: String(a.source || 'fallback'),
          label: String(a.label || ''),
          updatedAt: String(a.updatedAt || ''),
        };
      }

      function couplingDepthForBlock(block, signals) {
        if (!block || !block.attractor || !signals) return 0;

        const raw = String(block.attractor.raw || '').toLowerCase();
        const kind = raw.split('.')[0];

          let base = 0.24;
          switch (kind) {
            case 'quake': base = 0.34; break;
            case 'tide': base = 0.28; break;
            case 'solar': base = 0.32; break;
            case 'archive': base = 0.22; break;
            case 'tub': base = 0.40; break;
            case 'weather': base = 0.26; break;
            case 'air': base = 0.24; break;
            case 'traffic': base = 0.28; break;
            case 'grid': base = 0.30; break;
            case 'orbit': base = 0.22; break;
            case 'civic': base = 0.26; break;
            default: base = 0.24; break;
          }

        const confidence = clamp(signals.confidence, 0, 1);
        const liveMul = signals.source === 'live' ? confidence : Math.min(0.55, confidence + 0.15);

          return clamp(base * liveMul, 0, signals.source === 'live' ? 0.42 : 0.16);
      }

      function attractorSmoothingForBlock(block, prev, next) {
        if (!block || !block.attractor || !prev || !next) return 0.12;

        const raw = String(block.attractor.raw || '').toLowerCase();
        const kind = raw.split('.')[0];

        // Rupture should attack faster than it releases.
        if (next.rupture > prev.rupture + 0.03) return 0.25;

        switch (kind) {
          case 'tide': return 0.025;
          case 'weather': return 0.045;
          case 'quake': return 0.11;
          case 'solar': return 0.075;
          case 'archive': return 0.035;
          case 'tub': return 0.13;
          default: return 0.06;
        }
      }

      function attractorSignalsForBlock(block, time) {
        const raw = blockAttractor(block);
        if (!raw) return null;

        const next = copyAttractorSignals(raw);
        if (!next) return null;

        if (!block._attractorSmoothed) {
          block._attractorSmoothed = next;
          return block._attractorSmoothed;
        }

        const prev = block._attractorSmoothed;
        const amt = attractorSmoothingForBlock(block, prev, next);

        block._attractorSmoothed = {
          intensity: lerp(prev.intensity, next.intensity, amt),
          volatility: lerp(prev.volatility, next.volatility, amt),
          pressure: lerp(prev.pressure, next.pressure, amt),
          density: lerp(prev.density, next.density, amt),
          periodicity: lerp(prev.periodicity, next.periodicity, amt),
          rupture: lerp(prev.rupture, next.rupture, amt),
          age: lerp(prev.age, next.age, amt),
          confidence: lerp(prev.confidence, next.confidence, amt),
          source: next.source,
          label: next.label,
          updatedAt: next.updatedAt,
        };

        return block._attractorSmoothed;
      }

      function slowCycle(block, time, rate, phaseOffset) {
        const seed = block && Number.isFinite(block._attractorSeed)
          ? block._attractorSeed
          : 0.37;
        return Math.sin(time * rate + seed * 9.17 + (phaseOffset || 0));
      }

      function noiseCycle(block, time, rate, phaseOffset) {
        const a = slowCycle(block, time, rate, phaseOffset);
        const b = slowCycle(block, time, rate * 0.37, phaseOffset + 1.91);
        return clamp((a * 0.65 + b * 0.35 + 1) / 2, 0, 1);
      }

      function ensureBlockOrganism(block) {
        if (!block._organism) {
          block._organism = {
            agitation: 0,
            wetness: 0,
            instability: 0,
            memory: 0,
            saturation: 0,
            compression: 0,
          };
        }
        return block._organism;
      }

      function updateOrganism(block, signals, depth) {
        const o = ensureBlockOrganism(block);
        const amount = 0.08 + depth * 0.22;

        o.agitation = lerp(o.agitation, signals.rupture * 0.75 + signals.volatility * 0.45, amount);
        o.wetness = lerp(o.wetness, signals.density * 0.65 + signals.intensity * 0.35, amount);
        o.instability = lerp(o.instability, signals.volatility * 0.75 + signals.age * 0.25, amount);
        o.memory = lerp(o.memory, signals.periodicity * 0.45 + signals.density * 0.55, amount);
        o.saturation = lerp(o.saturation, signals.rupture * 0.7 + signals.pressure * 0.3, amount);
        o.compression = lerp(o.compression, signals.pressure * 0.55 + signals.density * 0.35, amount);

        return o;
      }

      function attractorModForBlock(block, time) {
        const signals = attractorSignalsForBlock(block, time);
        if (!signals) return null;

        if (!Number.isFinite(block._attractorSeed)) {
          block._attractorSeed = Math.random();
        }

        const depth = couplingDepthForBlock(block, signals);
        if (depth <= 0) return null;

        const organism = updateOrganism(block, signals, depth);
        const raw = String(block.attractor && block.attractor.raw || '').toLowerCase();
        const kind = raw.split('.')[0];
        const mode = raw.split('.').slice(1).join('.');

        const i = signals.intensity;
        const v = signals.volatility;
        const p = signals.pressure;
        const d = signals.density;
        const t = signals.periodicity;
        const r = signals.rupture;
        const stale = signals.age;

        const slow = slowCycle(block, time, 0.18 + t * 0.22, 0);
        const med = slowCycle(block, time, 0.53 + v * 0.9, 1.3);
        const jitter = (noiseCycle(block, time, 2.7 + v * 7.5, 3.7) - 0.5) * 2;

        const mod = {
          signals,
          organism,
          depth,

          forceMul: 1,
          decayMul: 1,
          crushAdd: 0,
          toneMul: 1,
          harmAdd: 0,
          octaveAdd: 0,
          panOffset: 0,
          gainMul: 1,
          rateMul: 1,
          startOffset: 0,
          gateMul: 1,

          filterFreq: 6200,
          filterQ: 0.8,
          delayTime: 0.18,
          delayFeedback: 0.08,
          wetGain: 0,
          dryGain: 1,
          saturation: 0,
          preGain: 1,
        };

        // General organismic coloration shared by all attractors.
          mod.gainMul *= 1 + depth * (i * 0.07 + r * 0.09 - d * 0.035);
          mod.panOffset += depth * (v * 0.11 * med + r * 0.15 * jitter);
          mod.decayMul *= 1 + depth * (d * 0.13 + t * 0.10 - r * 0.07);
          mod.toneMul *= 1 + depth * (p * 0.07 - d * 0.07 + r * 0.045);
          mod.crushAdd += depth * r * 2.8;
          mod.rateMul *= 1 + depth * v * jitter * 0.03;
        mod.filterFreq = 850 + (1 - d * 0.65 + p * 0.35) * 6500;
        mod.filterQ = 0.65 + depth * (r * 5.5 + p * 1.6);
        mod.wetGain = depth * (d * 0.22 + i * 0.12 + t * 0.16);
        mod.delayFeedback = clamp(depth * (d * 0.26 + t * 0.22 + v * 0.08), 0, 0.55);
        mod.saturation = depth * (r * 0.42 + p * 0.18 + stale * 0.08);
        mod.preGain = 1 + depth * (r * 0.12 - d * 0.05);
        mod.dryGain = clamp(1 - mod.wetGain * 0.35, 0.72, 1);

        // Attractor-specific color.
        if (kind === 'weather') {
            mod.decayMul *= 1 + depth * (d * 0.16 + p * 0.08);
            mod.toneMul *= 1 - depth * d * 0.09;
            mod.panOffset += depth * v * slow * 0.09;
            mod.wetGain += depth * (d * 0.12 + i * 0.06);
            mod.delayTime = 0.16 + d * 0.18;

          if (mode === 'dew') {
              mod.decayMul *= 1 + depth * 0.09;
              mod.toneMul *= 1 - depth * 0.05;
              mod.wetGain += depth * 0.06;
          } else if (mode === 'frost') {
            mod.toneMul *= 1 + depth * 0.18;
            mod.crushAdd += depth * 2.5;
            mod.saturation += depth * 0.12;
          } else if (mode === 'visibility') {
            mod.filterFreq = 1200 + (1 - d) * 9000;
            mod.wetGain += depth * d * 0.15;
          }
        } else if (kind === 'quake') {
            mod.forceMul *= 1 + depth * r * 0.24;
            mod.gainMul *= 1 + depth * r * 0.16;
            mod.crushAdd += depth * r * 4.2;
            mod.decayMul *= 1 - depth * r * 0.18;
            mod.panOffset += depth * r * jitter * 0.24;
            mod.filterQ += depth * r * 3.8;
            mod.saturation += depth * r * 0.24;
            mod.preGain *= 1 + depth * r * 0.18;
        } else if (kind === 'tide') {
          const tideLfo = slowCycle(block, time, 0.12 + t * 0.08, 0);
          mod.gainMul *= 1 + depth * tideLfo * i * 0.16;
          mod.decayMul *= 1 + depth * t * 0.38;
          mod.panOffset += depth * tideLfo * 0.36;
          mod.rateMul *= 1 + depth * tideLfo * 0.035;
          mod.wetGain += depth * t * 0.24;
          mod.delayTime = 0.22 + t * 0.24;
          mod.delayFeedback += depth * t * 0.16;
        } else if (kind === 'solar') {
            mod.toneMul *= 1 + depth * i * 0.15;
            mod.rateMul *= 1 + depth * jitter * v * 0.04;
            mod.crushAdd += depth * r * 3.4;
            mod.saturation += depth * (i * 0.12 + r * 0.28);
          mod.filterFreq = 2000 + i * 9200;
          mod.filterQ += depth * (r * 3.5 + i * 1.2);
          mod.wetGain += depth * v * 0.10;
        } else if (kind === 'archive') {
          mod.rateMul *= 1 - depth * (d * 0.08 + stale * 0.08);
          mod.startOffset += depth * d * 0.06;
          mod.decayMul *= 1 + depth * (d * 0.24 + organism.memory * 0.22);
          mod.toneMul *= 1 - depth * stale * 0.12;
          mod.saturation += depth * 0.08;
          mod.wetGain += depth * organism.memory * 0.13;
        } else if (kind === 'tub') {
            mod.panOffset += depth * slow * 0.24;
            mod.wetGain += depth * 0.12;
            mod.delayFeedback += depth * 0.13;
            mod.saturation += depth * (r * 0.18 + v * 0.10);
            mod.crushAdd += depth * r * 2.2;
          mod.rateMul *= 1 + depth * jitter * 0.05;
        } else if (kind === 'air') {
          mod.toneMul *= 1 - depth * d * 0.20;
          mod.gainMul *= 1 - depth * p * 0.08;
          mod.wetGain += depth * d * 0.18;
          mod.filterFreq = 650 + (1 - d) * 5200;
        } else if (kind === 'traffic' || kind === 'grid' || kind === 'civic') {
          mod.gainMul *= 1 + depth * (d * 0.08 - p * 0.04);
          mod.crushAdd += depth * (r * 3 + p * 2);
          mod.saturation += depth * (p * 0.22 + d * 0.12);
          mod.rateMul *= 1 + depth * jitter * v * 0.04;
          mod.delayFeedback += depth * d * 0.12;
        } else if (kind === 'orbit') {
          mod.panOffset += depth * slow * 0.55;
          mod.toneMul *= 1 + depth * 0.12;
          mod.filterFreq = 3500 + i * 7000;
          mod.wetGain += depth * t * 0.16;
        }

          mod.wetGain = clamp(mod.wetGain, 0, 0.34);
          mod.delayFeedback = clamp(mod.delayFeedback, 0, 0.38);
          mod.saturation = clamp(mod.saturation, 0, 0.42);
        mod.filterFreq = clamp(mod.filterFreq, 120, 14000);
        mod.filterQ = clamp(mod.filterQ, 0.2, 12);
        mod.delayTime = clamp(mod.delayTime, 0.04, 0.85);
        mod.gainMul = clamp(mod.gainMul, 0.35, 1.85);
        mod.forceMul = clamp(mod.forceMul, 0.35, 1.75);
        mod.decayMul = clamp(mod.decayMul, 0.35, 2.25);
        mod.toneMul = clamp(mod.toneMul, 0.45, 1.65);
        mod.rateMul = clamp(mod.rateMul, 0.45, 1.75);
        mod.gateMul = clamp(mod.gateMul, 0.45, 1.85);

        return mod;
      }

      function makeSaturationCurve(amount) {
        const n = 2048;
        const curve = new Float32Array(n);
        const k = 1 + amount * 38;

        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * 2 - 1;
          curve[i] = Math.tanh(k * x) / Math.tanh(k);
        }

        return curve;
      }

      function ensureAttractorBus(block) {
        if (!block || !block.attractor) return null;
        if (block._attractorBus) return block._attractorBus;

        const input = audioCtx.createGain();
        const preGain = audioCtx.createGain();
        const filter = audioCtx.createBiquadFilter();
        const saturator = audioCtx.createWaveShaper();
        const dryGain = audioCtx.createGain();
        const delay = audioCtx.createDelay(1.25);
        const delayFeedback = audioCtx.createGain();
        const wetGain = audioCtx.createGain();
        const output = audioCtx.createGain();

        filter.type = 'lowpass';
        filter.frequency.value = 6200;
        filter.Q.value = 0.8;
        saturator.curve = makeSaturationCurve(0.001);
        saturator.oversample = '2x';
        preGain.gain.value = 1;
        dryGain.gain.value = 1;
        delay.delayTime.value = 0.18;
        delayFeedback.gain.value = 0.08;
        wetGain.gain.value = 0;
        output.gain.value = 1;

        input.connect(preGain);
        preGain.connect(filter);
        filter.connect(saturator);

        saturator.connect(dryGain);
        dryGain.connect(output);

        saturator.connect(delay);
        delay.connect(delayFeedback);
        delayFeedback.connect(delay);
        delay.connect(wetGain);
        wetGain.connect(output);

        output.connect(masterBus);

        block._attractorBus = {
          input,
          preGain,
          filter,
          saturator,
          dryGain,
          delay,
          delayFeedback,
          wetGain,
          output,
          _lastSaturation: 0,
        };

        return block._attractorBus;
      }

      function setAudioParam(param, value, time, tau) {
        if (!param) return;
        const t = Number.isFinite(time) ? Math.max(audioCtx.currentTime, time) : audioCtx.currentTime;
        try {
          param.cancelScheduledValues(t);
          param.setTargetAtTime(value, t, tau || 0.05);
        } catch (_) {
          try { param.value = value; } catch (__) {}
        }
      }

      function updateAttractorBus(block, mod, time) {
        if (!block || !block.attractor || !mod) return masterBus;

        const bus = ensureAttractorBus(block);
        if (!bus) return masterBus;

        setAudioParam(bus.preGain.gain, mod.preGain, time, 0.08);
        setAudioParam(bus.filter.frequency, mod.filterFreq, time, 0.12);
        setAudioParam(bus.filter.Q, mod.filterQ, time, 0.10);
        setAudioParam(bus.dryGain.gain, mod.dryGain, time, 0.10);
        setAudioParam(bus.delay.delayTime, mod.delayTime, time, 0.14);
        setAudioParam(bus.delayFeedback.gain, mod.delayFeedback, time, 0.16);
        setAudioParam(bus.wetGain.gain, mod.wetGain, time, 0.12);

        if (Math.abs((bus._lastSaturation || 0) - mod.saturation) > 0.025) {
          bus.saturator.curve = makeSaturationCurve(mod.saturation);
          bus._lastSaturation = mod.saturation;
        }

        return bus.input;
      }

      function outputBusForBlock(block, time, mod) {
        if (!block || !block.attractor || !mod) return masterBus;
        return updateAttractorBus(block, mod, time);
      }

      function applyAttractorToParams(block, params, voice, time, duration, mod) {
        if (!mod) return params;

        const out = { ...params };

        if (voice === 'string') {
          out.force = clamp((out.force == null ? 0.7 : out.force) * mod.forceMul, 0, 1.25);
          out.decay = clamp((out.decay == null ? 4.2 : out.decay) * mod.decayMul, 0.4, 8);
          out.crush = clamp(Math.round((out.crush || 0) + mod.crushAdd), 0, 16);
          out.tone = clamp((out.tone == null ? 0.6 : out.tone) * mod.toneMul, 0, 1);
          out.harm = clamp(Math.round((out.harm == null ? 2 : out.harm) + mod.harmAdd), 0, 5);
          out.octave = clamp(Math.round((out.octave || 0) + mod.octaveAdd), -2, 2);
          out.pan = clamp((out.pan || 0) + mod.panOffset, -1, 1);
          out.gain = clamp((out.gain == null ? 1 : out.gain) * mod.gainMul, 0, 1.5);
        } else if (voice === 'sample') {
          out.gain = clamp((out.gain == null ? 1 : out.gain) * mod.gainMul, 0, 1.5);
          out.pan = clamp((out.pan || 0) + mod.panOffset, -1, 1);
          out.rate = clamp((out.rate == null ? 1 : out.rate) * mod.rateMul, 0.25, 4);
          out.start = Math.max(0, (out.start || 0) + mod.startOffset);
          out.gateMul = mod.gateMul;
        }

        return out;
      }

      function isParamAtom(v) {
        return v && typeof v === 'object' && v.kind === 'param-op';
      }

      function defaultForParam(name, fallback) {
        switch (name) {
          case 'force': return 0.7;
          case 'decay': return 4.2;
          case 'crush': return 0;
          case 'tone': return 0.6;
          case 'harm': return 2;
          case 'octave': return 0;
          case 'pan': return 0;
          case 'gain': return 1;
          case 'rate': return 1;
            case 'start': return 0;
            case 'speed': return 1;

          // Future/optional params. These are not parsed by the uploaded REPL
          // yet unless PARAM_NAMES is expanded, but keeping defaults here makes
          // the control-stream resolver safe for upcoming FX rows.
          case 'delay': return 0;
          case 'feedback': return 0;
          case 'blur': return 0;
          case 'corrode': return 0;

          default: return fallback;
        }
      }

      function quantizeRandomParam(name, value) {
        switch (name) {
            case 'speed':
              return clamp(value, 0.0625, 16);
          case 'crush':
            return Math.round(clamp(value, 0, 16));

          case 'harm':
            return Math.round(clamp(value, 1, 5));

          case 'octave':
            return Math.round(clamp(value, -1, 1));

          default:
            return value;
        }
      }

      function randomParamValue(name, fallback, block) {
        switch (name) {
            case 'pan':
              return attractorBiasRange(block, 'pan', -1, 1);

            case 'gain':
              return attractorBiasRange(block, 'gain', 0.25, 1.1);

            case 'force':
              return attractorBiasRange(block, 'force', 0.25, 1);

            case 'decay':
              return attractorBiasRange(block, 'decay', 0.4, 7);

            case 'crush':
              return attractorChoice(block, [0, 4, 5, 6, 7, 8, 10, 12, 14, 16], (v, i, a) => {
                return 1 + a.rupture * i * 0.9 + a.pressure * i * 0.25;
              });

            case 'tone':
              return attractorBiasRange(block, 'tone', 0.15, 0.95);

            case 'harm':
              return attractorChoice(block, [1, 2, 3, 4, 5], (v, i, a) => 1 + a.density * i + a.intensity * i * 0.5);

            case 'octave':
              return attractorChoice(block, [-1, 0, 1], (v, i, a) => {
                if (v < 0) return 1 + a.density * 2;
                if (v > 0) return 1 + a.pressure * 2 + a.rupture;
                return 1 + a.periodicity;
              });

            case 'rate':
              return attractorBiasRange(block, 'rate', 0.5, 1.5);

            case 'start':
              return attractorBiasRange(block, 'start', 0, 0.85);

            case 'speed':
              return attractorChoice(block, [0.25, 1 / 3, 0.5, 0.75, 1, 4 / 3, 1.5, 2, 3, 4], (v, i, a) => {
                if (v < 1) return 1 + a.periodicity * 2 + a.density;
                if (v > 1) return 1 + a.volatility * i + a.rupture * i;
                return 1 + a.confidence;
              });

          case 'delay':
            return randomBetween(0, 1);

          case 'feedback':
            return randomBetween(0, 0.75);

          case 'blur':
          case 'corrode':
            return randomBetween(0, 1);

          default:
            return fallback;
        }
      }

      function ensureParamState(block) {
        if (!block._paramState) block._paramState = {};
        return block._paramState;
      }

      function stateForParam(block, name) {
        const state = ensureParamState(block);
        if (!state[name]) {
          state[name] = {
            last: undefined,
            frozen: {},
            drift: {},
          };
        }
        return state[name];
      }

      function paramStateKey(name, index, scalar) {
        return scalar ? `${name}:scalar` : `${name}:${index}`;
      }

      function resolveParamAtom(block, name, atom, fallback, valueIndex, scalar, time) {
        const paramState = stateForParam(block, name);
        const defaultValue = defaultForParam(name, fallback);
        const key = paramStateKey(name, valueIndex, scalar);

        if (!isParamAtom(atom)) {
          paramState.last = atom;
          return atom;
        }

        switch (atom.op) {
          case 'random': {
            const value = randomParamValue(name, defaultValue, block);
            paramState.last = value;
            return value;
          }

          case 'hold': {
            return paramState.last !== undefined ? paramState.last : defaultValue;
          }

          case 'reset': {
            paramState.last = defaultValue;
            return defaultValue;
          }

          case 'frozen-random': {
            if (paramState.frozen[key] === undefined) {
              paramState.frozen[key] = randomParamValue(name, defaultValue, block);
            }
            paramState.last = paramState.frozen[key];
            return paramState.frozen[key];
          }

          case 'drift': {
            const seconds = Number(atom.seconds);
            if (!Number.isFinite(seconds) || seconds <= 0) {
              const value = randomParamValue(name, defaultValue, block);
              paramState.last = value;
              return value;
            }

            const now = Number.isFinite(time) ? time : audioCtx.currentTime;
            let driftState = paramState.drift[key];

            if (!driftState) {
              const initial = paramState.last !== undefined
                ? paramState.last
                : randomParamValue(name, defaultValue, block);

              driftState = {
                startTime: now,
                from: initial,
                to: randomParamValue(name, defaultValue, block),
              };

              paramState.drift[key] = driftState;
            }

            while (now - driftState.startTime >= seconds) {
              driftState.from = driftState.to;
              driftState.to = randomParamValue(name, defaultValue, block);
              driftState.startTime += seconds;
            }

            const t = clamp((now - driftState.startTime) / seconds, 0, 1);
            const value = quantizeRandomParam(name, lerp(driftState.from, driftState.to, t));
            paramState.last = value;
            return value;
          }

          default: {
            paramState.last = defaultValue;
            return defaultValue;
          }
        }
      }

      function paramForIndex(block, name, index, fallback, time) {
        const p = block.params && block.params[name];
        if (!p) return fallback;

        if (p.kind === 'scalar') {
          return resolveParamAtom(block, name, p.value, fallback, index, true, time);
        }

        if (p.kind === 'vector') {
          const len = p.values.length;
          if (!len) return fallback;
          const valueIndex = ((index % len) + len) % len;
          return resolveParamAtom(block, name, p.values[valueIndex], fallback, valueIndex, false, time);
        }

        return fallback;
      }

      function resolveParamsForEvent(block, eventIndex, time) {
        return {
          force: paramForIndex(block, 'force', eventIndex, 0.7, time),
          decay: paramForIndex(block, 'decay', eventIndex, 4.2, time),
          crush: paramForIndex(block, 'crush', eventIndex, 0, time),
          tone: paramForIndex(block, 'tone', eventIndex, 0.6, time),
          harm: paramForIndex(block, 'harm', eventIndex, 2, time),
          octave: paramForIndex(block, 'octave', eventIndex, 0, time),
          pan: paramForIndex(block, 'pan', eventIndex, 0, time),
          gain: paramForIndex(block, 'gain', eventIndex, 1, time),
          rate: paramForIndex(block, 'rate', eventIndex, 1, time),
          start: paramForIndex(block, 'start', eventIndex, 0, time),
        };
      }

      function speedStateForBlock(block) {
        if (!block._speedState) {
          block._speedState = {
            last: undefined,
            frozen: {},
            drift: {},
          };
        }
        return block._speedState;
      }

      function resolveSpeedAtom(block, atom, valueIndex, scalar, time) {
        if (!block._speedState) {
          block._speedState = {
            last: undefined,
            frozen: {},
            drift: {},
          };
        }

        const oldParamState = block._paramState;
        block._paramState = { speed: block._speedState };

        const value = resolveParamAtom(block, 'speed', atom, 1, valueIndex, scalar, time);

        block._speedState = block._paramState.speed;
        block._paramState = oldParamState;

        return value;
      }

      function clampSpeed(v) {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return 1;
        return clamp(n, 0.0625, 16);
      }

      function speedForSlot(block, slotIdx, time) {
        const stream = block.speed || { kind: 'scalar', value: 1 };
        let value = 1;

        if (stream.kind === 'scalar') {
          value = resolveSpeedAtom(block, stream.value, slotIdx, true, time);
        } else if (stream.kind === 'vector') {
          const len = stream.values.length;
          if (!len) return 1;
          const valueIndex = ((slotIdx % len) + len) % len;
          value = resolveSpeedAtom(block, stream.values[valueIndex], valueIndex, false, time);
        }

        const mod = attractorModForBlock(block, time);
        if (mod && mod.signals) {
          const lfo = slowCycle(block, time, 0.13 + mod.signals.periodicity * 0.12, 2.4);
            const speedMul = 1
              + mod.depth * mod.signals.periodicity * lfo * 0.035
              + mod.depth * mod.signals.rupture * (noiseCycle(block, time, 3.5, 4.9) - 0.5) * 0.045;
            value *= clamp(speedMul, 0.9, 1.12);
        }

        return clampSpeed(value);
      }

      function ensureSpeedCursor(block) {
        if (!Number.isFinite(block._speedSlotIdx)) block._speedSlotIdx = 0;
        if (!Number.isFinite(block._speedNextTime)) {
          block._speedNextTime = Math.max(originTime, audioCtx.currentTime);
        }
      }
      
      function countLeaves(node) {
        if (!node) return 0;
        if (node.kind === 'leaf') return 1;
        if (node.kind !== 'group' || !Array.isArray(node.children)) return 0;

        let total = 0;
        for (const child of node.children) {
          total += countLeaves(child);
        }
        return total;
      }

      function ensureLeafOffsets(block) {
        if (block._leafOffsets && block._leafCounts && block._leafTotal != null) return;

        const offsets = [];
        const counts = [];
        let cursor = 0;

        for (const slot of block.slots) {
          offsets.push(cursor);
          const n = Math.max(1, countLeaves(slot));
          counts.push(n);
          cursor += n;
        }

        block._leafOffsets = offsets;
        block._leafCounts = counts;
        block._leafTotal = Math.max(1, cursor);
      }

    // Resolve the active phrase position for a block at a given top-level
    // slot index. Returns:
    //   - { slotIndex, silent: false, inBlockIdx } if the phrase is firing
    //   - { slotIndex, silent: true } if 'every' has us in the silent portion
    function resolveBlockPosition(block, topSlotIdx) {
      if (block.every) {
        let periodSlots;
        if (block.every.unit === 'bars') {
          periodSlots = block.every.count * block.slotsPerBar;
        } else {
          const slotsPerBeat = block.slotsPerBar / program.meter.num;
          periodSlots = Math.max(1, Math.round(block.every.count * slotsPerBeat));
        }
        const positionInPeriod = ((topSlotIdx % periodSlots) + periodSlots) % periodSlots;
        if (positionInPeriod >= block.slots.length) {
          return { slotIndex: topSlotIdx, silent: true };
        }
        return { slotIndex: topSlotIdx, silent: false, inBlockIdx: positionInPeriod };
      }
      const inBlockIdx = ((topSlotIdx % block.slots.length) + block.slots.length) % block.slots.length;
      return { slotIndex: topSlotIdx, silent: false, inBlockIdx };
    }
      
      function tokenIsGated(tok) {
        if (!tok) return false;
        if (tok.gated === true) return true;
        if (tok.kind === 'sample-selector' && tok.value && tok.value.gated === true) return true;
        return false;
      }

      function dispatchSlotTree(node, time, duration, ctx) {
        if (!node) return;

        if (node.kind === 'leaf') {
          const tok = node.token;
          const leafIndex = ctx.leafCursor.index;
          ctx.leafCursor.index += 1;

          if (tok.kind === 'rest') return;

            const eventIndex = ((ctx.leafBase + leafIndex) % ctx.leafTotal + ctx.leafTotal) % ctx.leafTotal;
            const baseParams = resolveParamsForEvent(ctx.block, eventIndex, time);
            const attractorMod = attractorModForBlock(ctx.block, time);
            const params = applyAttractorToParams(ctx.block, baseParams, ctx.voice, time, duration, attractorMod);
            const eventBus = outputBusForBlock(ctx.block, time, attractorMod);

            const gated = tokenIsGated(tok);
            const gateDuration = gated
              ? duration * (Number.isFinite(params.gateMul) ? params.gateMul : 1)
              : null;

            if (ctx.voice === 'string') {
              if (typeof root.StringVoice === 'undefined') return;

              let note = null;

              if (tok.kind === 'note') {
                note = tok.value;
              } else if (tok.kind === 'note-random') {
                node._blockForAttractor = ctx.block;
                note = resolveRandomPitch(node, tok.value);
              }

              if (!note || !Number.isFinite(note.freq)) return;

                root.StringVoice.playString({
                  audioCtx,
                  masterBus: eventBus,
                  time,
                  freq: note.freq,
                  force: params.force,
                  decay: params.decay,
                  crush: params.crush,
                  tone: params.tone,
                  harm: params.harm,
                  octave: params.octave,
                  pan: params.pan,
                  gain: params.gain,
                  gateDuration,
                });
              return;
            }

            if (ctx.voice === 'sample') {
              if (typeof root.SampleVoice === 'undefined') return;

              let plan = null;

              if (tok.kind === 'sample') {
                plan = [{ name: tok.value, gainMul: 1 }];
              } else if (tok.kind === 'sample-selector') {
                plan = resolveSelector(node, tok.value, time, ctx.block);
              }

              if (!plan) return;

              const items = Array.isArray(plan) ? plan : [plan];

            for (const item of items) {
              if (!item || !item.name) continue;

              if (!root.SampleVoice.has(item.name)) {
                reportMissingSample(item.name);
                continue;
              }

              const gainMul = Number.isFinite(item.gainMul) ? item.gainMul : 1;

                root.SampleVoice.playSample({
                  audioCtx,
                  masterBus: eventBus,
                  time,
                  name: item.name,
                  gain: params.gain * gainMul,
                  pan: params.pan,
                  rate: params.rate,
                  start: params.start,
                  gateDuration,
                });
            }

            return;
          }

          return;
        }

        if (node.kind === 'group') {
          const n = node.children.length;
          if (n === 0) return;

          const subDur = duration / n;
          for (let i = 0; i < n; i++) {
            dispatchSlotTree(node.children[i], time + i * subDur, subDur, ctx);
          }
        }
      }

    // ---------- selector resolution ----------
    //
    // A 'sample-selector' slot maintains its random state on the AST node
    // itself (mutated each time the slot fires). Cached fields on the node:
    //   _pool        cached expansion of the selector's pieces against the
    //                manifest; recomputed if empty (e.g. before the manifest
    //                loaded). Plain array of sample names.
    //   _frozenPick  for `name!` with no gradient, the one chosen sample.
    //   _frozenPair  for `&N!`, the pair [A, B] picked once and oscillated.
    //   _gradStart   for `&N` (no !), the absolute time when the current
    //                window opened.
    //   _gradLeft / _gradRight
    //                current pair for the unfrozen gradient.
    //
      // Pick semantics within a gradient window: audio crossfade.
      // A gradient selector returns a play plan with BOTH samples in the active
      // pair. The scheduler schedules both on every trigger and applies
      // equal-power gain weights across the N-second window.
    function expandSelectorPool(selector) {
      if (typeof root.SampleVoice === 'undefined') return [];
      const seen = new Set();
      const pool = [];
      for (const piece of selector.pieces) {
        if (piece.kind === 'concrete') {
          if (root.SampleVoice.has(piece.name) && !seen.has(piece.name)) {
            seen.add(piece.name);
            pool.push(piece.name);
          }
          continue;
        }
        if (piece.kind === 'wildcard') {
          const expanded = root.SampleVoice.expandPrefix
            ? root.SampleVoice.expandPrefix(piece.prefix)
            : [];
          for (const name of expanded) {
            if (!seen.has(name)) {
              seen.add(name);
              pool.push(name);
            }
          }
        }
      }
      return pool;
    }

      function pickRandom(pool, block) {
        if (!pool || pool.length === 0) return null;

        const a = blockAttractor(block);
        if (!a) return pool[Math.floor(Math.random() * pool.length)];

        return attractorChoice(block, pool, (name, i, signals) => {
          const raw = String(name || '').toLowerCase();
          let w = 1;

          if (/tub|room|body|mic|voice|breath|water|glass|metal|noise|low|bass/.test(raw)) w += signals.density * 1.2;
          if (/hit|click|snap|burst|crack|impact|short|perc|strike/.test(raw)) w += signals.rupture * 1.8 + signals.volatility;
          if (/air|wind|hiss|bow|long|drone|pad|sustain/.test(raw)) w += signals.periodicity * 1.4 + signals.pressure * 0.5;
          if (/solar|electric|buzz|hum|grid|machine|motor/.test(raw)) w += signals.pressure * 1.2 + signals.intensity * 0.7;
          if (/quake|rock|earth|sub|rumble/.test(raw)) w += signals.rupture * 1.4 + signals.density;

          return w;
        });
      }

      function pickPair(pool, block) {
      if (!pool || pool.length === 0) return null;
      if (pool.length === 1) return [pool[0], pool[0]];
          const first = pickRandom(pool, block);
          let second = pickRandom(pool, block);
          if (pool.length > 1) {
            let guard = 0;
            while (second === first && guard < 8) {
              second = pickRandom(pool, block);
              guard++;
            }
            if (second === first) {
              const idx = pool.indexOf(first);
              second = pool[(idx + 1) % pool.length];
            }
          }
          return [first, second];
    }

      function clamp01(v) {
        if (!Number.isFinite(v)) return 0;
        return v < 0 ? 0 : v > 1 ? 1 : v;
      }

      function equalPowerPair(from, to, f) {
        const x = clamp01(f);
        return [
          { name: from, gainMul: Math.cos(x * Math.PI * 0.5) },
          { name: to, gainMul: Math.sin(x * Math.PI * 0.5) },
        ];
      }

      function resolveSelector(node, selector, time, block) {
        // Lazily re-expand the pool until the manifest produces samples.
        if (!node._pool || node._pool.length === 0) {
          node._pool = expandSelectorPool(selector);
          if (!node._pool || node._pool.length === 0) {
            // Manifest may not be loaded yet; report once with the raw token
            // so the user sees something rather than silence.
            reportMissingSample(selector.raw);
            return null;
          }
        }

        const pool = node._pool;

        // Case 1: no gradient. Return one scheduled sample.
        if (selector.gradientSec == null) {
          if (selector.frozen) {
            if (!node._frozenPick) node._frozenPick = pickRandom(pool, block);
            return node._frozenPick ? [{ name: node._frozenPick, gainMul: 1 }] : null;
          }

          const picked = pickRandom(pool, block);
          return picked ? [{ name: picked, gainMul: 1 }] : null;
        }

        // Case 2: gradient. Return two scheduled samples with gain weights.
        const N = Number(selector.gradientSec);
        if (!Number.isFinite(N) || N <= 0) {
          const picked = pickRandom(pool, block);
          return picked ? [{ name: picked, gainMul: 1 }] : null;
        }

        if (selector.frozen) {
          // Frozen pair, oscillating: A → B, then B → A, forever.
          if (!node._frozenPair) node._frozenPair = pickPair(pool, block);
          if (!node._frozenPair) return null;

          const [A, B] = node._frozenPair;
          const windowIdx = Math.floor(time / N);
          const windowStart = windowIdx * N;
          const f = (time - windowStart) / N;
          const from = windowIdx % 2 === 0 ? A : B;
          const to = windowIdx % 2 === 0 ? B : A;

          return equalPowerPair(from, to, f);
        }

        // Unfrozen rolling gradient:
        // window 1: A → B
        // window 2: B → C
        // window 3: C → D
        if (node._gradLeft == null || node._gradRight == null || !Number.isFinite(node._gradStart)) {
          const pair = pickPair(pool, block);
          if (!pair) return null;
          node._gradLeft = pair[0];
          node._gradRight = pair[1];
          node._gradStart = time;
        }

        // Advance the window if we've crossed one or more boundaries.
        while (time - node._gradStart >= N) {
          node._gradLeft = node._gradRight;
          node._gradRight = pickRandom(pool, block);
          node._gradStart += N;

          // Avoid A → A if the pool has more than one item.
          if (pool.length > 1 && node._gradRight === node._gradLeft) {
            let guard = 0;
            while (node._gradRight === node._gradLeft && guard < 8) {
              node._gradRight = pickRandom(pool, block);
              guard++;
            }
          }
        }

        const f = (time - node._gradStart) / N;
        return equalPowerPair(node._gradLeft, node._gradRight, f);
      }

      function dispatchTopSlot(block, slotIdx, slotAbsTime, slotDuration) {
        ensureLeafOffsets(block);

        const pos = resolveBlockPosition(block, slotIdx);
        if (pos.silent) return;

        const inBlockIdx = pos.inBlockIdx;
        const node = block.slots[inBlockIdx];
        if (!node) return;

        const phraseRepeat = block.slots.length > 0 ? Math.floor(slotIdx / block.slots.length) : 0;
        const leafBase = phraseRepeat * block._leafTotal + (block._leafOffsets[inBlockIdx] || 0);

        dispatchSlotTree(node, slotAbsTime, slotDuration, {
          block,
          voice: block.voice,
          leafBase,
          leafTotal: block._leafTotal,
          leafCursor: { index: 0 },
        });
      }

      function scheduleEvents() {
        if (!program || program.blocks.length === 0) return;

        const nowAbs = audioCtx.currentTime;
        const horizonAbs = nowAbs + SCHEDULE_AHEAD_S;
        const barSec = barSeconds(program);

        for (const block of program.blocks) {
          const baseSlotSec = barSec / block.slotsPerBar;
          if (!Number.isFinite(baseSlotSec) || baseSlotSec <= 0) continue;

          ensureSpeedCursor(block);

          // If the cursor is somehow behind the transport origin, snap it forward.
          if (block._speedNextTime < originTime) {
            block._speedNextTime = originTime;
            block._speedSlotIdx = 0;
          }

          let guard = 0;

          while (block._speedNextTime < horizonAbs && guard < 2048) {
            const slotIdx = Math.max(0, Math.floor(block._speedSlotIdx));
            const slotAbsTime = block._speedNextTime;
            const speed = speedForSlot(block, slotIdx, slotAbsTime);
            const slotDuration = baseSlotSec / speed;

            if (!Number.isFinite(slotDuration) || slotDuration <= 0) {
              block._speedNextTime += baseSlotSec;
              block._speedSlotIdx = slotIdx + 1;
              guard++;
              continue;
            }

            if (slotAbsTime + 0.001 >= nowAbs) {
              dispatchTopSlot(block, slotIdx, slotAbsTime, slotDuration);
              block._lastDispatchedSlotIdx = slotIdx;
              block._lastDispatchedTime = slotAbsTime;
              block._lastDispatchedDuration = slotDuration;
            }

            block._speedNextTime = slotAbsTime + slotDuration;
            block._speedSlotIdx = slotIdx + 1;
            block._scheduledThrough = block._speedSlotIdx;
            guard++;
          }

          if (guard >= 2048) {
            // Avoid locking the audio thread if a pathological speed state sneaks in.
            block._speedNextTime = nowAbs + baseSlotSec;
          }
        }
      }

    function tick() {
      if (!running || !program) return;
      try {
        scheduleEvents();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[repl scheduler] tick error:', err);
      }
    }

    // Returns current playhead state. Used by the visualizer.
    function now() {
      if (!program) return { bar: 0, beat: 0, transport: 0, blockStates: [] };
      const elapsed = Math.max(0, audioCtx.currentTime - originTime);
      const barSec = barSeconds(program);
      const totalBeats = (elapsed / barSec) * program.meter.num;
      const bar = Math.floor(elapsed / barSec);
      const beat = totalBeats - bar * program.meter.num;
        const blockStates = program.blocks.map((block, i) => {
          const lastIdx = Number.isFinite(block._lastDispatchedSlotIdx)
            ? block._lastDispatchedSlotIdx
            : 0;
          const slotIdx = Math.max(0, lastIdx);
          const lastTime = Number.isFinite(block._lastDispatchedTime)
            ? block._lastDispatchedTime
            : originTime;
          const lastDur = Number.isFinite(block._lastDispatchedDuration) && block._lastDispatchedDuration > 0
            ? block._lastDispatchedDuration
            : (barSec / block.slotsPerBar);
          const subProgress = clamp((audioCtx.currentTime - lastTime) / lastDur, 0, 1);
          const pos = resolveBlockPosition(block, slotIdx);
            const attractor = block.attractor
              ? (attractorSignalsForBlock(block, audioCtx.currentTime) || blockAttractor(block))
              : null;

            return {
              blockIndex: i,
              slotsPerBar: block.slotsPerBar,
              slotsTotal: block.slots.length,
              bars: block.bars,
              slotIdx,
              subProgress,
              silent: pos.silent,
              inBlockIdx: pos.silent ? -1 : pos.inBlockIdx,
              voice: block.voice,
              every: block.every,
              attractor: block.attractor,
              attractorState: attractor,
            };
      });
      return { bar, beat, transport: elapsed, blockStates };
    }

    return {
      start,
      stop,
      update,
      onMissingSample,
      now,
      isRunning: () => running,
    };
  }

  root.ReplScheduler = { create };
})(window);
