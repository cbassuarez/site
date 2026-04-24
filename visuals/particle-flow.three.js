// File: particle-flow.three.js
// title: Particle Flow — drifting field (audio reactive)
(function ParticleFlow(){
  if (!window.THREE) { console.error('THREE not loaded'); return; }
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 1000); camera.position.z=120;
  const renderer=new THREE.WebGLRenderer({ alpha:true, antialias:false }); renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5)); renderer.setSize(innerWidth, innerHeight); renderer.setClearColor(0x000000,0); document.body.appendChild(renderer.domElement);

  const N=2000; const geo=new THREE.BufferGeometry();
  const pos=new Float32Array(N*3); const vel=new Float32Array(N*3);
  for(let i=0;i<N;i++){ pos[i*3]=(Math.random()-0.5)*240; pos[i*3+1]=(Math.random()-0.5)*140; pos[i*3+2]=(Math.random()-0.5)*160; vel[i*3]=(Math.random()-0.5)*0.08; vel[i*3+1]=(Math.random()-0.5)*0.08; vel[i*3+2]=(Math.random()-0.5)*0.08; }
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  const mat=new THREE.PointsMaterial({ color:0xffffff, size:1.6, sizeAttenuation:true, transparent:true, opacity:0.9 });
  const pts=new THREE.Points(geo, mat); scene.add(pts);

  function animate(){
    const A=(window.CB_AUDIO&&window.CB_AUDIO.rms)||0; const B=(window.CB_AUDIO&&window.CB_AUDIO.bands)||[]; const low=Number(B[2]||0);
    const speed = 1 + A*8; const spread = 1 + low*1.6;
    for(let i=0;i<N;i++){
      pos[i*3]   += vel[i*3]*speed; pos[i*3+1] += vel[i*3+1]*speed; pos[i*3+2] += vel[i*3+2]*speed;
      // wrap
      if (pos[i*3] > 120*spread) pos[i*3] = -120*spread; if (pos[i*3] < -120*spread) pos[i*3] = 120*spread;
      if (pos[i*3+1] > 70*spread) pos[i*3+1] = -70*spread; if (pos[i*3+1] < -70*spread) pos[i*3+1] = 70*spread;
      if (pos[i*3+2] > 80*spread) pos[i*3+2] = -80*spread; if (pos[i*3+2] < -80*spread) pos[i*3+2] = 80*spread;
    }
    geo.attributes.position.needsUpdate=true;
    renderer.render(scene,camera); requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
})();
