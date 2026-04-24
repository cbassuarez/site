// title: sodium-tone — JI drones (beating partials, tone-only)
export async function start({ Tone, params, out }) {
  await Tone.start(); await Tone.loaded();

  const base  = String(params.base ?? 'A2').toUpperCase();
  const set   = String(params.set  ?? 'pentad').toLowerCase(); // 'pentad'|'septimal3'|'triad'
  const voices= clampInt(params.voices ?? 3, 1, 6);
  const spread= toNum(params.spread, 6);      // cents ±
  const drift = toNum(params.drift, 0.1);     // Hz  ±
  const attack= toNum(params.attack, 1.5);
  const gain  = toNum(params.gain,  -18);

  const hp=new Tone.Filter(70,'highpass'), lp=new Tone.Filter(9000,'lowpass'), vol=new Tone.Volume(gain);
  hp.connect(lp); lp.connect(vol); vol.connect(out);

  const banks = {
    pentad:    ['1/1','5/4','3/2','15/8','9/8'],
    septimal3: ['1/1','7/6','7/5','7/4','3/2'],
    triad:     ['1/1','5/4','3/2']
  };
  const baseHz = jiNoteHz(base);
  const ratios = (banks[set] || banks.pentad).slice(0, voices);

  const voicesArr = [];
  for (const r of ratios){
    const f0 = baseHz * ratioToFloat(r) * centsToRatio(randRange(-spread, spread));
    const osc = new Tone.Oscillator({ frequency: f0 + randRange(-drift, drift), type:'sine' }).start();
    const env = new Tone.AmplitudeEnvelope({ attack, decay: 1.0, sustain: 0.95, release: 2.0 });
    osc.connect(env); env.connect(hp);
    env.triggerAttack('+0.02');
    voicesArr.push({osc, env});
  }

  return () => {
    try { voicesArr.forEach(v => v.env.triggerRelease()); } catch(_) {}
    setTimeout(()=>{ try{ voicesArr.forEach(v=>{v.osc.dispose(); v.env.dispose();}); hp.dispose(); lp.dispose(); vol.dispose(); }catch(_){} }, 2200);
  };
}

function toNum(v,d){ const n=Number(v); return Number.isFinite(n)?n:d; }
function clampInt(v,min,max){ v=Number(v); v=Math.floor(Number.isFinite(v)?v:min); return Math.max(min, Math.min(max, v)); }
function ratioToFloat(r){ if (typeof r==='number') return r; const [n,d]=String(r).split('/').map(Number); return (n&&d)?(n/d):1; }
function centsToRatio(c){ return Math.pow(2, c/1200); }
function randRange(a,b){ return a + Math.random()*(b-a); }
function jiNoteHz(note){
  const m=/^([A-G])([#b]?)(\d)$/i.exec(String(note).trim()); if(!m) return 440;
  let pc=m[1].toUpperCase(); const acc=m[2]; const oct=+m[3];
  const flats={BB:'A#',DB:'C#',EB:'D#',GB:'F#',AB:'G#'}; pc=(acc==='b')?(flats[pc+'B']||pc):(acc==='#')?(pc+'#'):pc;
  const R={'A':1,'A#':16/15,'B':9/8,'C':6/5,'C#':5/4,'D':4/3,'D#':45/32,'E':3/2,'F':8/5,'F#':5/3,'G':9/5,'G#':15/8};
  const order=['A','A#','B','C','C#','D','D#','E','F','F#','G','G#']; const idx=order.indexOf(pc); if(idx<0) return 440;
  const baseAOct=(idx<=2)?oct:(oct-1); const baseAFreq=440*Math.pow(2, baseAOct-4); return baseAFreq*(R[pc]||1);
}
