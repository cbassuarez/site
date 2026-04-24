// tungsten-kick.mjs (safe build)
// Transport-locked kick with step/density patterns.
// Works with your SoundEngines runner (expects { Tone, context, params, out }).

export default async function start({ Tone, context, params = {}, out }) {
  // -------- Defaults --------
  const P = {
    // Pattern
    grid: '16n',                 // '4n'|'8n'|'16n'|'32n'
    pattern: '',                 // e.g. "x---x---x---x---" (uppercase X = accent)
    density: 1.0,                // used when pattern is empty
    seed: 0,

    // Tone / synth
    baseNote: 'C1',              // ~49 Hz
    tune: 0,                     // semitones
    thump: 0.28,                 // body decay (s)
    hold: 0.002,                 // body attack/hold (s)
    pitchAmt: 18,                // semitone sweep
    pitchEnv: 0.04,              // sweep time (s)

    // Click
    click: 0.35,                 // 0..1
    clickTone: 4200,             // Hz

    // FX / gain
    drive: 0.35,                 // 0..1 (Tone.Distortion)
    lpf: 16000,                  // Hz (final lowpass)
    comp: 5,                     // 0..10 strength → ratio
    gain: -6,                    // dB

    // Feel
    humanize: 0.004,             // ± s
    accent: 0.2                  // +vel when 'X'
  };
  Object.assign(P, params || {});

  // -------- Helpers --------
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const dbToGain = (db) => Math.pow(10, db / 20);

  // Deterministic RNG for density
  let rng = P.seed >>> 0;
  const rnd = () => {
    rng ^= rng << 13; rng >>>= 0;
    rng ^= rng >> 17; rng >>>= 0;
    rng ^= rng << 5;  rng >>>= 0;
    return (rng >>> 0) / 4294967296;
  };

  function parsePattern(str = '', grid = '16n') {
    const s = String(str || '').replace(/\s+/g, '');
    if (!s) return null;
    const steps = [...s].map((ch) => (ch === 'X' ? 'X' : ch === 'x' || ch === 'o' ? 'x' : '-'));
    return { steps, grid };
  }

  function noteFrom(base = 'C1', semi = 0) {
    try { return Tone.Frequency(base).transpose(semi | 0).toNote(); }
    catch { return 'C1'; }
  }

  // -------- Audio graph --------
  // Body (MembraneSynth is reliable in Tone v14)
  const body = new Tone.MembraneSynth({
    envelope: { attack: P.hold, decay: P.thump, sustain: 0, release: 0 },
    octaves: clamp(P.pitchAmt / 12, 0.2, 4.0),
    pitchDecay: clamp(P.pitchEnv, 0.005, 0.2),
    volume: -3
  });

  // Click: white noise → LPF → AmpEnv → gain
  const clickNoise = new Tone.Noise('white');
  const clickLP = new Tone.Filter(P.clickTone, 'lowpass');
  const clickEnv = new Tone.AmplitudeEnvelope({ attack: 0.0005, decay: 0.012, sustain: 0, release: 0.01 });
  const clickGain = new Tone.Gain(clamp(P.click, 0, 1));

  clickNoise.connect(clickLP);
  clickLP.connect(clickEnv);
  clickEnv.connect(clickGain);

  // FX
  const premix = new Tone.Gain(1);
  const drive = new Tone.Distortion(clamp(P.drive, 0, 1), '2x');
  const comp = new Tone.Compressor({
    threshold: -14,
    ratio: 3 + clamp(P.comp, 0, 10) * 0.3,
    attack: 0.006,
    release: 0.12
  });
  const postLP = new Tone.Filter(P.lpf, 'lowpass');
  const finalGain = new Tone.Gain(dbToGain(P.gain));

  // Routing
  body.connect(premix);
  clickGain.connect(premix);
  premix.connect(drive);
  drive.connect(comp);
  comp.connect(postLP);
  postLP.connect(finalGain);
  if (out && typeof out.connect === 'function') finalGain.connect(out);

  // Keep noise running; envelope gates it per-hit
  try { clickNoise.start(); } catch(_) {}

  // -------- Sequencing --------
  let seq = null;
  let stepIdx = 0;
  let parsed = parsePattern(P.pattern, P.grid);

  function triggerAt(time, accented = false) {
    const j = clamp((Math.random() - 0.5) * 2 * (P.humanize || 0), -0.02, 0.02);
    const t = time + j;

    // Update synth params that matter per-hit
    body.set({
      envelope: { attack: clamp(P.hold, 0.0002, 0.02), decay: clamp(P.thump, 0.04, 1.2), sustain: 0, release: 0 },
      octaves: clamp(P.pitchAmt / 12, 0.2, 4.0),
      pitchDecay: clamp(P.pitchEnv, 0.005, 0.2)
    });

    const n = noteFrom(P.baseNote, P.tune | 0);
    const vel = clamp(0.95 + (accented ? clamp(P.accent, 0, 1) : 0), 0, 1);

    try { body.triggerAttackRelease(n, '8n', t, vel); } catch(_){}

    // Click shading
    try {
      clickLP.frequency.cancelAndHoldAtTime(t);
      clickLP.frequency.setValueAtTime(clamp(P.clickTone, 300, 16000), t);
      clickGain.gain.cancelAndHoldAtTime(t);
      clickGain.gain.setValueAtTime(clamp(P.click, 0, 1), t);
      clickEnv.triggerAttackRelease('8n', t);
    } catch(_){}
  }

  function rebuildSeq() {
    if (seq) { try { seq.stop(0); seq.dispose(); } catch(_){} seq = null; }
    parsed = parsePattern(P.pattern, P.grid);
    stepIdx = 0;

    if (parsed && parsed.steps && parsed.steps.length) {
      const steps = parsed.steps.slice();
      seq = new Tone.Loop((time) => {
        const ch = steps[stepIdx % steps.length];
        if (ch === 'x' || ch === 'X') triggerAt(time, ch === 'X');
        stepIdx++;
      }, P.grid);
    } else {
      seq = new Tone.Loop((time) => {
        const p = clamp(P.density, 0, 1);
        const r = P.seed ? rnd() : Math.random();
        if (r < p) triggerAt(time, false);
        stepIdx++;
      }, P.grid);
    }
    seq.start(0);
  }

  rebuildSeq();

  // -------- Controller --------
  let disposed = false;
  const controller = async function stop() {
    if (disposed) return;
    disposed = true;
    try { if (seq) { seq.stop(0); seq.dispose(); } } catch(_){}
    try { clickNoise.stop(); } catch(_){}
    [body, clickLP, clickEnv, clickGain, premix, drive, comp, postLP, finalGain]
      .forEach(n => { try { n.dispose && n.dispose(); } catch(_){ } });
  };

  controller.update = (patch = {}) => {
    Object.assign(P, patch || {});
    if (patch.pattern !== undefined || patch.grid !== undefined || patch.density !== undefined || patch.seed !== undefined) {
      if (patch.seed !== undefined) rng = (P.seed >>> 0);
      rebuildSeq();
    }
    if (patch.click !== undefined) clickGain.gain.rampTo(clamp(P.click, 0, 1), 0.03);
    if (patch.clickTone !== undefined) clickLP.frequency.rampTo(clamp(P.clickTone, 300, 16000), 0.03);
    if (patch.drive !== undefined) drive.distortion = clamp(P.drive, 0, 1);
    if (patch.comp !== undefined) comp.ratio = 3 + clamp(P.comp, 0, 10) * 0.3;
    if (patch.lpf  !== undefined) postLP.frequency.rampTo(clamp(P.lpf, 200, 20000), 0.03);
    if (patch.gain !== undefined) finalGain.gain.rampTo(dbToGain(P.gain), 0.02);
    // hold/thump/pitch params are applied at the next hit in triggerAt()
    return true;
  };

  controller.params = () => ({ ...P });

  return controller;
}
