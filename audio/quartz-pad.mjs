// quartz-pad.mjs
// Snare/clap hybrid: noise burst + short tone, grid/step or density.

export default async function start({ Tone, context, params = {}, out }) {
  const P = {
    grid: '8n',
    pattern: '----x-------x---',
    density: 0.5,
    seed: 0,
    // body & noise
    bodyNote: 'D2',
    tune: 0,
    bodyDecay: 0.12,
    noiseColor: 'white',   // white|pink|brown
    noiseDecay: 0.14,
    snap: 6000,            // Hz (noise LPF)
    // character
    crack: 0.7,            // click mix 0..1
    ring: 0.1,             // body vs noise 0..1
    // fx/mix
    hp: 200,
    lpf: 14000,
    drive: 0.25,
    comp: 4,
    gain: -8,
    humanize: 0.003,
    accent: 0.25
  };
  Object.assign(P, params||{});
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const db2gain=(db)=>Math.pow(10,db/20);

  // layers
  const body = new Tone.Synth({
    oscillator: { type:'sine' },
    envelope: { attack:0.001, decay: clamp(P.bodyDecay, 0.03, 0.6), sustain:0, release:0.01 }
  }).set({ volume: -6 });

  const noise = new Tone.Noise(P.noiseColor);
  const nEnv  = new Tone.AmplitudeEnvelope({ attack:0.001, decay: clamp(P.noiseDecay, 0.02, 0.6), sustain:0, release:0.01 });
  const nLP   = new Tone.Filter(clamp(P.snap, 1500, 12000), 'lowpass');

  noise.connect(nLP); nLP.connect(nEnv);

  const crack = new Tone.Noise('white'); // micro click layer
  const cEnv  = new Tone.AmplitudeEnvelope({ attack:0.0005, decay: 0.01, sustain:0, release:0.005 });
  const cHP   = new Tone.Filter(7000, 'highpass');
  crack.chain(cHP, cEnv);

  // mix/fx
  const mix = new Tone.Gain(1);
  const bodyGain = new Tone.Gain(clamp(P.ring,0,1));
  const noiseGain= new Tone.Gain(1 - clamp(P.ring,0,1));
  const crackGain= new Tone.Gain(clamp(P.crack,0,1));

  body.connect(bodyGain);  bodyGain.connect(mix);
  nEnv.connect(noiseGain); noiseGain.connect(mix);
  cEnv.connect(crackGain); crackGain.connect(mix);

  const hp = new Tone.Filter(clamp(P.hp, 40, 2000), 'highpass');
  const dist = new Tone.Distortion(clamp(P.drive,0,1));
  const comp = new Tone.Compressor({ threshold:-18, ratio: 2 + clamp(P.comp,0,10)*0.4, attack:0.004, release:0.12 });
  const lp = new Tone.Filter(clamp(P.lpf, 1000, 20000), 'lowpass');
  const vol = new Tone.Gain(db2gain(P.gain));

  mix.chain(hp, dist, comp, lp, vol);
  if (out && out.connect) vol.connect(out);

  try { noise.start(); crack.start(); } catch(_){}

  // seq
  let seq=null, step=0;
  let rng = P.seed>>>0;
  const rnd = ()=> (rng=(rng^(rng<<13))>>>0, rng=(rng^(rng>>>17))>>>0, rng=(rng^(rng<<5))>>>0, (rng>>>0)/4294967296);
  const parse = s => { const a=String(s||'').replace(/\s+/g,''); return a ? [...a].map(c => (c==='X'?'X':(c==='x'||c==='o')?'x':'-')) : null; };
  let pat = parse(P.pattern);

  function pitchNote(base, semi){
    try { return Tone.Frequency(base).transpose(semi|0).toNote(); } catch { return 'D2'; }
  }

  function fire(time, acc=false){
    const j = (Math.random()-0.5)*2*(P.humanize||0);
    const t = time + j;
    try{
      body.set({ envelope: { attack:0.001, decay: clamp(P.bodyDecay, 0.03, 0.6), sustain:0, release:0.01 }});
      nEnv.set({ attack:0.001, decay: clamp(P.noiseDecay,0.02,0.6), sustain:0, release:0.01 });
      nLP.frequency.cancelAndHoldAtTime(t);
      nLP.frequency.setValueAtTime(clamp(P.snap, 1500, 12000), t);
    }catch(_){}
    const vel = clamp(0.9 + (acc?P.accent:0), 0, 1);
    try { body.triggerAttackRelease(pitchNote(P.bodyNote, P.tune|0), '16n', t, vel); } catch(_){}
    try { nEnv.triggerAttackRelease('16n', t); } catch(_){}
    try { cEnv.triggerAttackRelease('64n', t); } catch(_){}
  }

  function rebuild(){
    if (seq){ try{ seq.stop(0); seq.dispose(); }catch(_){ } seq=null; }
    pat = parse(P.pattern); step=0;
    if (pat){
      seq = new Tone.Loop((time)=>{ const ch = pat[step % pat.length]; if (ch==='x'||ch==='X') fire(time, ch==='X'); step++; }, P.grid);
    } else {
      seq = new Tone.Loop((time)=>{ const p=clamp(P.density,0,1); const r=P.seed?rnd():Math.random(); if (r<p) fire(time,false); step++; }, P.grid);
    }
    seq.start(0);
  }
  rebuild();

  const controller = async function stop(){
    try{ seq && seq.stop(0); seq && seq.dispose(); }catch(_){}
    [body, noise, nEnv, nLP, crack, cEnv, cHP, mix, bodyGain, noiseGain, crackGain, hp, dist, comp, lp, vol]
      .forEach(n=>{ try{ n.dispose && n.dispose(); }catch(_){} });
  };
  controller.update = (patch={})=>{
    Object.assign(P, patch||{});
    if (patch.pattern!==undefined || patch.grid!==undefined || patch.density!==undefined || patch.seed!==undefined) rebuild();
    if (patch.bodyDecay!==undefined) body.set({ envelope:{ attack:0.001, decay:clamp(P.bodyDecay,0.03,0.6), sustain:0, release:0.01 }});
    if (patch.noiseColor!==undefined) { try{ noise.type = P.noiseColor; }catch(_){} }
    if (patch.noiseDecay!==undefined) nEnv.set({ attack:0.001, decay:clamp(P.noiseDecay,0.02,0.6), sustain:0, release:0.01 });
    if (patch.snap!==undefined) nLP.frequency.rampTo(clamp(P.snap,1500,12000), 0.03);
    if (patch.ring!==undefined) { bodyGain.gain.rampTo(clamp(P.ring,0,1),0.03); noiseGain.gain.rampTo(1-clamp(P.ring,0,1),0.03); }
    if (patch.crack!==undefined) crackGain.gain.rampTo(clamp(P.crack,0,1),0.03);
    if (patch.hp!==undefined) hp.frequency.rampTo(clamp(P.hp,40,2000),0.03);
    if (patch.lpf!==undefined) lp.frequency.rampTo(clamp(P.lpf,1000,20000),0.03);
    if (patch.drive!==undefined) dist.distortion = clamp(P.drive,0,1);
    if (patch.comp!==undefined) comp.ratio = 2 + clamp(P.comp,0,10)*0.4;
    if (patch.gain!==undefined) vol.gain.rampTo(db2gain(P.gain),0.02);
    return true;
  };
  controller.params = ()=>({ ...P });
  return controller;
}
