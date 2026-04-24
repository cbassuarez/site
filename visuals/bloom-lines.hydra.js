// File: bloom-lines.hydra.js
// title: Bloom Lines — hydra stripes (audio reactive)
(function BloomLines(){
  if (!window.Hydra) { console.error('hydra-synth not loaded'); return; }
  try{
    // Dedicated canvas (transparent)
    const c = document.createElement('canvas');
    c.style.position = 'fixed'; c.style.inset = '0'; c.style.width='100%'; c.style.height='100%';
    c.style.pointerEvents = 'none'; c.style.background='transparent';
    document.body.appendChild(c);
    const h = new Hydra({ canvas:c, detectAudio:false, enableStreamCapture:false });

    // Modulators using CB_AUDIO dynamically via function args (evaluated per frame)
    const rms  = () => (window.CB_AUDIO && +window.CB_AUDIO.rms)  || 0;
    const peak = () => (window.CB_AUDIO && +window.CB_AUDIO.peak) || 0;

    // Soft line oscillators + gentle feedback bloom
    // wide stripes, audio pushes frequency and offset wobble
    osc(() => 8 + rms()*40, 0.03, 0.6)
      .rotate(() => 0.15 + peak()*0.25, () => 0.03)
      .color(1.0, 0.88, 0.66)
      .saturate(1.05)
      .blend(
        src(o0).scale(1.004).colorama(0.007),
        0.32
      )
      .out(o0);

    render(o0);

    // Keep canvas in sync with viewport
    const onR = () => { try{ h.setResolution(innerWidth, innerHeight); }catch(_){} };
    window.addEventListener('resize', onR);
  } catch(e){ console.error('Hydra Bloom Lines failed', e); }
})();
