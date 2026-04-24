// File: sphere-choir.three.js
// title: Wireframe Sphere Choir — phasing tilt (audio reactive)
(function SphereChoir(){
  if (!window.THREE) { console.error('THREE not loaded'); return; }
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 1000); camera.position.set(0,0,10);
  const renderer=new THREE.WebGLRenderer({ alpha:true, antialias:true }); renderer.setPixelRatio(Math.min(devicePixelRatio||1,2)); renderer.setSize(innerWidth, innerHeight); renderer.setClearColor(0x000000,0); document.body.appendChild(renderer.domElement);

  const group=new THREE.Group(); scene.add(group);
  const count=7; const baseR=1.6; const spacing=0.95;
  for(let i=0;i<count;i++){
    const g=new THREE.SphereGeometry(baseR * (0.65 + i*0.12), 24, 16);
    const w=new THREE.WireframeGeometry(g); const m=new THREE.LineSegments(w, new THREE.LineBasicMaterial({ color:0xffffff, transparent:true, opacity:0.85 }));
    m.rotation.x = i*0.12; m.rotation.y = i*0.07; group.add(m);
  }
  function animate(){
    const A=(window.CB_AUDIO&&window.CB_AUDIO.rms)||0; const B=(window.CB_AUDIO&&window.CB_AUDIO.bands)||[]; const low=Number(B[2]||0); const mid=Number(B[8]||0);
    group.children.forEach((m, i)=>{
      const s=1 + A*0.6 + i*0.02; m.scale.set(s,s,s);
      m.rotation.x += 0.004 + low*0.02 + i*0.0006;
      m.rotation.y += 0.003 + mid*0.015 + i*0.0004;
      const hue=(0.6 + A*0.3 + i*0.02)%1; const c=new THREE.Color(); c.setHSL(hue,0.6,0.62); m.material.color=c;
    });
    renderer.render(scene, camera); requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
})();
