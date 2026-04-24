// File: glass-ripple.hydra.js
// title: Glass Ripple — layered feedback ripples (audio reactive)
(function GlassRipple(){
  if (!window.Hydra) { console.error('hydra-synth not loaded'); return; }
  try{
    const c = document.createElement('canvas');
    c.style.position='fixed'; c.style.inset='0'; c.style.width='100%'; c.style.height='100%';
    c.style.pointerEvents='none'; c.style.background='transparent';
    document.body.appendChild(c);
    const h = new Hydra({ canvas:c, detectAudio:false, enableStreamCapture:false });

    const rms  = () => (window.CB_AUDIO && +window.CB_AUDIO.rms)  || 0;
    const band = (i) => (window.CB_AUDIO && window.CB_AUDIO.bands && +window.CB_AUDIO.bands[i]) || 0;

    const ripple = shape(() => 3 + Math.floor(band(6)*9), 0.3, 0.001)
      .modulateScale(osc(3, 0.1, 0.25), () => 0.08 + rms()*0.45)
      .scale(() => 1.0 + band(3)*0.3)
      .color(0.85, 0.95, 1.0)
      .brightness(0.02);

    // Feedback glass; a gentle scale + colorama for refractions
    src(o0)
      .scale(1.004)
      .colorama(0.006)
      .blend(ripple, 0.34)
      .out(o0);

    render(o0);
    const onR = () => { try{ h.setResolution(innerWidth, innerHeight); }catch(_){} };
    window.addEventListener('resize', onR);
  } catch(e){ console.error('Hydra Glass Ripple failed', e); }
})();
