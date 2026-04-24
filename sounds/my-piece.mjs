// title: Warm Fifths (drone)
export async function start({ Tone, params, out }) {
  await Tone.start();
  const vol = new Tone.Volume(params?.gain ?? -12);
  vol.connect(out);                               // ← route through the per-run bus
  const synth = new Tone.PolySynth(Tone.Synth).connect(vol);
  synth.triggerAttack(['A2','E3']);
  return () => { try { synth.releaseAll?.(); } catch(_){} try { synth.dispose?.(); } catch(_){} };
}
