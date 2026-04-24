// title: diag-tone — exact Hz test
export async function start({ Tone, params, out }) {
  await Tone.start(); await Tone.loaded();
  const hz = Number(params.hz ?? 440);
  console.debug('[diag-tone] hz=', hz);
  const osc = new Tone.Oscillator({ frequency: hz, type: 'sine' }).start();
  const env = new Tone.AmplitudeEnvelope({ attack:0.005, decay:0.08, sustain:0, release:0.02 });
  const hp = new Tone.Filter(120, 'highpass'), lp = new Tone.Filter(11000, 'lowpass'), vol = new Tone.Volume(-12);
  osc.connect(env); env.connect(hp); hp.connect(lp); lp.connect(vol); vol.connect(out);

  // ping every second
  let on = true;
  const id = setInterval(()=> on && env.triggerAttackRelease(0.15), 1000);
  return () => { on = false; clearInterval(id); try{ osc.dispose(); env.dispose(); hp.dispose(); lp.dispose(); vol.dispose(); }catch(_){} };
}
