// title: mirror-tone — comb reflections around a mirror frequency
export async function start({ Tone, params, out }) {
  await Tone.start(); await Tone.loaded();

  const mirrorHz = toNum(params.mirrorHz, 500);
  const decay    = toNum(params.decay, 2.5);        // perceived tail time-ish
  const rate     = String(params.rate ?? '4/bar');  // 'n/bar' or Hz (number)
  const density  = clamp(toNum(params.density, 1.0), 0.05, 4.0);
  const gain     = toNum(params.gain, -12);

  const hp=new Tone.Filter(120,'highpass'), lp=new Tone.Filter(12000,'lowpass'), vol=new Tone.Volume(gain);
  const split=new Tone.Split(), merge=new Tone.Merge();
  const period = 1 / Math.max(50, mirrorHz); // safety
  const fbAmt  = clamp(decay / 4, 0.1, 0.95);
  const dL = new Tone.FeedbackDelay(period, fbAmt);
  const dR = new Tone.FeedbackDelay(period*1.002, fbAmt);

  const noise = new Tone.Noise('white').start();
  const env   = new Tone.AmplitudeEnvelope({ attack:0.002, decay:0.02, sustain:0, release:0.02 });

  noise.connect(env); env.connect(split);
  split.connect(dL, 0); split.connect(dR, 1);
  dL.connect(merge, 0, 0); dR.connect(merge, 0, 1);
  merge.connect(hp); hp.connect(lp); lp.connect(vol); vol.connect(out);

  const perBar = parseRate(rate) ?? 4;
  const barSec = 4;
  const freq   = perBar / barSec * density;

  const clock = new Tone.Clock((t)=> env.triggerAttackRelease(0.015, t), freq);
  clock.start();

  return () => { try{ clock.stop(); clock.dispose(); [noise, env, split, merge, dL, dR, hp, lp, vol].forEach(n=>n.dispose?.()); }catch(_){} };
}

function toNum(v,d){ const n=Number(v); return Number.isFinite(n)?n:d; }
function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
function parseRate(r){ const m=/^(\d+)\/bar$/i.exec(String(r)); if(m) return Number(m[1]); const n=Number(r); return Number.isFinite(n)?n:null; }
