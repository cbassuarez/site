// title: silica-grain
// engine: tone
export default async function start({ Tone, out, params } = {}) {
  await Tone.start();
  if (Tone.Transport.state !== "started") {
    try { Tone.Transport.start("+0.02"); } catch(_) {}
  }

  // ---------- helpers ----------
  const num = (v, d)=> (isFinite(+v) ? +v : d);
  const clamp01 = v => Math.max(0, Math.min(1, num(v, 0)));
  const pick = (a,b)=> (a!=null ? a : b);

  // ---------- state ----------
  const state = {
    dens:  clamp01(pick(params?.density, 0.35)),   // grains per 16th (prob)
    size:  num(pick(params?.size,    0.09), 0.005),
    color: num(pick(params?.color,  6000)),        // band center Hz
    q:     num(pick(params?.q,       2.5)),
    spread:clamp01(pick(params?.spread, 0.7)),     // stereo/pan randomness
    div:   String(pick(params?.div, "16n")),
    gain:  num(pick(params?.gain,  -10)),          // dB
    noise: String(pick(params?.noise, "white")),   // white|pink|brown
    swing: clamp01(pick(params?.swing, 0.0)),
  };

  // ---------- graph ----------
  const sink = (out && typeof out.connect === "function") ? out : new Tone.Gain(1).toDestination();

  const vol   = new Tone.Volume(state.gain).connect(sink);
  const mix   = new Tone.Gain(0.9).connect(vol);
  const lim   = new Tone.Limiter(-1).connect(mix); // gentle protection

  // Single noise bed routed into 4 grain gates for richer spray
  const src = new Tone.Noise(state.noise).start();
  const grains = Array.from({length:4}).map(()=> {
    const gate = new Tone.Gain(0);
    const bp   = new Tone.Filter({ type:"bandpass", frequency: state.color, Q: state.q });
    const pan  = new Tone.Panner(0);
    src.connect(gate); gate.connect(bp); bp.connect(pan); pan.connect(lim);
    return { gate, bp, pan };
  });

  // Transport feel
  Tone.Transport.swingSubdivision = "16n";
  Tone.Transport.swing = state.swing;

  // trigger a single grain on one of the lanes
  function triggerGrain(time){
    const lane = grains[(Math.random()*grains.length)|0];
    const f = state.color * (0.8 + Math.random()*0.6);
    try { lane.bp.frequency.setValueAtTime(f, time); } catch(_){}
    const p = (Math.random()*2 - 1) * state.spread;
    try { lane.pan.pan.setValueAtTime(p, time); } catch(_){}

    // envelope → hard gate (silent between grains)
    const env = new Tone.Envelope({ attack: 0.003, decay: state.size, sustain: 0, release: 0.02 });
    env.connect(lane.gate.gain);
    env.triggerAttackRelease(state.size, time, 0.9);
    // dispose later
    Tone.Transport.scheduleOnce(t => { try{env.dispose();}catch(_){ } }, time + state.size + 0.1);
  }

  // scheduler
  const loop = new Tone.Loop((time) => {
    // probabilistic grains per subdivision
    if (Math.random() < state.dens) triggerGrain(time);
    // sometimes a second one for density “bursts”
    if (Math.random() < state.dens * 0.35) triggerGrain(time + Tone.Time(state.div).toSeconds()*0.45);
  }, state.div).start(0);

  // ---------- controller ----------
  function update(patch = {}){
    if (patch.density != null) state.dens = clamp01(patch.density);
    if (patch.size    != null) state.size = Math.max(0.003, num(patch.size, state.size));
    if (patch.color   != null) { state.color = num(patch.color, state.color); grains.forEach(g=>g.bp.frequency.rampTo(state.color, 0.05)); }
    if (patch.q       != null) { state.q     = num(patch.q, state.q); grains.forEach(g=>g.bp.Q.rampTo(state.q, 0.05)); }
    if (patch.spread  != null) state.spread = clamp01(patch.spread);
    if (patch.noise   != null) { const t = String(patch.noise); if (["white","pink","brown"].includes(t)) { try{ src.type = t; state.noise = t; }catch(_){}} }
    if (patch.div     != null) { const d = String(patch.div); if (d) { state.div = d; try{ loop.interval = d; }catch(_){ } } }
    if (patch.swing   != null) { state.swing = clamp01(patch.swing); try{ Tone.Transport.swing = state.swing; }catch(_){ } }
    if (patch.gain    != null) { state.gain = num(patch.gain, state.gain); try{ vol.volume.rampTo(state.gain, 0.03); }catch(_){ vol.volume.value = state.gain; } }
  }

  function stop(){
    try { loop.stop(); loop.dispose(); } catch(_){}
    try { src.stop(); src.disconnect(); src.dispose(); } catch(_){}
    try { grains.forEach(g=>{ g.gate.dispose(); g.bp.dispose(); g.pan.dispose(); }); } catch(_){}
    try { lim.dispose(); mix.dispose(); vol.dispose(); } catch(_){}
  }
  stop.update = update;
  return stop;
}
