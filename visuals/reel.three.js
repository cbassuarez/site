// title: reel  — Typographic Film-Reel — Three.js math, pure CLI text output
#!/usr/bin/env node
/**
 * Typographic Film-Reel — Three.js math, pure CLI text output
 *
 * Streams one scanline at a time to stdout; each row is a halftoned
 * sample of a procedural field. No repaint, no background, no overlay.
 *
 * Scenes are expressed as code lines via --expr (and optional --code)
 * to produce reproducible states. No assets. Characters only.
 *
 * Examples:
 *  - node reel.js --fit --rate 24 --expr "vortex(x,y,t)"
 *  - node reel.js --fit --palette CBASSUAREZ --expr "lissajous(x,y,t)"
 *  - node reel.js --width 120 --expr "0.5+0.5*Math.sin(6*x+3*y+2*t)"
 *  - node reel.js --fit --color mono --dither err --gamma 1.15
 */

import * as THREE from 'three';

// --------------------------- CLI Parsing -----------------------------------
const args = process.argv.slice(2);

function readArg(flag, def=null){
  const i = args.findIndex(a => a === flag || a.startsWith(flag+"="));
  if (i === -1) return def;
  const a = args[i];
  const eq = a.indexOf('=');
  if (eq !== -1) return a.slice(eq+1);
  return args[i+1] !== undefined ? args[i+1] : def;
}
function hasFlag(flag){
  return args.some(a => a === flag || a.startsWith(flag+"="));
}

const help = hasFlag('--help') || hasFlag('-h');
if (help){
  const msg = [
    'Typographic Film-Reel — CLI text stream',
    '',
    'Flags:',
    '  --fit                 use terminal width',
    '  --width <n>           columns (default: 120)',
    '  --rate <n>            rows per second (default: 24)',
    '  --seed <n>            RNG seed (default: 1)',
    '  --palette <chars>     ordered glyph set, light→dark (default: code)',
    '  --gamma <f>           tone curve (default: 1.2)',
    '  --dither <none|err>   1D error diffusion (default: err)',
    '  --diffusion <f>       error carry 0..1 (default: 0.85)',
    '  --color <mono|hsl|off>ANSI color on text (default: mono)',
    '  --expr <code>         JS expression: f(x,y,t,row,col) -> number|[r,g,b]|"char"',
    '  --code <lines>        JS lines defining helpers used by --expr',
    '  --yscale <f>          vertical scaling (default: 1.0)',
    '  --xscale <f>          horizontal scaling (default: 1.0)',
    '  --speed <f>           time speed multiplier (default: 1.0)',
    '  --maxRows <n>         stop after N rows (default: infinite)',
    '',
    'Examples:',
    '  node reel.js --fit --expr "vortex(x,y,t)"',
    '  node reel.js --fit --palette CBASSUAREZ --expr "lissajous(x,y,t)"',
    '  node reel.js --width 100 --expr "0.5+0.5*Math.sin(10*(x*x+y*y)-t*3)"',
  ].join('\n');
  process.stdout.write(msg+"\n");
  process.exit(0);
}

const width = hasFlag('--fit')
  ? Math.max(40, (process.stdout.columns||120) - 2)
  : Math.max(8, parseInt(readArg('--width', '120'), 10));
const rate = Math.max(1, parseFloat(readArg('--rate', '24')));
const seed = parseInt(readArg('--seed', '1'), 10) >>> 0;
const paletteArg = readArg('--palette', 'code');
const gamma = Math.max(0.1, parseFloat(readArg('--gamma', '1.2')));
const ditherMode = String(readArg('--dither', 'err'));
const diffusion = Math.max(0, Math.min(1, parseFloat(readArg('--diffusion','0.85'))));
const colorMode = String(readArg('--color','mono')).toLowerCase(); // mono|hsl|off
const exprSrc = readArg('--expr', 'vortex(x,y,t)');
const codeSrc = readArg('--code', '');
const yscale = parseFloat(readArg('--yscale','1.0'));
const xscale = parseFloat(readArg('--xscale','1.0'));
const speed = parseFloat(readArg('--speed','1.0'));
const maxRows = readArg('--maxRows', null) ? parseInt(readArg('--maxRows'),10) : Infinity;

// ----------------------------- RNG -----------------------------------------
function mulberry32(a){
  return function(){
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed || 1);

// --------------------------- Palettes --------------------------------------
const NAMED = {
  // Code-like characters, excluding heavy dot pixels.
  code: " `,:;-_~=\/|()[]{}<>+*=#%@MW",
  // Uppercase vibe
  upper: "  I!l:/|()[]{}<>+*=#%&@WM",
  // Only your name letters for living typography
  cbass: " CBASSUAREZ",
  // Dense blockish
  heavy: "  -_=+*#%WM@",
};

let palette = paletteArg.length>1 && paletteArg !== 'code' && !NAMED[paletteArg]
  ? paletteArg
  : NAMED[paletteArg] || NAMED.code;

// ensure unique glyphs but keep order
palette = Array.from(new Set(palette.split(''))).join('');
if (!palette.includes(' ')) palette = ' ' + palette; // guarantee space for empty

function mapToChar(v){
  const g = Math.max(0, Math.min(1, Math.pow(v, 1/gamma)));
  const idx = Math.max(0, Math.min(palette.length-1, Math.floor(g*(palette.length-1))));
  return palette[idx];
}

// ---------------------------- Color ----------------------------------------
function clamp01(v){ return v<0?0:(v>1?1:v); }
function hslToRgb(h, s, l){
  h = (h%1+1)%1; s = clamp01(s); l = clamp01(l);
  if (s === 0) { const g = Math.round(l*255); return [g,g,g]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (p,q,t)=>{ t=(t%1+1)%1; if (t<1/6) return p+(q-p)*6*t; if (t<1/2) return q; if (t<2/3) return p+(q-p)*(2/3 - t)*6; return p; };
  const r = hue2rgb(p,q,h+1/3), g2 = hue2rgb(p,q,h), b = hue2rgb(p,q,h-1/3);
  return [Math.round(r*255), Math.round(g2*255), Math.round(b*255)];
}
const ESC = (s)=>"\u001b["+s;
function fg(r,g,b){ return ESC(`38;2;${r};${g};${b}m`); }
const RESET = ESC('0m');

// ----------------------- Math / Helpers (Three) ----------------------------
const TAU = Math.PI*2;
const Vec2 = THREE.Vector2; const Vec3 = THREE.Vector3;

function vec2(x=0,y=0){ return new Vec2(x,y); }
function vec3(x=0,y=0,z=0){ return new Vec3(x,y,z); }
function mix(a,b,t){ return a*(1-t)+b*t; }
function smoothstep(e0,e1,x){ const t = clamp01((x-e0)/(e1-e0)); return t*t*(3-2*t); }
function length2(x,y){ return Math.sqrt(x*x+y*y); }
function rotate2(x,y, ang){ const c=Math.cos(ang), s=Math.sin(ang); return {x:c*x-s*y, y:s*x+c*y}; }
function polar(x,y){ const r=length2(x,y); const a=Math.atan2(y,x); return {r,a}; }

// Value noise (hash + smooth)
function hash2(x, y){
  const s = Math.sin(x*127.1 + y*311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise2(x, y){
  const iX = Math.floor(x), iY = Math.floor(y);
  const fX = x - iX, fY = y - iY;
  const a = hash2(iX, iY), b = hash2(iX+1, iY);
  const c = hash2(iX, iY+1), d = hash2(iX+1, iY+1);
  const uX = fX*fX*(3-2*fX), uY = fY*fY*(3-2*fY);
  return mix(mix(a,b,uX), mix(c,d,uX), uY);
}
function fbm(x,y, oct=4, gain=0.5, lac=2.0){
  let a=0, amp=1, fx=x, fy=y;
  for (let i=0;i<oct;i++){
    a += noise2(fx, fy)*amp; fx*=lac; fy*=lac; amp*=gain;
  }
  return a;
}

// Built-in scenes (as composable helpers for --expr)
function vortex(x,y,t, k=1){
  const s = rotate2(x,y, t*0.25);
  const p = polar(s.x, s.y);
  const ring = Math.sin(p.r*8 - t*3)*0.5 + 0.5;
  const swirl = (Math.sin(p.a*3 + t*1.5)*0.5+0.5) * (1.0 - clamp01(p.r));
  return clamp01(0.25*ring + 0.75*swirl);
}
function lissajous(x,y,t){
  const u = Math.sin(3*x + t*2);
  const v = Math.cos(4*y - t*1.5);
  const w = Math.sin(2*(x+y) + t*0.75);
  return clamp01(0.5 + 0.5*(u*v*0.6 + w*0.4));
}
function curl(x,y,t){
  const e=0.01;
  const n1 = fbm(x+0.5*t, y-0.4*t, 3, 0.5, 2.2);
  const n2 = fbm(x-0.3*t, y+0.6*t, 3, 0.5, 2.2);
  const dx = (fbm(x+e, y, 3, 0.5, 2.2)-fbm(x-e,y,3,0.5,2.2))/(2*e);
  const dy = (fbm(x, y+e, 3, 0.5, 2.2)-fbm(x,y-e,3,0.5,2.2))/(2*e);
  const curlv = (dy - dx)*0.5;
  return clamp01(0.5 + 0.5*(n1*0.6 + n2*0.2 + curlv*0.6));
}

const lib = {
  THREE, Vec2, Vec3, vec2, vec3,
  mix, smoothstep, clamp01, length2, rotate2, polar,
  noise2, fbm, vortex, lissajous, curl,
  rng,
};

// Optional user code to define helpers referenced by --expr
let userHelpers = {};
if (codeSrc && String(codeSrc).trim()){
  try {
    const fn = new Function('lib', `"use strict"; const out={};\n${codeSrc}\nreturn out;`);
    userHelpers = fn(lib) || {};
  } catch (e){
    process.stderr.write(`Failed to eval --code: ${e}\n`);
  }
}
const env = Object.assign({}, lib, userHelpers);

// Compile expression into a function
let sampleExpr;
try{
  const src = `"use strict"; const {THREE,Vec2,Vec3,vec2,vec3,mix,smoothstep,clamp01,length2,rotate2,polar,noise2,fbm,vortex,lissajous,curl,rng} = env; return (x,y,t,row,col)=>{ return (${exprSrc}); }`;
  sampleExpr = new Function('env', src)(env);
}catch(e){
  process.stderr.write(`Failed to compile --expr: ${e}\nFalling back to vortex(x,y,t)\n`);
  sampleExpr = (x,y,t)=> vortex(x,y,t);
}

// ----------------------- Row Generation Loop -------------------------------
const dt = 1/Math.max(1, rate);
const start = Date.now();
let row = 0;

function toIntensity(res){
  if (Array.isArray(res) && res.length===3){
    const [r,g,b] = res.map(v=>+v||0);
    const i = clamp01((0.2126*r + 0.7152*g + 0.0722*b)/255);
    return {i, rgb:[r|0,g|0,b|0]};
  }
  if (typeof res === 'object' && res !== null){
    if (typeof res.i === 'number'){
      const i = clamp01(res.i);
      const rgb = Array.isArray(res.rgb) ? res.rgb.map(v=>v|0) : null;
      const char = typeof res.char === 'string' ? res.char : null;
      return {i, rgb, char};
    }
  }
  if (typeof res === 'string' && res.length>0){
    return {i: 0.5, char: res[0]};
  }
  const v = clamp01(+res || 0);
  return {i: v};
}

function lineAt(rowIdx){
  const cols = width;
  const y = ((rowIdx/Math.max(1,cols)) * 2 - 1) * yscale; // slow scan by cols scale
  const t = ((Date.now() - start)/1000) * speed;
  let err = 0;
  let out = '';
  let prevColor = '';
  for (let col=0; col<cols; col++){
    const x = ((col + 0.5) / cols) * 2 - 1;
    const res = sampleExpr(x*xscale, y, t, rowIdx, col);
    const {i, rgb, char} = toIntensity(res);

    if (char){
      // Direct char emission (bypass palette)
      if (colorMode==='hsl'){
        const [r,g,b] = hslToRgb((i + t*0.05 + col/cols*0.2)%1, 0.5, 0.5);
        const colEsc = fg(r,g,b);
        if (prevColor !== colEsc){ out += colEsc; prevColor = colEsc; }
      }
      out += char;
      continue;
    }

    // Error diffusion (1D carry)
    let v = i + (ditherMode==='err' ? err*diffusion : 0);
    v = v<0?0:(v>1?1:v);
    const ch = mapToChar(v);
    const qi = (palette.indexOf(ch))/(palette.length-1);
    err = v - qi; // carry forward

    if (colorMode==='hsl'){
      const [r,g,b] = hslToRgb((i + t*0.05 + col/cols*0.2)%1, 0.6, 0.5);
      const colEsc = fg(r,g,b);
      if (prevColor !== colEsc){ out += colEsc; prevColor = colEsc; }
    }
    out += ch;
  }
  if (prevColor){ out += RESET; }
  return out;
}

let cancelled = false;
process.on('SIGINT', ()=>{ cancelled = true; process.stderr.write("\n[reel] Stopped.\n"); });

function tick(){
  if (cancelled) return;
  const line = lineAt(row);
  process.stdout.write(line + "\n");
  row++;
  if (row >= maxRows){ process.exit(0); }
}

// Pace output by rate
const interval = setInterval(tick, Math.max(1, Math.floor(1000/rate)));
process.on('exit', ()=> clearInterval(interval));


// Pace output by rate
const interval = setInterval(tick, Math.max(1, Math.floor(1000/rate)));
process.on('exit', ()=> clearInterval(interval));
