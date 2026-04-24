// obsidian-bass-v1.mjs — transport-locked JI bass that follows your drum kit bus
// Obsidian Bass — transport-locked JI bass that follows your drum kit bus.
// Exports default async ({ Tone, context, params, out }) => controller
//
// Controller is a function stop() with .update(patch) for live "set sN k v".
//

export default async function startObsidianBass({ Tone, context, params = {}, out }) {
  // ---------- defaults ----------
  const DEF = {
    // follow/feel
    followNs: 's1',           // which kit ns to listen to (SoundEngines.list)
    listen: 'auto',           // 'audio' | 'event' | 'auto'
    onsetThresh: 0.22,        // 0..1 RMS-ish threshold for onsets
    accentThresh: 0.58,       // 0..1 promotes "strong" hits
    sidechain: 0.30,          // 0..1 duck depth on each onset
    duckRelease: 0.16,        // seconds for release
    lag: 0,                   // ms, onset smoothing (reserved)

    // transport/grid
    bpm: null,                // if provided, set Transport
    grid: 16,                 // steps per bar
    interval: '1/16',         // how often to check/allow notes
    length: '1/8',            // note duration
    triplets: false,
    swing: 0.12,              // 0..0.4

    // harmony (JI)
    root: 'a1',
    oct: -1,
    ji: 'minor7',             // name or array of ratios
    mode: 'contour',          // 'fixed' | 'contour' | 'random'
    degrees: [0, 3, 4, 0],    // used in 'fixed'

    // voice / timbre
    subLevel: 0,              // dB
    fmLevel: -8,              // dB
    clickLevel: -14,          // dB
    fmIndex: 1.2,             // FM index
    fmRatio: 2.0,             // mod ratio (carrier:mod harmonicity)
    drive: 3,                 // dB → softclip intensity
    hpf: 28,                  // Hz
    lpf: 900,                 // Hz
    tilt: -2,                 // dB (low/high shelves ±tilt)
    gain: -2,                 // final dB
    debug: false
  };

  // ---------- state ----------
  const P = { ...DEF, ...coerceParams(params) };
  const jiSets = {
    minor7:  [1/1, 9/8, 6/5, 4/3, 3/2, 8/5, 9/5, 16/9, 2/1],
    blues5:  [1/1, 6/5, 4/3, 7/5, 3/2, 9/5, 2/1],
    neutral11: [1/1, 9/8, 11/9, 4/3, 3/2, 11/7, 2/1]
  };

  let ji = resolveJi(P.ji);
  let degreeIdx = 0;
  let analyserWave = null, analyserFFT = null, followSrc = null;
  let schedId = null;
  let lastRms = 0, hold = 0;

  // ---------- utility: log ----------
  const log = (...a) => { if (P.debug) console.log('[obsidian]', ...a); };

  // ---------- parse helpers ----------
  function noteToFreq(noteStr) {
    // 'a1', 'd#1', 'eb1' etc.
    const s = String(noteStr || 'a1').trim().toLowerCase();
    const m = s.match(/^([a-g])([#b]?)(-?\d)$/i);
    if (!m) return 55; // a1
    const n = m[1].toLowerCase();
    const acc = m[2];
    const oct = parseInt(m[3], 10);
    const map = { c:0, d:2, e:4, f:5, g:7, a:9, b:11 };
    let semis = map[n] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + (oct + 1) * 12; // a1 (55Hz) @ midi 33
    const midiA4 = 69, a4 = 440;
    const midi = semis + 12; // shift so c0=12; not crucial
    const hz = a4 * Math.pow(2, (midi - midiA4) / 12);
    return hz;
  }

  function resolveJi(val) {
    if (Array.isArray(val)) return val.map(Number).filter(x => x > 0);
    if (typeof val === 'string') {
      const s = val.trim();
      if (jiSets[s]) return jiSets[s].slice();
      // try to parse "[1, 9/8, 6/5]" or "1,9/8,6/5"
      const raw = s.replace(/[[\]]/g, '').split(/[,\s]+/).filter(Boolean);
      const arr = raw.map(x => {
        const f = String(x).split('/').map(Number);
        return f.length === 2 ? (f[0] / f[1]) : Number(x);
      }).filter(x => x > 0);
      if (arr.length) return arr;
    }
    return jiSets.minor7.slice();
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function dbToGain(db) { return Math.pow(10, (db || 0) / 20); }

  // ---------- audio graph ----------
  // layers
  const sub = new Tone.Oscillator({ type: 'sine', frequency: 55 }).start();
  const subEnv = new Tone.AmplitudeEnvelope({ attack: 0.003, decay: 0.08, sustain: 0.0, release: 0.12 });
  const subGain = new Tone.Gain(dbToGain(P.subLevel));

  const fm = new Tone.FMOscillator({
    type: 'sine', modulationType: 'sine',
    harmonicity: P.fmRatio, modulationIndex: P.fmIndex, frequency: 55
  }).start();
  const fmEnv = new Tone.AmplitudeEnvelope({ attack: 0.004, decay: 0.12, sustain: 0.0, release: 0.16 });
  const fmGain = new Tone.Gain(dbToGain(P.fmLevel));

  const click = new Tone.Noise('white').start();
  const clickEnv = new Tone.AmplitudeEnvelope({ attack: 0.0005, decay: 0.012, sustain: 0.0, release: 0.02 });
  const clickHP = new Tone.Filter(1200, 'highpass');
  const clickGain = new Tone.Gain(dbToGain(P.clickLevel));

  // tone shaping
  const preDrive = new Tone.Gain(1);
  const tiltEQ = new Tone.EQ3({ low: 0, mid: 0, high: 0 });
  const lp = new Tone.Filter(P.lpf, 'lowpass');
  const hp = new Tone.Filter(P.hpf, 'highpass');
  const drive = new Tone.WaveShaper(makeClipCurve(P.drive), 1024);
  const duckGain = new Tone.Gain(1);
  const outGain = new Tone.Gain(dbToGain(P.gain));

  // connections
  sub.connect(subEnv).connect(subGain);
  fm.connect(fmEnv).connect(fmGain);
  click.connect(clickHP).connect(clickEnv).connect(clickGain);

  const mix = new Tone.Gain(1);
  subGain.connect(mix);
  fmGain.connect(mix);
  clickGain.connect(mix);

  mix.connect(preDrive);
  preDrive.connect(tiltEQ);
  tiltEQ.connect(lp);
  lp.connect(hp);
  hp.connect(drive);
  drive.connect(duckGain);
  duckGain.connect(outGain);
  outGain.connect(out); // provided by SoundEngines

  // ---------- sidechain (envelope on duckGain) ----------
  function duckOnce() {
    const now = Tone.now();
    const depth = clamp(P.sidechain, 0, 1);
    if (depth <= 0) return;
    const minG = 1 - depth;     // dip to
    duckGain.gain.cancelAndHoldAtTime(now);
    duckGain.gain.setValueAtTime(duckGain.gain.value, now);
    duckGain.gain.linearRampToValueAtTime(minG, now + 0.015);
    duckGain.gain.exponentialRampToValueAtTime(1.0, now + P.duckRelease);
  }

  // ---------- Transport ----------
  if (typeof P.bpm === 'number' && P.bpm > 0) Tone.Transport.bpm.value = P.bpm;
  Tone.Transport.swing = clamp(P.swing, 0, 0.5);
  Tone.Transport.swingSubdivision = P.triplets ? '8t' : '16n';
  if (Tone.Transport.state !== 'started') Tone.Transport.start();

  // ---------- follow kit (audio) ----------
  function attachAnalyser() {
    detachAnalyser();
    const kit = pickFollowSource(P.followNs);
    if (!kit || !kit.bus || typeof kit.bus.connect !== 'function') {
      log('no follow bus found for', P.followNs);
      return;
    }
    followSrc = kit.bus;
    analyserWave = new Tone.Analyser('waveform', 1024);
    analyserFFT  = new Tone.Analyser('fft', 256);
    try { followSrc.connect(analyserWave); followSrc.connect(analyserFFT); } catch(_) {}
    log('attached analyser to', kit.ns, kit.slug || kit.item?.slug || '');
  }

  function detachAnalyser() {
    if (followSrc && analyserWave) { try { followSrc.disconnect(analyserWave); } catch(_) {} }
    if (followSrc && analyserFFT)  { try { followSrc.disconnect(analyserFFT); }  catch(_) {} }
    analyserWave = null; analyserFFT = null; followSrc = null;
  }

  function pickFollowSource(nsWanted) {
    try{
      const E = (window.SoundEngines || {});
      const list = (typeof E.list === 'function') ? E.list() : [];
      if (!Array.isArray(list) || !list.length) return null;
      if (nsWanted) {
        const exact = list.find(e => (e?.ns || '').toLowerCase() === String(nsWanted).toLowerCase());
        if (exact) return exact;
      }
      // otherwise: most recent Tone engine with a bus
      return list.slice().reverse().find(e => e.engine === 'tone' && e.bus);
    }catch(_){}
    return null;
  }

  attachAnalyser();

  // ---------- event follow (optional) ----------
  let beatHandler = null;
  let lastBeatBar = -1, lastBeatStep = -1;

  if (P.listen === 'event' || P.listen === 'auto') {
    beatHandler = (ev) => {
      const d = ev?.detail || {};
      if (P.followNs && d.ns && String(d.ns).toLowerCase() !== String(P.followNs).toLowerCase()) return;
      // promote to a scheduled note at next grid slot
      handleOnset(d.accent || 0.8, true);
    };
    try { window.addEventListener('cb:beat', beatHandler); } catch(_) {}
  }

  // ---------- scheduler ----------
  const intervalSubdiv = P.interval;
  schedId = Tone.Transport.scheduleRepeat(tick, intervalSubdiv);

  function tick(time) {
    // Audio-follow onset detection (if analyser attached or listen=='audio')
    if ((P.listen === 'audio' || P.listen === 'auto') && analyserWave) {
      const buf = analyserWave.getValue();
      const rms = rms01(buf);
      const acc = clamp((rms - P.onsetThresh) / Math.max(1e-6, 1 - P.onsetThresh), 0, 1);
      // simple rising-edge + hysteresis
      const onset = (rms > P.onsetThresh) && (lastRms <= P.onsetThresh);
      lastRms = rms;
      if (onset) handleOnset(acc, false, time);
    }
    // else: if strictly event mode, do nothing here
  }

  function handleOnset(accent = 0.8, fromEvent = false, time = Tone.now()) {
    // choose a degree
    const deg = chooseDegree(accent);
    const f0 = noteToFreq(P.root) * Math.pow(2, P.oct);
    const ratio = ji[wrap(deg, ji.length)] || 1;
    const freq = f0 * ratio;
    triggerVoice(freq, accent, time);
    duckOnce();
  }

  function triggerVoice(freq, accent, time) {
    const v = 0.5 + 0.5 * clamp(accent, 0, 1); // 0.5..1
    const now = Math.max(time, Tone.now());

    // pitch/osc
    sub.frequency.cancelScheduledValues(now);
    fm.frequency.cancelScheduledValues(now);

    // tiny pitch blip on sub
    sub.frequency.setValueAtTime(freq * 1.5, now);
    sub.frequency.exponentialRampToValueAtTime(freq, now + 0.03);
    fm.frequency.setValueAtTime(freq, now);

    // envelopes (velocity to gain)
    subEnv.triggerAttackRelease(P.length, now, v);
    fmEnv.triggerAttackRelease(P.length, now, clamp(v * 0.9, 0, 1));
    clickEnv.triggerAttackRelease(0.02, now, clamp(v * 0.6, 0, 1));
  }

  // ---------- helpers: degrees & contour ----------
  function chooseDegree(accent) {
    if (P.mode === 'fixed' && Array.isArray(P.degrees) && P.degrees.length) {
      const d = Number(P.degrees[wrap(degreeIdx++, P.degrees.length)]) || 0;
      return wrap(d, ji.length);
    }
    if (P.mode === 'random') {
      // weight accents to prefer 1/1, 3/2, 4/3
      const pref = [0, 3, 4]; // indices in minor7
      const wMain = 0.5 + 0.5 * clamp(accent, 0, 1);
      if (Math.random() < wMain) return pref[(Math.random() * pref.length)|0] % ji.length;
      return (Math.random() * ji.length) | 0;
    }
    // contour: use FFT low-vs-high energy to pick degree
    let idx = 0;
    if (analyserFFT) {
      const arr = analyserFFT.getValue(); // dB array (negative)
      const N = arr.length;
      let low = 0, hi = 0;
      for (let i = 0; i < N; i++) {
        const lin = dbToLin(arr[i]);
        if (i < N * 0.25) low += lin;
        else hi += lin;
      }
      const tilt = (low - hi) / Math.max(1e-6, low + hi); // -1..1
      // map tilt (-1..1) + accent (0..1) to degree index
      const t = clamp(0.5 + 0.5 * tilt, 0, 1); // 0..1
      const a = clamp(accent, 0, 1);
      const pos = (0.7 * t + 0.3 * a); // bias with accent
      idx = Math.floor(pos * (ji.length - 1));
    }
    return wrap(idx, ji.length);
  }

  function dbToLin(db) { return Math.pow(10, (db || -120) / 20); }
  function wrap(i, n) { return ((i % n) + n) % n; }

  // ---------- processors: curves & tilt ----------
  function makeClipCurve(db) {
    const k = clamp(db, 0, 24);
    const amt = (k / 24) * 2.5; // soft
    const N = 1024;
    const curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * (1 + amt * 5));
    }
    return curve;
  }

  function applyTilt(db) {
    // ±db to lows/highs symmetrically
    tiltEQ.low.value = clamp(db, -12, 12);
    tiltEQ.high.value = clamp(db, -12, 12);
    tiltEQ.mid.value = 0;
  }

  // ---------- meters & RMS ----------
  function rms01(buf) {
    if (!buf || !buf.length) return 0;
    let s = 0;
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i] || 0;
      s += x * x;
    }
    const rms = Math.sqrt(s / buf.length);
    // map to 0..1 (light companding)
    return clamp(Math.pow(rms, 0.6), 0, 1);
  }

  // ---------- live update ----------
  function update(patch = {}) {
    Object.assign(P, coerceParams(patch));
    // transport/grid
    if (typeof P.bpm === 'number' && P.bpm > 0) Tone.Transport.bpm.value = P.bpm;
    Tone.Transport.swing = clamp(P.swing, 0, 0.5);
    Tone.Transport.swingSubdivision = P.triplets ? '8t' : '16n';

    // follow reattach?
    if (patch.followNs !== undefined || patch.listen !== undefined) {
      detachAnalyser();
      if (P.listen === 'audio' || P.listen === 'auto') attachAnalyser();
    }

    // ji / harmony
    if (patch.ji !== undefined) ji = resolveJi(P.ji);
    if (patch.degrees !== undefined) {
      // allow "1,2,3" or "[1,2,3]"
      P.degrees = parseArrayLike(P.degrees, P.degrees);
    }

    // timbre/gain
    try { subGain.gain.rampTo(dbToGain(P.subLevel), 0.04); } catch(_) {}
    try { fmGain.gain.rampTo(dbToGain(P.fmLevel), 0.04); } catch(_) {}
    try { clickGain.gain.rampTo(dbToGain(P.clickLevel), 0.02); } catch(_) {}
    try { lp.frequency.rampTo(P.lpf, 0.05); } catch(_) {}
    try { hp.frequency.rampTo(P.hpf, 0.05); } catch(_) {}
    try { applyTilt(P.tilt); } catch(_) {}
    try { outGain.gain.rampTo(dbToGain(P.gain), 0.05); } catch(_) {}
    if (patch.fmIndex !== undefined) try { fm.modulationIndex.value = P.fmIndex; } catch(_) {}
    if (patch.fmRatio !== undefined) try { fm.harmonicity.value = P.fmRatio; } catch(_) {}
    if (patch.drive !== undefined) try { drive.setCurve(makeClipCurve(P.drive)); } catch(_) {}

    return true;
  }

  // ---------- small helpers to parse arrays from set-command strings ----------
  function parseArrayLike(v, fallback = []) {
    if (Array.isArray(v)) return v.map(n => Number(n) || 0);
    if (typeof v === 'string') {
      const s = v.replace(/[[\]]/g, '');
      const arr = s.split(/[,\s]+/).filter(Boolean).map(x => Number(x) || 0);
      if (arr.length) return arr;
    }
    return Array.isArray(fallback) ? fallback : [];
  }

  function coerceParams(obj) {
    // Gentle coercion; keep strings for note names etc.
    const out = { ...obj };
    for (const k in out) {
      const v = out[k];
      if (typeof v === 'string') {
        const s = v.trim();
        if (/^-?\d+(\.\d+)?$/.test(s)) out[k] = Number(s);
        else if (/^(true|false)$/i.test(s)) out[k] = /true/i.test(s);
        else if (/^\[.*\]$/.test(s) || s.includes(',')) {
          // will be parsed where needed (degrees/ji)
          out[k] = s;
        }
      }
    }
    return out;
  }

  // ---------- teardown ----------
  function stop() {
    try { Tone.Transport.clear(schedId); } catch(_) {}
    try { window.removeEventListener('cb:beat', beatHandler); } catch(_) {}
    try { detachAnalyser(); } catch(_) {}
    try { sub.stop(); fm.stop(); click.stop(); } catch(_) {}
    [sub, subEnv, subGain, fm, fmEnv, fmGain, click, clickEnv, clickHP,
     preDrive, tiltEQ, lp, hp, drive, duckGain, outGain].forEach(n => { try { n.dispose(); } catch(_){} });
  }
  stop.update = update;

  // initial tilt & filters & gains
  applyTilt(P.tilt);
  update({}); // apply initial params coherently

  log('ready.');
  return stop;
}
