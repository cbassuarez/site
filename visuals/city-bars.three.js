// File: city-bars.three.js
// title: City Bars — minimalist equalizer
(function CityBars(){
  if (!window.THREE) { console.error('THREE not loaded'); return; }
  const scene=new THREE.Scene();
  const camera=new THREE.OrthographicCamera(-innerWidth/2, innerWidth/2, innerHeight/2, -innerHeight/2, -10, 10);
  const renderer=new THREE.WebGLRenderer({ alpha:true, antialias:true });
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2)); renderer.setSize(innerWidth, innerHeight); renderer.setClearColor(0x000000,0); document.body.appendChild(renderer.domElement);

  const N=32; const gap=6; const usableW=innerWidth*0.9; const barW=Math.max(2, Math.floor((usableW - (N-1)*gap)/N)); const baseX=-usableW/2; const group=new THREE.Group(); scene.add(group);
  for(let i=0;i<N;i++){
    const geo=new THREE.PlaneGeometry(barW, 10);
    const mat=new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:0.85 });
    const m=new THREE.Mesh(geo, mat); m.position.x=baseX + i*(barW+gap); m.position.y=0; group.add(m);
  }
  group.position.x = (innerWidth-usableW)/2; // center-ish

  function animate(){
    const B=(window.CB_AUDIO&&window.CB_AUDIO.bands)||[]; const rms=(window.CB_AUDIO&&window.CB_AUDIO.rms)||0;
    const MAXH=Math.max(40, innerHeight*0.42);
    group.children.forEach((m, i)=>{
      const v = Math.max(0, Math.min(1, Number(B[i%N]||0)));
      const h = 8 + (v*v)*MAXH*(0.75 + rms*0.8);
      m.scale.y = h/10; m.position.y = h*0.5 - innerHeight*0.25*rms;
      const hue = (0.58 + v*0.25 + rms*0.2) % 1; const c=new THREE.Color(); c.setHSL(hue, 0.6, 0.6 + v*0.2);
      m.material.color = c;
    });
    renderer.render(scene, camera); requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
})();
