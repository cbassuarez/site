// File: fractal.three.js
// title: fractal set — morphing fractal (audio reactive)
(function JuliaFractal(){
  if (!window.THREE) { console.error('THREE not loaded'); return; }
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1,1,1,-1,-1,1);
  const renderer = new THREE.WebGLRenderer({ antialias:false, alpha:true, powerPreference:'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio||1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x000000, 0);
  document.body.appendChild(renderer.domElement);

  const uniforms={ u_time:{value:0}, u_res:{value:new THREE.Vector2(innerWidth,innerHeight)}, u_center:{value:new THREE.Vector2(0,0)}, u_zoom:{value:1.5}, u_c:{value:new THREE.Vector2(-0.745,0.156)}, u_color:{value:new THREE.Color(0.9,0.9,1.0)} };
  const vs=`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`;
  const fs=`precision highp float; varying vec2 vUv; uniform vec2 u_res; uniform float u_time; uniform vec2 u_center; uniform float u_zoom; uniform vec2 u_c; uniform vec3 u_color; vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b*cos(6.28318*(c*t+d)); } void main(){ vec2 uv=(vUv-0.5)*vec2(u_res.x/u_res.y,1.0); uv=uv/u_zoom + u_center; vec2 z=uv; float i; const int MAX_IT=140; for(int n=0;n<MAX_IT;n++){ float x=(z.x*z.x - z.y*z.y) + u_c.x; float y=(2.0*z.x*z.y) + u_c.y; z=vec2(x,y); if(dot(z,z)>9.0){ i=float(n); break; } i=float(MAX_IT); } float t=i/float(MAX_IT); vec3 col=pal(t, vec3(0.5), vec3(0.5), vec3(1.0,0.7,0.4), vec3(0.2,0.3,0.6)); col*=u_color; float a=smoothstep(0.0,1.0,t); gl_FragColor=vec4(col,a); }`;
  const material=new THREE.ShaderMaterial({ uniforms, vertexShader:vs, fragmentShader:fs, transparent:true });
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2), material); scene.add(quad);
  let last=performance.now();
  function animate(){ const now=performance.now(); const dt=(now-last)/1000; last=now; uniforms.u_time.value+=dt; const A=(window.CB_AUDIO&&+window.CB_AUDIO.rms)||0; const B=(window.CB_AUDIO&&window.CB_AUDIO.bands)||[]; const bass=+((B&&B[1])||0); const mid=+((B&&B[8])||0); const baseA=-0.8 + 0.25*Math.cos(uniforms.u_time.value*0.15); const baseB= 0.156 + 0.25*Math.sin(uniforms.u_time.value*0.13); uniforms.u_c.value.set(baseA + A*0.35, baseB + bass*0.25); uniforms.u_zoom.value=1.4 + 0.5*Math.sin(uniforms.u_time.value*0.22 + mid*2.0) + A*0.6; uniforms.u_center.value.set(0.2*Math.sin(uniforms.u_time.value*0.07), 0.2*Math.cos(uniforms.u_time.value*0.09)); const tint=new THREE.Color().setHSL((0.6 + A*0.3)%1, 0.6, 0.7 + bass*0.15); uniforms.u_color.value.copy(tint); renderer.setSize(innerWidth, innerHeight); uniforms.u_res.value.set(innerWidth, innerHeight); renderer.render(scene, camera); requestAnimationFrame(animate); }
  requestAnimationFrame(animate);
})();
