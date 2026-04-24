// title: creosote-tone — viscous noise (fold + filter), division-gated
export async function start({ Tone, params, out }) {
  await Tone.start(); await Tone.loaded();

  const div   = clampInt(params.div ?? 5, 1, 9);
  const fold  = clamp(toNum(params.fold, 0.35), 0, 1);
  const visc  = clamp(toNum(params.visc, 0.6), 0, 1);   // envelope curve
  const cutoff= toNum(params.cutoff, 1800);
  const dur   = toNum(params.dur, 0.12);
  const gain  = toNum(params.gain, -12);

  const hp=new Tone.Filter(120,'highpass'), lp=new Tone.Filter(10500,'lowpass'), vol=new Tone.Volume(gain);
  hp.connect(lp); lp.connect(vol); vol.connect(out);

  // noise → fold (waveshaper) → LPF → VCA → out
  const noise = new Tone.Noise('white').start();
  const folder = new Tone.WaveShaper(foldCurve(fold), 2048);
  const lpf = new Tone.Filter(cutoff,'lowpass');
  const vca = new Tone.Gain(0);
  noise.connect(folder); folder.connect(lpf); lpf.connect(vca); vca.connect(hp);

  // amplitude envelope via Tone.Envelope
  const env = new Tone.Envelope({ attack: dur*visc, decay: dur*(1-visc), sustain: 0, release: 0.01 });
  env.connect(vca.gain);

  const barSec=4, interval=barSec/div;
  let on=true, t=null;
  const tick=()=>{
    if(!on) return;
    env.triggerAttackRelease(dur);
    t=setTimeout(tick, interval*1000);
  };
  tick();

  return ()=>{ on=false; clearTimeout(t); try{ noise.dispose(); folder.dispose(); lpf.dispose(); env.dispose(); vca.dispose(); hp.dispose(); lp.dispose(); vol.dispose(); }catch(_){} };
}

function toNum(v,d){ const n=Number(v); return Number.isFinite(n)?n:d; }
function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
function clampInt(v,min,max){ v=Number(v); v=Math.floor(Number.isFinite(v)?v:min); return Math.max(min, Math.min(max, v)); }
function foldCurve(amount){
  const k = 1 + amount*4;
  return x => Math.tanh(k * (x + 0.5*Math.sin(3*x)));
}
