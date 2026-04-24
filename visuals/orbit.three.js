// File: orbit.three.js
// title: orbit — orbit rings (audio reactive)
(function OOOOO(){
  if (!window.THREE) { console.error('THREE not loaded'); return; }
  const W = innerWidth, H = innerHeight;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-W/2, W/2, H/2, -H/2, -10, 10);
  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio||1, 2));
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);
  document.body.appendChild(renderer.domElement);

  function mkCircle(r=60, seg=360){
    const pts=[]; for(let i=0;i<seg;i++){ const a=i/seg*2*Math.PI; pts.push(new THREE.Vector3(Math.cos(a)*r, Math.sin(a)*r, 0)); }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color:0xffffff, transparent:true, opacity:0.9 });
    return new THREE.LineLoop(geo, mat);
  }
  const rings=[]; const N=5, spacing=Math.min(W*0.14, 180), baseR=Math.min(W,H)*0.12;
  for(let i=0;i<N;i++){ const r=mkCircle(baseR, 420); r.position.x=(i-(N-1)/2)*spacing; scene.add(r); rings.push(r); }
  function hslToHex(h,s,l){ const c=new THREE.Color(); c.setHSL(h,s,l); return c.getHex(); }
  let last=performance.now();
  function tick(){
    const now=performance.now(); const dt=Math.min(0.05,(now-last)/1000); last=now;
    const A=(window.CB_AUDIO&&+window.CB_AUDIO.rms)||0; const B=(window.CB_AUDIO&&window.CB_AUDIO.bands)||[]; const bass=+((B&&B[2])||0);
    for(let i=0;i<rings.length;i++){
      const r=rings[i]; const t=now*0.0006 + i*0.27; const wob=1 + A*0.6 + bass*0.3; const s=wob + 0.06*Math.sin(t*3 + i*1.7);
      r.scale.set(s, 1/s, 1);
      const hue=(0.58 + 0.08*Math.sin(t*1.1 + i*0.9) + A*0.12) % 1; r.material.color.setHex(hslToHex(hue,0.5,0.58));
      r.rotation.z += dt*(0.2 + A*1.2)*(i%2?1:-1);
    }
    renderer.render(scene, camera); requestAnimationFrame(tick);
  }
  window.addEventListener('resize', ()=>{ try{ renderer.setSize(innerWidth, innerHeight); camera.left=-innerWidth/2; camera.right=innerWidth/2; camera.top=innerHeight/2; camera.bottom=-innerHeight/2; camera.updateProjectionMatrix(); }catch(_){} });
  requestAnimationFrame(tick);
})();
