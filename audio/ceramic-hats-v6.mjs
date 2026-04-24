// title: ceramic-hats
// engine: tone
export default async function start({ Tone, out, params } = {}) {
  await Tone.start();
  if (Tone.Transport.state !== "started") {
    try { Tone.Transport.start("+0.02"); } catch(_) {}
  }

  // ---------- helpers ----------
  const num = (v, d)=> (isFinite(+v) ? +v : d);
  const clamp01 = v => Math.max(0, Math.min(1, num(v, 0)));
  const int = (v, lo, hi)=> {
    v = Math.floor(num(v, lo));
    return Math.max(lo, Math.min(hi, v));
  };

  // ---------- state ----------
  const state = {
    mode:   String(params?.mode || "pattern"),  // "pattern" | "dens"
    steps:  String(params?.pattern ?? params?.steps ?? "x.x.x.x.x.x.x.x.").replace(/\s+/g,""),
    len:    int(params?.len ?? params?.length ?? 16, 1, 64),
    dens:   clamp01(params?.density ?? params?.dens ?? 0.6),
    div:    String(params?.div || "16n"),
    swing:  clamp01(params?.swing ?? 0.0),
    hp:     num(params?.hp,   7000),
    tone:   num(params?.tone, 11000),
    gain:   num(params?.gain, -10),   // dB
    noise:  String(params?.noise || "white"), // "white"|"pink"|"brown"
  };

  if (state.steps.length < state.len)
    state.steps = (state.steps + ".".repeat(64)).slice(0, state.len);
  if (state.steps.length > state.len)
    state.steps = state.steps.slice(0, state.len);

  // ---------- graph ----------
  // hard gate at the very front so there is *zero* bleed between hits
  const gate = new Tone.Gain(0);
  const hip  = new Tone.Filter({ type:"highpass", frequency: state.hp });
  const bp   = new Tone.Filter({ type:"bandpass", frequency: state.tone, Q: 1 });
  const vol  = new Tone.Volume(state.gain);

  gate.connect(hip);
  hip.connect(bp);
  bp.connect(vol);
  (out ?? new Tone.Gain(1).toDestination()).connect ? vol.connect(out) : vol.toDestination();

  // noise source → gated entirely by control envelope
  const noise = new Tone.Noise(state.noise).start();
  noise.connect(gate);

  // control envelope drives the gate.gain (fully silent when idle)
  const env = new Tone.Envelope({
    attack:  0.001,
    decay:   0.03,
    sustain: 0.0,
    release: 0.02
  });
  env.connect(gate.gain);

  // transport feel
  Tone.Transport.swingSubdivision = "16n";
  Tone.Transport.swing = state.swing;

  // playback
  let idx = 0;
  const loop = new Tone.Loop((time) => {
    let hit = false;
    if (state.mode === "pattern") {
      const ch = state.steps.charAt(idx % state.len) || ".";
      hit = (ch !== ".");
    } else {
      hit = (Math.random() < state.dens);
    }
    idx++;

    if (!hit) return;

    // quick brightness jitter per-hit
    const tFreq = state.tone * (0.95 + Math.random()*0.1);
    try { bp.frequency.setValueAtTime(tFreq, time); } catch(_){}

    // velocity-ish feel
    const vel = 0.65 + Math.random()*0.3;

    // open gate via control envelope (no constant noise)
    try { env.triggerAttackRelease(0.07, time, vel); } catch(_){}
  }, state.div).start(0);

  // ---------- controller ----------
  function update(patch = {}) {
    if (patch.pattern != null || patch.steps != null) {
      const s = String(patch.pattern ?? patch.steps).replace(/\s+/g,"");
      if (s) { state.steps = s; state.mode = "pattern"; }
    }
    if (patch.density != null || patch.dens != null) {
      state.dens = clamp01(patch.density ?? patch.dens);
      state.mode = "dens";
    }
    if (patch.len != null || patch.length != null) {
      state.len = int(patch.len ?? patch.length, 1, 64);
      if (state.steps.length < state.len)
        state.steps = (state.steps + ".".repeat(64)).slice(0, state.len);
      if (state.steps.length > state.len)
        state.steps = state.steps.slice(0, state.len);
    }
    if (patch.div != null) {
      const d = String(patch.div);
      if (d && d !== state.div) { state.div = d; try { loop.interval = d; } catch(_) {} }
    }
    if (patch.swing != null) {
      state.swing = clamp01(patch.swing);
      try { Tone.Transport.swing = state.swing; } catch(_) {}
    }
    if (patch.gain != null) {
      state.gain = num(patch.gain, state.gain);
      try { vol.volume.rampTo(state.gain, 0.03); } catch(_) { vol.volume.value = state.gain; }
    }
    if (patch.hp != null) {
      state.hp = num(patch.hp, state.hp);
      try { hip.frequency.rampTo(state.hp, 0.03); } catch(_) { hip.frequency.value = state.hp; }
    }
    if (patch.tone != null) {
      state.tone = num(patch.tone, state.tone);
      try { bp.frequency.rampTo(state.tone, 0.03); } catch(_) { bp.frequency.value = state.tone; }
    }
    if (patch.mode != null) {
      state.mode = String(patch.mode);
    }
    if (patch.noise != null) {
      const nt = String(patch.noise);
      if (nt === "white" || nt === "pink" || nt === "brown") {
        try { noise.type = nt; state.noise = nt; } catch(_) {}
      }
    }
  }

  function stop(){
    try { loop.stop(); loop.dispose(); } catch(_){}
    try { env.disconnect(); env.dispose(); } catch(_){}
    try { noise.stop(); noise.disconnect(); noise.dispose(); } catch(_){}
    try { gate.dispose(); hip.dispose(); bp.dispose(); vol.dispose(); } catch(_){}
  }
  stop.update = update;

  return stop;
}
