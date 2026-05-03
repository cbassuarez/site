// String voice — Karplus-Strong-flavored harmonic plucker, ported from
// /labs/string. Parameterized by the REPL's mini-DSL so each event drives
// one pluck with its own force/decay/crush/tone/harm/octave/pan/gain.
//
// Exposes:
//   StringVoice.ensureAudio() → AudioContext (or null if unsupported)
//   StringVoice.playString({ audioCtx, masterBus, time, freq, params })
//
// 'params' is the resolved DSL row values for this slot (post-defaults).

(function (root) {
  'use strict';

  const PITCH_LOW_HZ = 41.2;     // E1
  const PITCH_HIGH_HZ = 1046.5;  // C6
  const VOICE_ATTACK_S = 0.030;
  const DECAY_FLOOR = 0.0005;

  // Harmonic-mode lookup (DSL: simple/pair/triad/rich → 1..4).
  const HARM_MODE = { simple: 1, pair: 2, triad: 3, rich: 4 };

    const _bitcrushCurves = new Map();
    const _activeVoices = new Set();
  function getBitcrushCurve(bits) {
    if (_bitcrushCurves.has(bits)) return _bitcrushCurves.get(bits);
    const samples = 8192;
    const curve = new Float32Array(samples);
    const levels = Math.pow(2, bits);
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * 2 - 1;
      curve[i] = Math.round(x * levels) / levels;
    }
    _bitcrushCurves.set(bits, curve);
    return curve;
  }
    
    function unregisterVoice(active) {
      if (!active) return;
      _activeVoices.delete(active);
    }

  function clamp(v, lo, hi) {
    const n = Number(v);
    if (!Number.isFinite(n)) return lo;
    return n < lo ? lo : n > hi ? hi : n;
  }
  function clamp01(v) { return clamp(v, 0, 1); }
    
    function isParamGesture(v) {
      return v && typeof v === 'object' && v.kind === 'param-gesture';
    }

    function numericParamValue(v, fallback) {
      if (isParamGesture(v)) {
        const from = Number(v.from);
        return Number.isFinite(from) ? from : fallback;
      }

      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    }

    function applyAudioParamValue(param, value, time, duration, lo, hi, fallback) {
      if (!param) return;

      const start = Number.isFinite(time) ? time : 0;
      const min = Number.isFinite(lo) ? lo : -Infinity;
      const max = Number.isFinite(hi) ? hi : Infinity;
      const fb = Number.isFinite(fallback) ? fallback : 0;

      if (isParamGesture(value)) {
        const dur = Number(duration);
        const end = start + (Number.isFinite(dur) && dur > 0 ? dur : 0.25);
        const mode = value.mode || value.op || '';

        if (mode === 'continuous-random') {
          const gestureLo = Number.isFinite(Number(value.lo)) ? Number(value.lo) : min;
          const gestureHi = Number.isFinite(Number(value.hi)) ? Number(value.hi) : max;
          const safeLo = Number.isFinite(gestureLo) ? gestureLo : min;
          const safeHi = Number.isFinite(gestureHi) ? gestureHi : max;
          const rateHz = Number.isFinite(Number(value.rateHz)) ? Number(value.rateHz) : 8;
          const step = Math.max(0.025, Math.min(0.25, 1 / rateHz));

          let t = start;
          let current = clamp(numericParamValue(value, fb), safeLo, safeHi);

          try {
            param.cancelScheduledValues(start);
            param.setValueAtTime(current, start);

            while (t < end - 0.0001) {
              const nextT = Math.min(end, t + step);
              const next = clamp(randomBetween(safeLo, safeHi), safeLo, safeHi);
              param.linearRampToValueAtTime(next, Math.max(start + 0.006, nextT));
              current = next;
              t = nextT;
            }

            return;
          } catch (_) {
            try { param.value = current; } catch (__) {}
            return;
          }
        }

        const from = clamp(numericParamValue(value.from, fb), min, max);
        const to = clamp(numericParamValue(value.to, from), min, max);

        try {
          param.cancelScheduledValues(start);
          param.setValueAtTime(from, start);
          param.linearRampToValueAtTime(to, Math.max(start + 0.006, end));
          return;
        } catch (_) {
          try { param.value = from; } catch (__) {}
          return;
        }
      }

      const scalar = clamp(numericParamValue(value, fb), min, max);

      try {
        param.setValueAtTime(scalar, start);
      } catch (_) {
        try { param.value = scalar; } catch (__) {}
      }
    }

  // Reverse-engineer x01 (pluck position 0..1) from a desired pitch in Hz.
  // The string lab maps x01 → frequency exponentially across the band,
  // so x01 = log(freq / LOW) / log(HIGH / LOW). Octave shifts don't change
  // the pluck position.
  function freqToX01(freqHz) {
    const f = Math.max(PITCH_LOW_HZ, Math.min(PITCH_HIGH_HZ, freqHz));
    const ratio = Math.log(f / PITCH_LOW_HZ) / Math.log(PITCH_HIGH_HZ / PITCH_LOW_HZ);
    return clamp01(ratio);
  }

  function edgeExcitationGain(x01) {
    const center01 = 1 - Math.abs(clamp01(x01) - 0.5) * 2;
    const FLOOR = 0.28;
    return FLOOR + (1 - FLOOR) * center01;
  }

  function resolveHarm(value) {
    if (typeof value === 'number') return Math.round(clamp(value, 0, 4));
    const key = String(value || '').toLowerCase();
    if (key in HARM_MODE) return HARM_MODE[key];
    return 2;
  }

  // ---------------- audio context bootstrap ----------------

  let _audioCtx = null;
  let _masterBus = null;

  function ensureAudio() {
    if (_audioCtx) return _audioCtx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    _audioCtx = new Ctor();
    const compressor = _audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 8;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.25;
    _masterBus = _audioCtx.createGain();
    _masterBus.gain.value = 0.45;
    _masterBus.connect(compressor);
    compressor.connect(_audioCtx.destination);
    return _audioCtx;
  }

  function getMasterBus() {
    ensureAudio();
    return _masterBus;
  }

  function resume() {
    if (_audioCtx && _audioCtx.state === 'suspended') {
      return _audioCtx.resume().catch(() => {});
    }
    return Promise.resolve();
  }

  // ---------------- one-shot playback ----------------

  // params (all optional; defaults below):
  //   freq      Hz (required for note slots)
  //   force     0..1
  //   decay     seconds
  //   crush     bit depth (0 = off, 4..16)
  //   tone      0..1 (lowpass openness)
  //   harm      0..4 partials added (1=fundamental only, etc.)
  //   octave    integer ±2
  //   detune    cents ±50
    //   pan          -1..1
    //   gain         0..1.5 output level
    //   gateDuration seconds; if present, release/stop by the end of this rhythmic unit
    function playString(opts) {
    const audioCtx = opts && opts.audioCtx ? opts.audioCtx : ensureAudio();
    if (!audioCtx) return;
    const masterBus = opts && opts.masterBus ? opts.masterBus : getMasterBus();
    if (!masterBus) return;

    const freq = Number(opts.freq);
    if (!Number.isFinite(freq) || freq <= 0) return;
    const time = Number.isFinite(opts.time) ? Math.max(opts.time, audioCtx.currentTime) : audioCtx.currentTime;
        const activeVoice = {
          oscillators: [],
          env: null,
          pending: 0,
          startTime: time,
        };
        _activeVoices.add(activeVoice);
        
        const force = clamp01(numericParamValue(opts.force, 0.7));
        const decaySec = clamp(numericParamValue(opts.decay, 4.2), 0.4, 8);

        const crushBits = (() => {
          const n = numericParamValue(opts.crush, 0);
          if (!Number.isFinite(n) || n <= 0) return 0;
          return clamp(Math.round(n), 4, 16);
        })();

        const toneBright = clamp01(numericParamValue(opts.tone, 0.6));
        const harm = resolveHarm(numericParamValue(opts.harm, 2));
        const octaveShift = clamp(Math.round(numericParamValue(opts.octave, 0)), -2, 2);
        const detuneCents = clamp(numericParamValue(opts.detune, 0), -50, 50);

        const panVal = clamp(numericParamValue(opts.pan, 0), -1, 1);
        const panGestureDuration = Number.isFinite(Number(opts.panGestureDuration)) && Number(opts.panGestureDuration) > 0
          ? Number(opts.panGestureDuration)
          : null;

        const gainVal = clamp(numericParamValue(opts.gain, 1), 0, 1.5);
        const rawGateDuration = Number(opts.gateDuration);
        const gateDuration = Number.isFinite(rawGateDuration) && rawGateDuration > 0
          ? rawGateDuration
          : null;

        const x01 = freqToX01(freq);
    const playFreq = freq * Math.pow(2, octaveShift) * Math.pow(2, detuneCents / 1200);

    const edgeGain = edgeExcitationGain(x01);
    const pickBrightness = clamp(0.45 + Math.abs(x01 - 0.5) * 1.2 + force * 0.35, 0.2, 1.55);

        const env = audioCtx.createGain();
        activeVoice.env = env;
        const attackSec = VOICE_ATTACK_S * (1.48 - toneBright * 0.75);
        const attackEnd = time + Math.max(0.003, attackSec);
        const gainScale = clamp(gainVal * (0.68 + edgeGain * 0.42 + force * 0.26), 0, 1.25);

        env.gain.setValueAtTime(0, time);
        env.gain.linearRampToValueAtTime(gainScale * 0.40, attackEnd);

        if (gateDuration != null) {
          const gateEnd = time + gateDuration;
          const release = Math.min(0.02, Math.max(0.006, gateDuration * 0.25));
          const releaseStart = Math.max(attackEnd + 0.001, gateEnd - release);
          const preReleaseLevel = Math.max(DECAY_FLOOR * 10, gainScale * 0.035);

          if (releaseStart > attackEnd + 0.001) {
            env.gain.exponentialRampToValueAtTime(preReleaseLevel, releaseStart);
          }

          env.gain.linearRampToValueAtTime(0, Math.max(gateEnd, releaseStart + 0.001));
        } else {
          env.gain.exponentialRampToValueAtTime(DECAY_FLOOR, time + decaySec);
        }

        const naturalStopTime = time + decaySec + 0.05;
        const gatedStopTime = gateDuration != null
          ? time + gateDuration + 0.05
          : naturalStopTime;
        const sourceStopTime = Math.max(time + 0.02, Math.min(naturalStopTime, gatedStopTime));

        function addPartial(f, partialGain, harmonicN) {
          const osc = audioCtx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(f, time);

          const pg = audioCtx.createGain();
          const pickMode = 0.20 + 0.80 * Math.abs(Math.sin(Math.PI * harmonicN * x01));
          pg.gain.value = partialGain * pickMode;

          osc.connect(pg).connect(env);

          activeVoice.pending += 1;
          activeVoice.oscillators.push(osc);

          osc.onended = () => {
            activeVoice.pending -= 1;
            if (activeVoice.pending <= 0) {
              unregisterVoice(activeVoice);
            }
          };

          try {
            osc.start(time);
            osc.stop(sourceStopTime);
          } catch (_) {
            activeVoice.pending -= 1;
            unregisterVoice(activeVoice);
          }
        }
    addPartial(playFreq, 1, 1);
    if (harm >= 1) addPartial(playFreq * 2, 0.12 + pickBrightness * 0.22, 2);
    if (harm >= 2) addPartial(playFreq * 3, 0.04 + pickBrightness * 0.18, 3);
    if (harm >= 3) addPartial(playFreq * 4, 0.02 + pickBrightness * 0.14, 4);
    if (harm >= 4) addPartial(playFreq * 5, 0.01 + pickBrightness * 0.10, 5);

    let signal = env;
    if (crushBits > 0) {
      const shaper = audioCtx.createWaveShaper();
      shaper.curve = getBitcrushCurve(crushBits);
      env.connect(shaper);
      signal = shaper;
    }

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900 + (toneBright * 6200 + pickBrightness * 2500), time);
    filter.Q.setValueAtTime(0.65 + toneBright * 1.8 + force * 0.8, time);
    signal.connect(filter);
    signal = filter;

        if (audioCtx.createStereoPanner) {
          const pan = audioCtx.createStereoPanner();
          applyAudioParamValue(pan.pan, opts.pan, time, panGestureDuration, -1, 1, panVal);
          signal.connect(pan);
          signal = pan;
        }
    signal.connect(masterBus);
  }
    function stopAll(when) {
      const t = Number.isFinite(when)
        ? Math.max(when, _audioCtx ? _audioCtx.currentTime : 0)
        : (_audioCtx ? _audioCtx.currentTime : 0);

      for (const active of Array.from(_activeVoices)) {
        if (!active) continue;

        const startTime = Number.isFinite(active.startTime) ? active.startTime : t;
        const oscStopTime = Math.max(t + 0.025, startTime + 0.001);

        if (active.env && active.env.gain) {
          try {
            active.env.gain.cancelScheduledValues(t);
            active.env.gain.setValueAtTime(active.env.gain.value || 0, t);
            active.env.gain.linearRampToValueAtTime(0, t + 0.025);
          } catch (_) {
            try { active.env.gain.value = 0; } catch (__) {}
          }
        }

        for (const osc of active.oscillators || []) {
          try {
            osc.stop(oscStopTime);
          } catch (_) {
            // Already stopped, never started, or already given a stop time.
          }
        }

        unregisterVoice(active);
      }
    }
    root.StringVoice = {
      ensureAudio,
      getMasterBus,
      resume,
      playString,
      stopAll,
    };
})(window);
