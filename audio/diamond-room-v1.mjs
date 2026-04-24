// title: diamond-room
// engine: tone
export default async function start({ Tone, out, params } = {}) {
  await Tone.start();
  if (Tone.Transport.state !== "started") {
    try { Tone.Transport.start("+0.02"); } catch(_) {}
  }

  const num = (v, d)=> (isFinite(+v) ? +v : d);
  const clamp01 = v => Math.max(0, Math.min(1, +v));
  const pick = (a,b)=> (a!=null ? a : b);

  const state = {
    size:   num(pick(params?.size,   4.5)),  // seconds
    pre:    num(pick(params?.pre,    0.013)),
    damp:   num(pick(params?.damp,   5000)), // lowpass inside
    mix:    clamp01(pick(params?.mix, 0.45)),
    shimmer: num(pick(params?.shimmer, 0)),  // semitones; 0=off
    gain:   num(pick(params?.gain,  -10)),
    monitor: (String(pick(params?.monitor, "on")).toLowerCase() !== "off"),
    rate:   String(pick(params?.rate, "2n")), // ping rate when monitor on
  };

  const sink = (out && typeof out.connect === "function") ? out : new Tone.Gain(1).toDestination();

  // Core reverb chain
  const preHP = new Tone.Filter({ type:"highpass", frequency: 120 });
  const dampLP = new Tone.Filter({ type:"lowpass",  frequency: state.damp });
  const rev  = new Tone.Reverb({ decay: state.size, preDelay: state.pre, wet: state.mix });
  const vol  = new Tone.Volume(state.gain);

  // Optional shimmer path (pitch shift inside feedback-ish loop)
  const comb = new Tone.FeedbackDelay({ delayTime: 0.06, feedback: 0.35, wet: 0 });
  const sh   = new Tone.PitchShift({ pitch: state.shimmer || 0 });
  // topology: input → rev → (comb → pitch) → rev, then out
  preHP.chain(rev, dampLP, vol, sink);
  rev.connect(comb); comb.connect(sh); sh.connect(rev);

  // self-monitor ping so it’s audible alone
  const pingNoise = new Tone.Noise("white").start();
  const pingGate  = new Tone.Gain(0);
  const pingBP    = new Tone.Filter({ type:"bandpass", frequency: 2500, Q: 1.2 });
  pingNoise.connect(pingGate); pingGate.connect(preHP);

  const loop = new Tone.Loop((time)=>{
    if (!state.monitor) return;
    // tiny tick into the room
    const env = new Tone.Envelope({ attack:0.001, decay:0.03, sustain:0, release:0.02 });
    env.connect(pingGate.gain);
    // slight random centre for “glass”
    try { pingBP.frequency.setValueAtTime(2200 + Math.random()*1200, time); } catch(_){}
    pingGate.disconnect();
    pingNoise.connect(pingGate); pingGate.connect(pingBP); // keep a BP per-hit
    env.triggerAttackRelease(0.05, time, 0.9);
    Tone.Transport.scheduleOnce(()=>{ try{env.dispose();}catch(_){ } }, time + 0.2);
  }, state.rate).start(0);

  function setWet(x){ try{ rev.wet.rampTo(x, 0.05);}catch(_){ rev.wet.value = x; } }

  function update(patch = {}){
    if (patch.size   != null){ state.size = num(patch.size, state.size); try{ rev.decay = state.size; }catch(_){ } }
    if (patch.pre    != null){ state.pre  = num(patch.pre,  state.pre);  try{ rev.preDelay = state.pre; }catch(_){ } }
    if (patch.damp   != null){ state.damp = num(patch.damp, state.damp); try{ dampLP.frequency.rampTo(state.damp, 0.05);}catch(_){ } }
    if (patch.mix    != null){ state.mix  = clamp01(patch.mix); setWet(state.mix); }
    if (patch.shimmer!= null){ state.shimmer = num(patch.shimmer, state.shimmer); try{ sh.pitch = state.shimmer; }catch(_){ } }
    if (patch.gain   != null){ state.gain = num(patch.gain, state.gain); try{ vol.volume.rampTo(state.gain, 0.03);}catch(_){ vol.volume.value = state.gain; } }
    if (patch.monitor!= null){ state.monitor = !(String(patch.monitor).toLowerCase()==="off"); }
    if (patch.rate   != null){ const r = String(patch.rate); if (r){ state.rate = r; try{ loop.interval = r; }catch(_){ } } }
  }

  function stop(){
    try { loop.stop(); loop.dispose(); } catch(_){}
    try { pingNoise.stop(); pingNoise.disconnect(); pingNoise.dispose(); } catch(_){}
    try { pingGate.dispose(); pingBP.dispose(); } catch(_){}
    try { preHP.dispose(); dampLP.dispose(); rev.dispose(); comb.dispose(); sh.dispose(); vol.dispose(); } catch(_){}
  }
  stop.update = update;
  return stop;
}
