// title: basalt — Amen Beat Repeat (Tone.js) — v1.4.1 (init-order fix)

const DEFAULT_URL =
  'https://raw.githubusercontent.com/cbassuarez/website-blog/main/audio/amen/amen.wav';

const AMEN_ONSETS = [0.000,0.071,0.118,0.176,0.226,0.277,0.329,0.382,0.441,0.493,0.545,0.595,0.644,0.701,0.753,0.808];

const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
const coerce = (v)=>{ const s=String(v).trim();
  if(/^(on|off)$/i.test(s)) return s.toLowerCase()==='on';
  if(/^(true|false)$/i.test(s)) return s.toLowerCase()==='true';
  if(/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return v;
};

// Tone buffer loader (lets Tone handle decode/CORS)
async function loadToneBuffer(Tone, url){
  return await new Promise((resolve, reject)=>{
    // v14 constructor signature
    /* eslint new-cap: 0 */
    const buf = new Tone.ToneAudioBuffer({
      url,
      onload: () => resolve(buf),
      onerror: (e) => reject(e || new Error('buffer load failed'))
    });
  });
}

function slicesFromOnsets(duration){
  const out=[];
  for(let i=0;i<AMEN_ONSETS.length;i++){
    const s = AMEN_ONSETS[i]*duration;
    const e = (i+1<AMEN_ONSETS.length?AMEN_ONSETS[i+1]:1.0)*duration;
    out.push({start:s, dur:Math.max(0.04, e-s)});
  }
  return out;
}
function makeGrid(duration, N){
  const step = duration/N;
  return Array.from({length:N},(_,i)=>({start:i*step, dur:step}));
}

// ---- step parsers that DO NOT capture `P` (pass args in) ----
function parseSteps(value, grid, forceTriplets){
  if (typeof value === 'number') return (value|0) || 1;
  const f = String(value||'').trim().toUpperCase();
  const mNum = f.match(/^(\d+)$/); if (mNum) return Math.max(1, parseInt(mNum[1],10));
  const m = f.match(/^1\/(\d+)(T)?$/); if (!m) return null;
  const denom = parseInt(m[1],10);
  const isTrip = !!m[2] || !!forceTriplets;
  // 1 bar = grid steps; 1/4 note = grid/4 steps
  const steps = Math.round(grid / (denom/4) * (isTrip?2/3:1));
  return Math.max(1, steps);
}
function parseLen(value, grid, forceTriplets){
  return parseSteps(value, grid, forceTriplets) || 2;
}

export default async function start({ Tone, context, params={}, out }){
  // ---- STARTUP / CONTEXT ----
  try{ await Tone.start(); }catch(_){}
  try{ if (Tone.getContext().rawContext.state !== 'running') await Tone.getContext().rawContext.resume(); }catch(_){}

  // ---- PARAMETERS (raw first; no derived reads here) ----
  const P = {
    url:        params.url || DEFAULT_URL,
    sourceBPM:  Number(params.src || params.sourceBPM || 135),
    bpm:        Number(params.bpm || 135),

    gain:       Number(params.gain ?? -12),
    hpf:        Number(params.hpf ?? 70),
    lpf:        Number(params.lpf ?? 11000),

    grid:       clamp(parseInt(params.grid || 16,10)||16, 4, 32),
    triplets:   !!coerce(params.triplets || false),

    length:     params.length ?? '1/8',     // keep as tokens; derive after
    interval:   params.interval ?? '1/8',
    offset:     parseInt(params.offset || 0, 10) || 0,
    swing:      clamp(Number(params.swing || 0), 0, 0.4),

    gate:       !!coerce(params.gate ?? true),
    duck:       clamp(Number(params.duck ?? 0.35), 0, 1),
    mix:        clamp(Number(params.mix ?? 1.0), 0, 1),
    fxGain:     Number(params.fxGain ?? 6),

    map:        String(params.map || 'grid').toLowerCase(),
    debug:      !!coerce(params.debug || false),
  };

  // DERIVED (safe now that P exists)
  let lengthSteps  = parseLen(P.length,  P.grid, P.triplets);
  let intervalSteps= parseLen(P.interval,P.grid, P.triplets);

  // ---- GRAPH ----
  const gMain = new Tone.Gain(Tone.dbToGain(P.gain));
  const HPF = new Tone.Filter(P.hpf,'highpass');
  const LPF = new Tone.Filter(P.lpf,'lowpass');

  const baseGate = new Tone.Gain(1);
  const dry      = new Tone.Gain(1);
  const fxBus    = new Tone.Gain(1);

  baseGate.connect(dry);
  const sum = new Tone.Gain(1);
  dry.connect(sum);
  fxBus.connect(sum);
  sum.connect(HPF).connect(LPF).connect(gMain).connect(out);

  // Sources
  const base = new Tone.GrainPlayer({ loop:true, grainSize:0.05, overlap:0.33, playbackRate:1 });
  const fx   = new Tone.GrainPlayer({ loop:false, grainSize:0.05, overlap:0.33, playbackRate:1 });
  base.connect(baseGate);
  fx.connect(fxBus);

  // Buffer
  const tbuf = await loadToneBuffer(Tone, P.url);
  base.buffer = tbuf;
  fx.buffer   = tbuf;
  const duration = tbuf.duration;

  // Slice map
  let gridN = P.grid;
  let slices = (P.map==='onset') ? slicesFromOnsets(duration) : makeGrid(duration, gridN);

  // Tempo / playback
  const rateBase = clamp(P.bpm, 30, 220) / Math.max(30, P.sourceBPM);
  base.playbackRate = rateBase;
  fx.playbackRate   = rateBase;

  let baseStartAt = Tone.now() + 0.03;
  base.start(baseStartAt, 0);

  // ---- GRID TIMING HELPERS ----
  function gridHz(){ return (clamp(P.bpm,30,220)/60) * (gridN/4); }
  function stepSec(){ return 1 / gridHz(); }
  function nowStep(){ return Math.floor((Tone.now() - baseStartAt) * gridHz()); }
  function nextStepDelay(){
    const t = Tone.now() - baseStartAt;
    const phase = (t * gridHz()) % 1;
    return (1 - phase) / gridHz();
  }
  function stepToOffset(stepIdx){
    const N = gridN;
    const frac = ((stepIdx % N) + N) % N / N;
    return frac * duration;
  }
  function scheduleTap(time, offset, dur, reverse=false){
    fx.reverse = !!reverse;
    const off = clamp(offset, 0, Math.max(0, duration-0.01));
    fx.start(time, off, Math.max(0.03, Math.min(dur, duration)));
  }

  // ---- BEAT REPEAT (Shift+Space) ----
  let macroOn=false;
  let anchorStep=0;
  let repClock=null;
  let repCount=0;

  function armRepeat(){
    anchorStep = nowStep() + 1; // align to next step
    repCount = 0;

    const delay = nextStepDelay();

    if (repClock){ try{repClock.stop(); repClock.dispose();}catch(_){ repClock=null; } }

    repClock = new Tone.Clock((t)=>{
      const odd = (repCount % 2) === 1;
      const swingDel = odd ? (P.swing * 0.5 * stepSec() * intervalSteps) : 0;

      const thisStartStep = anchorStep + P.offset + (repCount * intervalSteps);
      const off = stepToOffset(thisStartStep);
      const dur = lengthSteps * stepSec();

      scheduleTap(t + swingDel, off, dur, false);
      repCount++;
    }, gridHz()/intervalSteps);

    // gate / duck / fx level
    const fxLevel = Tone.dbToGain(P.fxGain) * (P.gate ? 1 : P.mix);
    fxBus.gain.setValueAtTime(fxLevel, Tone.now());
    baseGate.gain.rampTo(P.gate ? 0 : (1 - clamp(P.duck,0,1)), 0.02);

    repClock.start(Tone.now() + delay);
  }
  function disarmRepeat(){
    if (repClock){ try{ repClock.stop(); repClock.dispose(); }catch(_){ } repClock=null; }
    baseGate.gain.rampTo(1, 0.04);
  }

  const INPUT = '#cb-input';
  const hasFocus = ()=>{ const el=document.querySelector(INPUT); return el && document.activeElement===el; };
  const onDown = (e)=>{
    const sp = (e.code==='Space' || e.key===' ' || e.key==='Spacebar');
    if(!sp || !e.shiftKey) return;
    if(!hasFocus()) return;
    e.preventDefault();
    if (macroOn) return;
    macroOn = true; armRepeat();
  };
  const onUp = (e)=>{
    const sp = (e.code==='Space' || e.key===' ' || e.key==='Spacebar');
    if(!sp) return;
    if(!macroOn) return;
    macroOn = false; disarmRepeat();
  };
  window.addEventListener('keydown', onDown, true);
  window.addEventListener('keyup',   onUp,   true);

  if (P.debug) console.log('[basalt v1.4.1] loaded', { bpm:P.bpm, src:P.sourceBPM, grid:P.grid });

  // ---- CONTROLLER ----
  const controller = async function stop(){
    try{ disarmRepeat(); }catch(_){}
    try{ base.stop(); fx.stop(); }catch(_){}
    try{ base.dispose(); fx.dispose(); }catch(_){}
    try{ dry.dispose(); fxBus.dispose(); sum.dispose(); }catch(_){}
    try{ HPF.dispose(); LPF.dispose(); gMain.dispose(); baseGate.dispose(); }catch(_){}
    try{
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup',   onUp,   true);
    }catch(_){}
  };

  controller.update = function update(patch={}){
    // merge + coerce
    for(const [k,v] of Object.entries(patch)){ if(k in P) P[k]=coerce(v); }

    // io + filters
    gMain.gain.rampTo(Tone.dbToGain(P.gain), 0.05);
    HPF.frequency.rampTo(clamp(P.hpf,20,2000), 0.05);
    LPF.frequency.rampTo(clamp(P.lpf,200,20000), 0.05);

    // tempo
    const r = clamp(P.bpm,30,220) / Math.max(30, P.sourceBPM);
    base.playbackRate = r; fx.playbackRate = r;

    // grid / map (rebuild slices)
    const newGrid = clamp(parseInt(P.grid,10)||16, 4, 32);
    if (newGrid !== gridN){
      gridN = newGrid;
      slices = (P.map==='onset') ? slicesFromOnsets(duration) : makeGrid(duration, gridN);
    }
    if ('map' in patch){
      slices = (String(P.map).toLowerCase()==='onset') ? slicesFromOnsets(duration)
                                                      : makeGrid(duration, gridN);
    }

    // recompute step sizes AFTER any grid/triplet changes
    lengthSteps   = parseLen(P.length,   gridN, P.triplets);
    intervalSteps = parseLen(P.interval, gridN, P.triplets);

    // if repeating, refresh clock division + mix/gate immediately
    if (macroOn && repClock){
      repClock.frequency.value = gridHz()/intervalSteps;
      const fxLevel = Tone.dbToGain(P.fxGain) * (P.gate ? 1 : P.mix);
      fxBus.gain.rampTo(fxLevel, 0.02);
      baseGate.gain.rampTo(P.gate ? 0 : (1 - clamp(P.duck,0,1)), 0.02);
    }
    return true;
  };

  return controller;
}
