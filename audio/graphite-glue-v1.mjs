// title: graphite-glue
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
    threshold: num(pick(params?.threshold, -14)), // dB
    ratio:     num(pick(params?.ratio,      3)),  // 1..20
    attack:    num(pick(params?.attack,   0.008)),
    release:   num(pick(params?.release,  0.18)),
    knee:      num(pick(params?.knee,       12)),
    makeup:    num(pick(params?.makeup,     3)),  // dB
    mix:       clamp01(pick(params?.mix,   0.85)),
    gain:      num(pick(params?.gain,     -4)),
    monitor:   (String(pick(params?.monitor, "on")).toLowerCase() !== "off"),
    rate:      String(pick(params?.rate, "4n")),
  };

  const sink = (out && typeof out.connect === "function") ? out : new Tone.Gain(1).toDestination();

  // Glue chain: dry+comp → mix → volume
  const inBus   = new Tone.Gain(1);
  const dryTap  = new Tone.Gain(1);
  const comp    = new Tone.Compressor({ threshold: state.threshold, ratio: state.ratio, attack: state.attack, release: state.release, knee: state.knee });
  const mix     = new Tone.CrossFade(state.mix);
  const makeup  = new Tone.Volume(state.makeup);
  const vol     = new Tone.Volume(state.gain);

  inBus.fan(dryTap, comp);
  dryTap.connect(mix.a);
  comp.chain(makeup, mix.b);
  mix.connect(vol);
  vol.connect(sink);

  // Self-monitor demo: simple “boom-ts” loop into inBus
  const kGate = new Tone.Gain(0);
  const kOsc  = new Tone.Oscillator(45, "sine").start();
  const hGate = new Tone.Gain(0);
  const hNoise= new Tone.Noise("white").start();

  kOsc.connect(kGate); kGate.connect(inBus);
  hNoise.connect(hGate); hGate.connect(inBus);

  const loop = new Tone.Loop((time)=>{
    if (state.monitor){
      // kick on downbeat
      const kEnv = new Tone.Envelope({ attack:0.001, decay:0.12, sustain:0, release:0.05 }).connect(kGate.gain);
      kEnv.triggerAttackRelease(0.14, time, 0.9);
      Tone.Transport.scheduleOnce(()=>{ try{kEnv.dispose();}catch(_){ } }, time + 0.3);

      // hats on “and”
      const off = Tone.Time("8n").toSeconds();
      const hEnv = new Tone.Envelope({ attack:0.001, decay:0.04, sustain:0, release:0.03 }).connect(hGate.gain);
      hEnv.triggerAttackRelease(0.06, time + off, 0.6);
      Tone.Transport.scheduleOnce(()=>{ try{hEnv.dispose();}catch(_){ } }, time + off + 0.2);
    }
  }, state.rate).start(0);

  function update(patch = {}){
    if (patch.threshold != null){ state.threshold = num(patch.threshold, state.threshold); try{ comp.threshold.value = state.threshold; }catch(_){ } }
    if (patch.ratio     != null){ state.ratio     = num(patch.ratio, state.ratio);       try{ comp.ratio.value = state.ratio; }catch(_){ } }
    if (patch.attack    != null){ state.attack    = num(patch.attack, state.attack);     try{ comp.attack = state.attack; }catch(_){ } }
    if (patch.release   != null){ state.release   = num(patch.release, state.release);   try{ comp.release = state.release; }catch(_){ } }
    if (patch.knee      != null){ state.knee      = num(patch.knee, state.knee);         try{ comp.knee.value = state.knee; }catch(_){ } }
    if (patch.makeup    != null){ state.makeup    = num(patch.makeup, state.makeup);     try{ makeup.volume.rampTo(state.makeup, 0.03);}catch(_){ makeup.volume.value = state.makeup; } }
    if (patch.mix       != null){ state.mix       = clamp01(patch.mix);                  try{ mix.fade.rampTo(state.mix, 0.03);}catch(_){ mix.fade.value = state.mix; } }
    if (patch.gain      != null){ state.gain      = num(patch.gain, state.gain);         try{ vol.volume.rampTo(state.gain, 0.03);}catch(_){ vol.volume.value = state.gain; } }
    if (patch.monitor   != null){ state.monitor = !(String(patch.monitor).toLowerCase()==="off"); }
    if (patch.rate      != null){ const r = String(patch.rate); if (r){ state.rate = r; try{ loop.interval = r; }catch(_){ } } }
  }

  function stop(){
    try { loop.stop(); loop.dispose(); } catch(_){}
    try { kOsc.stop(); kOsc.disconnect(); kOsc.dispose(); } catch(_){}
    try { hNoise.stop(); hNoise.disconnect(); hNoise.dispose(); } catch(_){}
    try { kGate.dispose(); hGate.dispose(); } catch(_){}
    try { inBus.dispose(); dryTap.dispose(); comp.dispose(); makeup.dispose(); mix.dispose(); vol.dispose(); } catch(_){}
  }
  stop.update = update;
  return stop;
}
