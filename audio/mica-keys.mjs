// mica-keys.mjs
// Poly keys (short stabs). Step selects scale degrees; empty pattern uses density.

export default async function start({ Tone, context, params = {}, out }) {
  const P = {
    grid: '8n',
    pattern: 'x---x---x---x---', // when melodic, each 'x' advances degree index
    density: 0.5,
    seed: 0,
    // scale / pitch
    root: 'A2',
    degrees: [0, 3, 7, 10],     // semitone steps relative to root; can be JI-ish ints too
    glide: 0.0,
    // timbre
    type: 'square',              // oscillator type
    filt: 1800,
    res: 0.2,
    envA: 0.004, envD: 0.18, envS: 0.0, envR: 0.08,
    // space
    delayMix: 0.12, delayTime: '8n', feedback: 0.25,
    // mix
    gain: -10,
    humanize: 0.002,
    accent: 0.18
  };
  Object.assign(P, params||{});
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const db2gain=(db)=>Math.pow(10,db/20);

  const voice = new Tone.MonoSynth({
    oscillator: { type: P.type },
    envelope: { attack:P.envA, decay:P.envD, sustain:P.envS, release:P.envR },
    filter: { type:'lowpass', Q: clamp(P.res,0,20) },
    filterEnvelope: { baseFrequency: clamp(P.filt, 200, 12000), octaves: 0, attack: 0.003, decay: 0.12, release: 0.08 }
  });
  voice.portamento = clamp(P.glide, 0, 0.4);

  const del = new Tone.FeedbackDelay(P.delayTime, clamp(P.feedback, 0, 0.95));
  const delMix = new Tone.Gain(P.delayMix);
  const dry = new Tone.Gain(1);
  const vol = new Tone.Gain(db2gain(P.gain));

  voice.connect(dry);
  voice.connect(del);
  del.connect(delMix);
  dry.connect(vol);
  delMix.connect(vol);
  if (out && out.connect) vol.connect(out);

  // helpers
  const degLen = ()=> Math.max(1, (P.degrees||[]).length|0);
  function noteAt(idx){
    const semi = Number(P.degrees[(idx % degLen()+degLen())%degLen()]||0) | 0;
    try { return Tone.Frequency(P.root).transpose(semi).toNote(); } catch { return 'A2'; }
  }

  // seq
  let seq=null, step=0, degIdx=0;
  let rng = P.seed>>>0;
  const rnd = ()=> (rng=(rng^(rng<<13))>>>0, rng=(rng^(rng>>>17))>>>0, rng=(rng^(rng<<5))>>>0, (rng>>>0)/4294967296);
  const parse = s => { const a=String(s||'').replace(/\s+/g,''); return a ? [...a].map(c => (c==='X'?'X':(c==='x'||c==='o')?'x':'-')) : null; };
  let pat = parse(P.pattern);

  function fire(time, acc=false){
    const j = (Math.random()-0.5)*2*(P.humanize||0), t=time+j;
    const vel = clamp(0.85 + (acc?P.accent:0), 0, 1);
    const n = noteAt(degIdx);
    try{
      voice.set({
        oscillator:{ type: P.type },
        envelope:{ attack:P.envA, decay:P.envD, sustain:P.envS, release:P.envR },
        filterEnvelope:{ baseFrequency: clamp(P.filt,200,12000) },
        filter:{ Q: clamp(P.res,0,20) }
      });
      voice.portamento = clamp(P.glide, 0, 0.4);
      del.delayTime.value = P.delayTime;
      del.feedback.value = clamp(P.feedback, 0, 0.95);
      delMix.gain.rampTo(clamp(P.delayMix,0,1), 0.04);
      vol.gain.rampTo(db2gain(P.gain), 0.04);
      voice.triggerAttackRelease(n, '8n', t, vel);
    }catch(_){}
    degIdx++;
  }

  function rebuild(){
    if (seq){ try{ seq.stop(0); seq.dispose(); }catch(_){ } seq=null; }
    pat = parse(P.pattern); step=0;
    if (pat){
      seq = new Tone.Loop((time)=>{ const ch=pat[step%pat.length]; if (ch==='x'||ch==='X') fire(time, ch==='X'); step++; }, P.grid);
    } else {
      seq = new Tone.Loop((time)=>{ const p=clamp(P.density,0,1); const r=P.seed?rnd():Math.random(); if(r<p) fire(time,false); step++; }, P.grid);
    }
    seq.start(0);
  }
  rebuild();

  const controller = async function stop(){
    try{ seq && seq.stop(0); seq && seq.dispose(); }catch(_){}
    [voice,del,delMix,dry,vol].forEach(n=>{ try{ n.dispose && n.dispose(); }catch(_){ }});
  };
  controller.update = (patch={})=>{
    Object.assign(P, patch||{});
    if (patch.pattern!==undefined || patch.grid!==undefined || patch.density!==undefined || patch.seed!==undefined) rebuild();
    if (patch.type!==undefined || patch.envA!==undefined || patch.envD!==undefined || patch.envS!==undefined || patch.envR!==undefined || patch.filt!==undefined || patch.res!==undefined || patch.glide!==undefined){
      voice.set({
        oscillator:{ type: P.type },
        envelope:{ attack:P.envA, decay:P.envD, sustain:P.envS, release:P.envR },
        filterEnvelope:{ baseFrequency: clamp(P.filt,200,12000) },
        filter:{ Q: clamp(P.res,0,20) }
      });
      voice.portamento = clamp(P.glide, 0, 0.4);
    }
    if (patch.delayTime!==undefined) del.delayTime.value = P.delayTime;
    if (patch.feedback!==undefined)  del.feedback.value = clamp(P.feedback, 0, 0.95);
    if (patch.delayMix!==undefined)  delMix.gain.rampTo(clamp(P.delayMix,0,1),0.04);
    if (patch.gain!==undefined)      vol.gain.rampTo(db2gain(P.gain),0.04);
    return true;
  };
  controller.params = ()=>({ ...P });
  return controller;
}
