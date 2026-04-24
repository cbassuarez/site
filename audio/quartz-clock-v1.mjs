// title: quartz-clock
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
    bpm:     num(pick(params?.bpm,    135)),
    div:     String(pick(params?.div, "16n")),
    accent:  String(pick(params?.accent, "1...")), // pattern of accents; '1' = accent
    gain:    num(pick(params?.gain,  -6)),
    swing:   clamp01(pick(params?.swing, 0.0)),
    toneHi:  num(pick(params?.toneHi, 2200)),
    toneLo:  num(pick(params?.toneLo, 1200)),
  };

  const sink = (out && typeof out.connect === "function") ? out : new Tone.Gain(1).toDestination();

  // click voice: filtered noise blip through hard gate
  const noise = new Tone.Noise("white").start();
  const gate  = new Tone.Gain(0);
  const bp    = new Tone.Filter({ type:"bandpass", frequency: state.toneHi, Q: 1.6 });
  const vol   = new Tone.Volume(state.gain);

  noise.connect(gate); gate.connect(bp); bp.connect(vol); vol.connect(sink);

  // set transport params
  try { Tone.Transport.bpm.rampTo(state.bpm, 0.01); } catch(_){ }
  Tone.Transport.swingSubdivision = "16n";
  Tone.Transport.swing = state.swing;

  let step = 0;
  const loop = new Tone.Loop((time)=>{
    const isAccent = (state.accent.charAt(step % Math.max(1, state.accent.length)) === '1');
    step++;

    // set click colour
    try { bp.frequency.setValueAtTime(isAccent ? state.toneHi : state.toneLo, time); } catch(_){}

    const dur = isAccent ? 0.025 : 0.018;
    const amp = isAccent ? 1.0   : 0.7;

    const env = new Tone.Envelope({ attack: 0.001, decay: dur, sustain: 0, release: 0.01 });
    env.connect(gate.gain);
    env.triggerAttackRelease(dur+0.01, time, amp);
    Tone.Transport.scheduleOnce(()=>{ try{env.dispose();}catch(_){ } }, time + 0.2);
  }, state.div).start(0);

  function update(patch = {}){
    if (patch.bpm   != null){ state.bpm = num(patch.bpm, state.bpm); try{ Tone.Transport.bpm.rampTo(state.bpm, 0.05);}catch(_){ } }
    if (patch.div   != null){ const d = String(patch.div); if (d){ state.div = d; try{ loop.interval = d; }catch(_){ } } }
    if (patch.accent!= null){ state.accent = String(patch.accent); }
    if (patch.swing != null){ state.swing = clamp01(patch.swing); try{ Tone.Transport.swing = state.swing; }catch(_){ } }
    if (patch.gain  != null){ state.gain  = num(patch.gain, state.gain); try{ vol.volume.rampTo(state.gain, 0.03);}catch(_){ vol.volume.value = state.gain; } }
    if (patch.toneHi!= null){ state.toneHi= num(patch.toneHi, state.toneHi); }
    if (patch.toneLo!= null){ state.toneLo= num(patch.toneLo, state.toneLo); }
  }

  function stop(){
    try { loop.stop(); loop.dispose(); } catch(_){}
    try { noise.stop(); noise.disconnect(); noise.dispose(); } catch(_){}
    try { gate.dispose(); bp.dispose(); vol.dispose(); } catch(_){}
  }
  stop.update = update;
  return stop;
}
