(() => {
  'use strict';

  // ---------- config ----------
  const PROD_API = 'https://seb-feed.cbassuarez.workers.dev';
  const params = new URLSearchParams(location.search);
  const API_BASE = (params.get('api') || PROD_API).replace(/\/+$/, '');

  const N = 720;
  const SUBSTEPS = 2;
  const REFLECT_LOSS = 0.94;

  const POLL_INTERVAL_MS = 800;
  const HEARTBEAT_INTERVAL_MS = 1500;
  const PHANTOM_DELAY_MS = 240;
  const SIM_IDLE_TIMEOUT_MS = 90_000;
  const SIM_GC_INTERVAL_MS = 5_000;

  const PITCH_LOW_HZ = 130.81; // C3
  const PITCH_HIGH_HZ = 1046.5; // C6
  const VOICE_ATTACK_S = 0.030;
  const DECAY_FLOOR = 0.0005; // -66 dB target for both audio + visual

  const BG = '#fafafa';
  const STRING_AMP_FRAC = 0.12;       // per-string vertical amplitude (frac of viewH)
  const Y_LANE_RANGE = 0.20;          // total ±range of y-offsets (frac of viewH)
  const COLOR_GAIN = 14;              // motion → color saturation/lightness factor
  const GRAD_STOPS = 48;

  // ---------- canvas ----------
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  let dpr = 1, viewW = 0, viewH = 0;

  function resize() {
    dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.floor(viewW * dpr);
    canvas.height = Math.floor(viewH * dpr);
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });

  function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0.5;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  // ---------- identity (deterministic per `who` hash) ----------
  // Each user's hash → a unique set of: y-lane, hue, thickness, damping, advection rate,
  // octave shift, harmonic mode, detune, bitcrush bit-depth.
  function deriveIdentity(who) {
    const h = (typeof who === 'string' && who.length >= 12) ? who : '00000000000000000000';
    const a = parseInt(h.slice(0, 4), 16) || 0;   // 16 bits
    const b = parseInt(h.slice(4, 8), 16) || 0;   // 16 bits
    const c = parseInt(h.slice(8, 12), 16) || 0;  // 16 bits

    const huePrimary   = a % 360;
    const yOffset      = (((b & 0xFF) / 255) - 0.5) * 2 * Y_LANE_RANGE;
    const thickness    = 2.0 + (((b >> 8) & 0x07) / 7) * 3.0;       // 2.0 .. 5.0 px
    // decaySec drives BOTH audio envelope and visual damping so they fall together.
    const decaySec     = 2.5 + ((c & 0x1F) / 31) * 2.5;             // 2.5 .. 5.0 s
    const damping      = Math.pow(DECAY_FLOOR, 1 / (decaySec * 60 * SUBSTEPS));
    const adv          = 0.55   + (((c >> 5) & 0x1F) / 31) * 0.30;  // 0.55 .. 0.85

    const octaveTable  = [-1, 0, 0, 0, 0, +1, 0, +1];
    const octaveShift  = octaveTable[(c >> 10) & 7];

    const harmonicTable = [0, 0, 0, 1, 1, 2, 0, 1];
    const harmonicMode  = harmonicTable[(c >> 13) & 7];

    const detuneCents  = ((((a >> 8) & 0xFF) / 255) - 0.5) * 24;    // ±12 cents

    const crushTable   = [0, 0, 0, 0, 0, 8, 10, 12];
    const bitcrushBits = crushTable[(a >> 4) & 7];

    return {
      huePrimary, yOffset, thickness, decaySec, damping, adv,
      octaveShift, harmonicMode, detuneCents, bitcrushBits,
    };
  }

  function identityColor(id, motion01) {
    const m = motion01 < 0 ? 0 : motion01 > 1 ? 1 : motion01;
    const lightness  = 8  + 32 * m;   // 8% (settled, near black) → 40% (active, vivid)
    const saturation = 8  + 75 * m;   // 8% (settled, near grey)  → 83% (active)
    return `hsl(${id.huePrimary}, ${saturation}%, ${lightness}%)`;
  }

  // ---------- per-user simulation registry ----------
  const sims = new Map(); // who -> UserSim
  function getSim(who) {
    if (!who) return null;
    let sim = sims.get(who);
    if (!sim) {
      sim = {
        who,
        identity: deriveIdentity(who),
        wL: new Float32Array(N),
        wR: new Float32Array(N),
        pos: new Float32Array(N),
        prevPos: new Float32Array(N),
        lastActiveT: Date.now(),
        cursorX: 0.5,
        cursorAt: 0,
      };
      sims.set(who, sim);
    }
    return sim;
  }

  function stepSim(sim) {
    const { wL, wR, pos, identity } = sim;
    const adv = identity.adv;
    const damp = identity.damping;
    const reflectAt0   = -wL[0]      * REFLECT_LOSS;
    const reflectAtEnd = -wR[N - 1]  * REFLECT_LOSS;
    for (let i = N - 1; i > 0; i--) wR[i] = (1 - adv) * wR[i] + adv * wR[i - 1];
    wR[0] = (1 - adv) * wR[0] + adv * reflectAt0;
    for (let i = 0; i < N - 1; i++) wL[i] = (1 - adv) * wL[i] + adv * wL[i + 1];
    wL[N - 1] = (1 - adv) * wL[N - 1] + adv * reflectAtEnd;
    for (let i = 0; i < N; i++) {
      wL[i] *= damp;
      wR[i] *= damp;
      pos[i] = wL[i] + wR[i];
    }
  }

  function exciteSim(sim, x01, y01, amp) {
    const { wL, wR } = sim;
    const center = Math.max(2, Math.min(N - 3, Math.floor(x01 * (N - 1))));
    const widthSamples = Math.round(10 + y01 * 32);
    const sigma = widthSamples * 0.5;
    const sigma2 = sigma * sigma;
    for (let k = -widthSamples; k <= widthSamples; k++) {
      const idx = center + k;
      if (idx <= 0 || idx >= N - 1) continue;
      const f = 0.5 * amp * Math.exp(-(k * k) / (2 * sigma2));
      wL[idx] += f;
      wR[idx] += f;
    }
    sim.lastActiveT = Date.now();
  }

  function gcSims() {
    const now = Date.now();
    for (const [who, sim] of sims) {
      if (who === myWho) continue;
      const lastSeen = Math.max(sim.lastActiveT, sim.cursorAt);
      if (now - lastSeen <= SIM_IDLE_TIMEOUT_MS) continue;
      let energy = 0;
      for (let i = 0; i < N; i++) energy += sim.pos[i] * sim.pos[i];
      if (energy < 1e-7) sims.delete(who);
    }
  }
  setInterval(gcSims, SIM_GC_INTERVAL_MS);

  // ---------- audio ----------
  let audioCtx = null;
  let masterBus = null;
  const _bitcrushCurves = new Map();

  function getBitcrushCurve(bits) {
    if (_bitcrushCurves.has(bits)) return _bitcrushCurves.get(bits);
    const samples = 8192;
    const curve = new Float32Array(samples);
    const levels = Math.pow(2, bits);
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * 2 - 1;
      curve[i] = Math.round(x * levels) / levels;
    }
    _bitcrushCurves.set(bits, curve);
    return curve;
  }

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 8;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.25;
    masterBus = audioCtx.createGain();
    masterBus.gain.value = 0.45;
    masterBus.connect(compressor);
    compressor.connect(audioCtx.destination);
    return audioCtx;
  }

  function playPluck(x01, y01, who, gain) {
    if (!ensureAudio()) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const id = deriveIdentity(who);
    const baseFreq = PITCH_LOW_HZ * Math.pow(PITCH_HIGH_HZ / PITCH_LOW_HZ, x01);
    const freq = baseFreq * Math.pow(2, id.octaveShift) * Math.pow(2, id.detuneCents / 1200);
    const now = audioCtx.currentTime;

    const decaySec = id.decaySec;
    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gain * 0.42, now + VOICE_ATTACK_S);
    env.gain.exponentialRampToValueAtTime(DECAY_FLOOR, now + decaySec);

    function addPartial(f, partialGain) {
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);
      const pg = audioCtx.createGain();
      pg.gain.value = partialGain;
      osc.connect(pg).connect(env);
      osc.start(now);
      osc.stop(now + decaySec + 0.05);
    }
    addPartial(freq, 1);
    if (id.harmonicMode >= 1) addPartial(freq * 2, 0.30);
    if (id.harmonicMode >= 2) addPartial(freq * 3, 0.15);

    let signal = env;
    if (id.bitcrushBits > 0) {
      const shaper = audioCtx.createWaveShaper();
      shaper.curve = getBitcrushCurve(id.bitcrushBits);
      env.connect(shaper);
      signal = shaper;
    }
    if (audioCtx.createStereoPanner) {
      const pan = audioCtx.createStereoPanner();
      pan.pan.setValueAtTime((x01 - 0.5) * 1.4, now);
      signal.connect(pan);
      signal = pan;
    }
    signal.connect(masterBus);
  }

  // ---------- identity bootstrap (stable across reloads) ----------
  function randomWho() {
    const chars = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * 16)];
    return s;
  }
  function loadOrCreateWho() {
    try {
      const saved = localStorage.getItem('prae:string:who');
      if (saved && /^[0-9a-f]{12}$/.test(saved)) return saved;
    } catch (_) {}
    const w = randomWho();
    try { localStorage.setItem('prae:string:who', w); } catch (_) {}
    return w;
  }

  // ---------- network ----------
  let myWho = loadOrCreateWho();
  getSim(myWho); // spawn the local string immediately, before any network
  let lastSeenT = 0;
  let pollErrorBackoff = 0;
  let pollTimer = null;
  let heartbeatTimer = null;
  let myCursorX = 0.5;

  async function postPluck(x01, y01) {
    try {
      const r = await fetch(API_BASE + '/api/string/pluck', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x: x01, y: y01, who: myWho }),
      });
      if (!r.ok) return;
      const data = await r.json().catch(() => null);
      if (data && Number.isFinite(data.t)) lastSeenT = Math.max(lastSeenT, data.t);
    } catch (_) {}
  }

  async function postCursor(x01) {
    try {
      await fetch(API_BASE + '/api/string/cursor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x: x01, who: myWho }),
      });
    } catch (_) {}
  }

  async function pollRecent() {
    try {
      const url = API_BASE + '/api/string/recent?since=' + encodeURIComponent(String(lastSeenT));
      const r = await fetch(url);
      if (!r.ok) {
        pollErrorBackoff = Math.min(8000, (pollErrorBackoff || 1000) * 2);
        return;
      }
      pollErrorBackoff = 0;
      const data = await r.json().catch(() => null);
      if (!data) return;

      // ingest cursor presences (skip our own)
      if (Array.isArray(data.cursors)) {
        for (const c of data.cursors) {
          if (!c || !c.who || c.who === myWho) continue;
          const sim = getSim(c.who);
          if (!sim) continue;
          sim.cursorX = clamp01(c.x);
          sim.cursorAt = performance.now();
        }
      }

      // ingest plucks (skip our own)
      if (Array.isArray(data.plucks)) {
        for (const p of data.plucks) {
          if (!p || typeof p !== 'object') continue;
          const t = Number(p.t);
          if (!Number.isFinite(t) || t <= lastSeenT) continue;
          lastSeenT = Math.max(lastSeenT, t);
          if (myWho && p.who === myWho) continue;
          scheduleRemotePluck(p);
        }
      }
    } catch (_) {
      pollErrorBackoff = Math.min(8000, (pollErrorBackoff || 1000) * 2);
    } finally {
      const delay = pollErrorBackoff > 0 ? pollErrorBackoff : POLL_INTERVAL_MS;
      pollTimer = setTimeout(pollRecent, delay);
    }
  }

  function scheduleRemotePluck(p) {
    setTimeout(() => {
      const x01 = clamp01(p.x);
      const y01 = clamp01(p.y);
      const sim = getSim(p.who);
      if (sim) exciteSim(sim, x01, y01, 0.85 + Math.random() * 0.15);
      playPluck(x01, y01, p.who, 0.78);
    }, PHANTOM_DELAY_MS);
  }

  function startHeartbeat() {
    if (heartbeatTimer) return;
    function tick() {
      postCursor(myCursorX);
      heartbeatTimer = setTimeout(tick, HEARTBEAT_INTERVAL_MS);
    }
    tick();
  }
  function stopHeartbeat() {
    if (heartbeatTimer) { clearTimeout(heartbeatTimer); heartbeatTimer = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopHeartbeat();
    else startHeartbeat();
  });

  // ---------- input ----------
  function pluckLocal(clientX, clientY) {
    const x01 = clamp01(clientX / viewW);
    const y01 = clamp01(clientY / viewH);
    myCursorX = x01;
    const sim = getSim(myWho);
    if (sim) exciteSim(sim, x01, y01, 1.0 + Math.random() * 0.2);
    playPluck(x01, y01, myWho, 0.92);
    postPluck(x01, y01);
  }

  canvas.addEventListener('pointermove', (e) => {
    myCursorX = clamp01(e.clientX / viewW);
  }, { passive: true });

  canvas.addEventListener('pointerdown', (e) => {
    if (!ensureAudio()) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    if (!pollTimer) pollTimer = setTimeout(pollRecent, 50);
    pluckLocal(e.clientX, e.clientY);
  }, { passive: true });

  // ---------- render ----------
  function renderSim(sim, ampPx) {
    const { pos, prevPos, identity } = sim;
    const yMid = (0.5 + identity.yOffset) * viewH;

    const grad = ctx.createLinearGradient(0, yMid, viewW, yMid);
    const cellsPerStop = (N - 1) / GRAD_STOPS;
    for (let s = 0; s <= GRAD_STOPS; s++) {
      const center = Math.floor(s * cellsPerStop);
      const i0 = Math.max(0, center - 3);
      const i1 = Math.min(N - 1, center + 3);
      let m = 0;
      for (let i = i0; i <= i1; i++) {
        const d = Math.abs(pos[i] - prevPos[i]);
        if (d > m) m = d;
      }
      grad.addColorStop(s / GRAD_STOPS, identityColor(identity, m * COLOR_GAIN));
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = identity.thickness;
    ctx.strokeStyle = grad;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * viewW;
      const y = yMid + pos[i] * ampPx;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function renderCursor(sim) {
    const cursorAge = performance.now() - sim.cursorAt;
    if (sim.cursorAt === 0 || cursorAge > 5000) return;
    if (sim.who === myWho) return;
    const yMid = (0.5 + sim.identity.yOffset) * viewH;
    const x = sim.cursorX * viewW;
    const fade = Math.max(0, 1 - cursorAge / 5000);
    ctx.fillStyle = `hsla(${sim.identity.huePrimary}, 55%, 32%, ${0.55 * fade})`;
    ctx.beginPath();
    ctx.arc(x, yMid, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function render() {
    for (let s = 0; s < SUBSTEPS; s++) {
      for (const sim of sims.values()) stepSim(sim);
    }
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, viewW, viewH);
    const ampPx = Math.min(viewH * STRING_AMP_FRAC, 110);
    for (const sim of sims.values()) {
      renderSim(sim, ampPx);
      const { pos, prevPos } = sim;
      for (let i = 0; i < N; i++) prevPos[i] = pos[i];
    }
    for (const sim of sims.values()) renderCursor(sim);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  // ---------- bootstrap ----------
  // Register presence and resolve myWho before any pluck.
  postCursor(myCursorX);
  startHeartbeat();
  pollTimer = setTimeout(pollRecent, 200);
})();
