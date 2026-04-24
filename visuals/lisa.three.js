// File: lisa.three.js
// title: Lissajous Field — polyline weave (audio reactive)
(function LissajousField(){
  if (!window.THREE) { console.error('THREE not loaded'); return; }
  const scene=new THREE.Scene();
  const camera=new THREE.OrthographicCamera(-innerWidth/2, innerWidth/2, innerHeight/2, -innerHeight/2, -10, 10);
  const renderer=new THREE.WebGLRenderer({ alpha:true, antialias:true });
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2)); renderer.setSize(innerWidth, innerHeight); renderer.setClearColor(0x000000,0); document.body.appendChild(renderer.domElement);
  const mat=new THREE.LineBasicMaterial({ color:0x88ddff, transparent:true, opacity:0.92 });
  const MAX=1600; const pos=new Float32Array(MAX*3); const geo=new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos,3)); const line=new THREE.Line(geo, mat); scene.add(line);
  let t=0; function animate(){ const A=(window.CB_AUDIO&&window.CB_AUDIO.rms)||0; const B=(window.CB_AUDIO&&window.CB_AUDIO.bands)||[]; const b=Number(B[3]||0); const fx=2 + Math.floor(b*6); const fy=3 + Math.floor(A*10); const phase=t*0.6; const amp=Math.min(innerWidth,innerHeight)*0.38 * (1 + A*0.5); for(let i=0;i<MAX;i++){ const u=i/(MAX-1); const x=Math.sin((u*fx)*Math.PI*2 + phase); const y=Math.sin((u*fy)*Math.PI*2 + phase*0.9); pos[i*3]=x*amp; pos[i*3+1]=y*amp; pos[i*3+2]=0; } geo.attributes.position.needsUpdate=true; line.rotation.z += 0.002 + A*0.01; renderer.render(scene,camera); t+=0.016; requestAnimationFrame(animate);} requestAnimationFrame(animate);
})();
