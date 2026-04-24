// title: ballast-tone — granular-ish synth (no samples, JI base)
export async function start({ Tone, params, out }) {
  await Tone.start(); await Tone.loaded();

  const pos   = Array.isArray(params?._) ? params._ : [];
  const div   = clampInt(params.div ?? pos.find(x=>/^\d$/.test(x)) ?? 6, 1, 9);
  const pitch = String(params.pitch ?? pos.find(x=>/^[A-G][#b]?\d$/i.test(x)) ?? 'A3').toUpperCase();
  const grains= clampInt(params.grains ?? 24, 4, 64);   // grains/sec
  const glen  = clamp(toNum(params.glen, 0.07), 0.02, 0.25); // seconds
  const spray = clamp(toNum(params.spray,0.04), 0, 0.2);     // sec jitter
  const jitter= clamp(toNum(params.jitter,10), 0, 40);       // cents jitter
  const gain  = toNum(params.gain, -18);

  const baseHz = jiNoteHz(pitch);
  console.debug('[ballast-tone] pitch=%s baseHz=%s', pitch, baseHz);

  const hp=new Tone.Filter(100,'highpass'), lp=new Tone.Filter(10000,'lowpass'), vol=new Tone.Volume(gain);
  const osc = new Tone.Oscillator({ frequency: baseHz, type:'sawtooth' }).start();
  const vca = new Tone.Gain(0); const env = new Tone.Envelope({ attack: glen*0.25, decay: glen*0.75, sustain: 0, release: 0.02 });

  osc.connect(hp); hp.connect(vca); vca.connect(lp); lp.connect(vol); vol.connect(out);
  env.connect(vca.gain);

  const gClock = new Tone.Clock(()=>{
    const now = Tone.now();
    const det = centsToRatio((Math.random()*2-1)*jitter);
    osc.frequency.setValueAtTime(baseHz * det, now);
    const ofs = (Math.random()*2-1)*spray;
    env.triggerAttackRelease(glen, now + Math.max(0, ofs));
  }, grains);
  gClock.start();

  // rhythmic accent at division
  const barSec=4, interval=barSec/div;
  let on=true, t=null;
  const accent=()=>{
    if(!on) return;
    lp.frequency.rampTo(12000, 0.02); lp.frequency.rampTo(10000, 0.15);
    t=setTimeout(accent, interval*1000);
  };
  accent();

  return ()=>{ on=false; clearTimeout(t); try{ gClock.stop(); gClock.dispose(); [osc, vca, env, hp, lp, vol].forEach(n=>n.dispose?.()); }catch(_){} };
}

function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
function clampInt(v,min,max){ v=Number(v); v=Math.floor(Number.isFinite(v)?v:min); return Math.max(min, Math.min(max, v)); }
function toNum(v,d){ const n=Number(v); return Number.isFinite(n)?n:d; }
function centsToRatio(c){ return Math.pow(2, c/1200); }
function jiNoteHz(note){
  const m=/^([A-G])([#b]?)(\d)$/i.exec(String(note).trim()); if(!m) return 220;
  let pc=m[1].toUpperCase(); const acc=m[2]; const oct=+m[3];
  const flats={BB:'A#',DB:'C#',EB:'D#',GB:'F#',AB:'G#'}; pc=(acc==='b')?(flats[pc+'B']||pc):(acc==='#')?(pc+'#'):pc;
  const R={'A':1,'A#':16/15,'B':9/8,'C':6/5,'C#':5/4,'D':4/3,'D#':45/32,'E':3/2,'F':8/5,'F#':5/3,'G':9/5,'G#':15/8};
  const order=['A','A#','B','C','C#','D','D#','E','F','F#','G','G#']; const idx=order.indexOf(pc); if(idx<0) return 220;
  const baseAOct=(idx<=2)?oct:(oct-1); const baseAFreq=440*Math.pow(2, baseAOct-4); return baseAFreq*(R[pc]||1);
}
