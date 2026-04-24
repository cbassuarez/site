// titanium-lead.mjs
// Monophonic lead with glide, filter env, subtle chorus, step/density.

export default async function start({ Tone, context, params = {}, out }) {
  const P = {
    grid: '8n',
    pattern: 'x-x-x---x-x-x---',
    density: 0.4,
    seed: 0,
    // pitch path
    root: 'A2',
    steps: [0, 7, 10, 12, 14, 10, 7, 5], // semitone offsets (melodic shape)
    glide: 0.08,
    // timbre
    osc: 'sawtooth',
    filt: 1200,
    res: 0.6,
    envAmt: 1800,   // extra Hz on attack
    envA: 0.004, envD: 0.14, envS: 0.0, envR: 0.06,
    // fx
    chorus: 0.2,
    echo: '8n',
    echoMix: 0.08,
    feedback: 0.25,
    // mix
    gain: -9,
    humanize: 0.002,
    accent: 0.2
  };
  Object.assign(P, params||{});
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const db2gain=(db)=>Math.pow(10,db/20);

  const synth = new Tone.MonoSynth({
    oscillator: { type: P.osc },
    envelope: { attack:P.envA, decay:P.envD, sustain:P.envS, release:P.envR },
    filter: { type:'lowpass', Q: clamp(P.res,0,20) },
    filterEnvelope: { baseFrequency: clamp(P.filt,200,12000), octaves: 0, attack: 0.003, decay: 0.12, release: 0.08 }
  });
  synth.portamento = clamp(P.glide, 0, 0.6);

  const chorus = new Tone.Chorus(3.2, clamp(P.chorus, 0, 1), 0.8).start();
  const delay  = new Tone.FeedbackDelay(P.echo, clamp(P.feedback, 0, 0.95));
  const wet    = new Tone.Gain(P.echoMix);
  const dry    = new Tone.Gain(1);
  const vol    = new Tone.Gain(db2gain(P.gain));

  synth.connect(dry);
  synth.chain(chorus, delay, wet);

  dry.connect(vol);
  wet.connect(vol);
  if (out && out.connect) vol.connect(out);

  function noteAt(i){
    const semi = Number(P.steps[(i % P.steps.length + P.steps.length) % P.steps.length]||0) | 0;
    try { return Tone.Frequency(P.root).transpose(semi).toNote(); } catch { return 'A2'; }
  }

  let seq=null, step=0, mel=0;
  let rng=P.seed>>>0;
  const rnd=()=> (rng=(rng^(rng<<13))>>>0, rng=(rng^(rng>>>17))>>>0, rng=(rng^(rng<<5))>>>0, (rng>>>0)/4294967296);
  const parse=s=>{ const a=String(s||'').replace(/\s+/g,''); return a ? [...a].map(c => (c==='X'?'X':(c==='x'||c==='o')?'x':'-')) : null; };
  let pat=parse(P.pattern);

  function fire(time, acc=false){
    const j=(Math.random()-0.5)*2*(P.humanize||0), t=time+j;
    try{
      synth.set({
        oscillator:{ type: P.osc },
        envelope:{ attack:P.envA, decay:P.envD, sustain:P.envS, release:P.envR },
        filter:{ Q: clamp(P.res,0,20) },
        filterEnvelope:{ baseFrequency: clamp(P.filt,200,12000) }
      });
      synth.portamento = clamp(P.glide,0,0.6);
      chorus.depth = clamp(P.chorus, 0, 1);
      delay.delayTime.value = P.echo;
      delay.feedback.value = clamp(P.feedback, 0, 0.95);
      wet.gain.rampTo(clamp(P.echoMix,0,1), 0.04);
      vol.gain.rampTo(db2gain(P.gain), 0.04);
    }catch(_){}
    const n = noteAt(mel);
    const vel = clamp(0.9 + (acc?P.accent:0), 0, 1);
    try { synth.triggerAttackRelease(n, '8n', t, vel); } catch(_){}
    mel++;
  }

  function rebuild(){
    if (seq){ try{ seq.stop(0); seq.dispose(); }catch(_){ } seq=null; }
    pat=parse(P.pattern); step=0; mel=0;
    if (pat){
      seq=new Tone.Loop((time)=>{ const ch=pat[step%pat.length]; if (ch==='x'||ch==='X') fire(time, ch==='X'); step++; }, P.grid);
    } else {
      seq=new Tone.Loop((time)=>{ const p=clamp(P.density,0,1); const r=P.seed?rnd():Math.random(); if(r<p) fire(time,false); step++; }, P.grid);
    }
    seq.start(0);
  }
  rebuild();

  const controller = async function stop(){
    try{ seq && seq.stop(0); seq && seq.dispose(); }catch(_){}
    [synth,chorus,delay,wet,dry,vol].forEach(n=>{ try{ n.dispose && n.dispose(); }catch(_){ }});
  };
  controller.update=(patch={})=>{
    Object.assign(P, patch||{});
    if (patch.pattern!==undefined || patch.grid!==undefined || patch.density!==undefined || patch.seed!==undefined) rebuild();
    if (patch.osc!==undefined || patch.envA!==undefined || patch.envD!==undefined || patch.envS!==undefined || patch.envR!==undefined || patch.filt!==undefined || patch.res!==undefined || patch.glide!==undefined){
      synth.set({
        oscillator:{ type: P.osc },
        envelope:{ attack:P.envA, decay:P.envD, sustain:P.envS, release:P.envR },
        filter:{ Q: clamp(P.res,0,20) },
        filterEnvelope:{ baseFrequency: clamp(P.filt,200,12000) }
      });
      synth.portamento = clamp(P.glide, 0, 0.6);
    }
    if (patch.chorus!==undefined) chorus.depth = clamp(P.chorus, 0, 1);
    if (patch.echo!==undefined) delay.delayTime.value = P.echo;
    if (patch.feedback!==undefined) delay.feedback.value = clamp(P.feedback, 0, 0.95);
    if (patch.echoMix!==undefined) wet.gain.rampTo(clamp(P.echoMix,0,1), 0.04);
    if (patch.gain!==undefined) vol.gain.rampTo(db2gain(P.gain), 0.04);
    return true;
  };
  controller.params = ()=>({ ...P });
  return controller;
}
