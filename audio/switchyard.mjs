// title: switchyard — phase & swing (JI, tone-only)
export async function start({ Tone, params, out }) {
  await Tone.start(); await Tone.loaded();

  const pos    = Array.isArray(params?._) ? params._ : [];
  const div    = clampInt(params.div ?? pos.find(x=>/^\d$/.test(x)) ?? 4, 1, 9);
  const pitch  = String(params.pitch ?? pos.find(x=>/^[A-G][#b]?\d$/i.test(x)) ?? 'A3').toUpperCase();
  const offset = clamp(Number(params.offset ?? 0), 0, 1);   // 0..1 of bar
  const swing  = clamp(Number(params.swing  ?? 0), 0, 0.4); // fraction
  const dur    = toNum(params.dur, 0.18);
  const gain   = toNum(params.gain, -12);

  const hz = jiNoteHz(pitch);
  console.debug('[switchyard-tone] pitch=%s hz=%s', pitch, hz);

  const osc = new Tone.Oscillator({ frequency: hz, type: 'sine' }).start();
  const env = new Tone.AmplitudeEnvelope({ attack:0.005, decay:Math.max(0.05,dur*0.35), sustain:0, release:0.02 });

  const hp=new Tone.Filter(120,'highpass'), lp=new Tone.Filter(11000,'lowpass'), vol=new Tone.Volume(gain);
  osc.connect(env); env.connect(hp); hp.connect(lp); lp.connect(vol); vol.connect(out);

  const barSec = 4, base = barSec/div;
  let on = true, t = null, n=0;

  const tick = () => {
    if (!on) return;
    env.triggerAttackRelease(dur);
    const isEven = (n++ % 2) === 0;
    const next = Math.max(0.03, base + (isEven ? -1 : +1) * base * swing * 0.5);
    t = setTimeout(tick, next * 1000);
  };

  t = setTimeout(tick, offset * barSec * 1000);

  return () => { on=false; clearTimeout(t); try{ env.dispose(); osc.dispose(); hp.dispose(); lp.dispose(); vol.dispose(); }catch(_){} };
}

function toNum(v,d){ const n=Number(v); return Number.isFinite(n)?n:d; }
function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
function clampInt(v,min,max){ v=Number(v); v=Math.floor(Number.isFinite(v)?v:min); return Math.max(min, Math.min(max, v)); }

// Just-intonation: anchor to the correct A for that octave
function jiNoteHz(note){
  const m=/^([A-G])([#b]?)(\d)$/i.exec(String(note).trim()); if(!m) return 440;
  let pc=m[1].toUpperCase(); const acc=m[2]; const oct=+m[3];
  const flats={BB:'A#',DB:'C#',EB:'D#',GB:'F#',AB:'G#'}; pc=(acc==='b')?(flats[pc+'B']||pc):(acc==='#')?(pc+'#'):pc;
  const R={'A':1,'A#':16/15,'B':9/8,'C':6/5,'C#':5/4,'D':4/3,'D#':45/32,'E':3/2,'F':8/5,'F#':5/3,'G':9/5,'G#':15/8};
  const order=['A','A#','B','C','C#','D','D#','E','F','F#','G','G#']; const idx=order.indexOf(pc); if(idx<0) return 440;
  const baseAOct=(idx<=2)?oct:(oct-1); const baseAFreq=440*Math.pow(2, baseAOct-4); return baseAFreq*(R[pc]||1);
}

