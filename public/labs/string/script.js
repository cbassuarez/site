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
  const REMOTE_CURSOR_STALE_MS = 6_000;
  const SIM_GC_INTERVAL_MS = 5_000;

  const PITCH_LOW_HZ = 130.81; // C3
  const PITCH_HIGH_HZ = 1046.5; // C6
  const VOICE_ATTACK_S = 0.030;
  const DECAY_FLOOR = 0.0005; // -66 dB target for both audio + visual

  const BG = '#fafafa';
  const STRING_AMP_FRAC = 0.12;       // per-string vertical amplitude (frac of viewH)
  const Y_LANE_RANGE = 0.20;          // total ±range of y-offsets (frac of viewH)

  // ---------- canvas ----------
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  let dpr = 1, viewW = 0, viewH = 0;
  const helpDialog = document.getElementById('string-help-dialog');
  const helpOpenButton = document.getElementById('string-help-open');
  const HELP_SEEN_KEY = 'prae:string:help:v1';

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

  function markHelpSeen() {
    try {
      localStorage.setItem(HELP_SEEN_KEY, '1');
    } catch (_) {}
  }

  function openHelpDialog() {
    if (!helpDialog || helpDialog.open) return;
    if (typeof helpDialog.showModal === 'function') {
      helpDialog.showModal();
      return;
    }
    helpDialog.setAttribute('open', '');
  }

  if (helpOpenButton) helpOpenButton.addEventListener('click', openHelpDialog);
  if (helpDialog) {
    helpDialog.addEventListener('close', markHelpSeen);
    helpDialog.addEventListener('cancel', markHelpSeen);
    const dismissHelpButton = helpDialog.querySelector('[data-close-help]');
    if (dismissHelpButton) dismissHelpButton.addEventListener('click', markHelpSeen);
  }

  const forceHelp = params.get('help') === '1';
  let seenHelp = false;
  try {
    seenHelp = localStorage.getItem(HELP_SEEN_KEY) === '1';
  } catch (_) {}
  if (forceHelp || !seenHelp) openHelpDialog();

  // ---------- identity (deterministic per `who` hash) ----------
  // Curated palette of 24 colors that all read clearly on a warm-white field.
  // Saturated enough to identify; not so bright they vibrate.
  const PALETTE = [
    [168, 36, 56],   // deep crimson
    [192, 57, 43],   // brick red
    [211, 84, 0],    // burnt orange
    [184, 110, 33],  // amber
    [127, 96, 0],    // ochre
    [85, 122, 58],   // forest green
    [39, 174, 96],   // emerald
    [22, 160, 133],  // teal
    [26, 140, 130],  // viridian
    [31, 78, 121],   // navy
    [41, 128, 185],  // ocean
    [58, 49, 133],   // indigo
    [108, 52, 131],  // purple
    [142, 68, 173],  // amethyst
    [162, 62, 140],  // magenta
    [196, 82, 139],  // hot pink
    [146, 52, 95],   // deep rose
    [80, 45, 73],    // mauve
    [61, 44, 74],    // eggplant
    [38, 70, 83],    // slate teal
    [42, 64, 69],    // dark cyan
    [73, 56, 38],    // walnut
    [60, 40, 22],    // dark espresso
    [44, 62, 80],    // midnight blue
  ];

  // Each user's hash → a unique set of: color (palette idx), y-lane, thickness,
  // ampScale (tightness/floppiness), decaySec, adv (wave speed), octave shift,
  // harmonic mode, detune, bitcrush bit-depth.
  function deriveIdentity(who) {
    const h = (typeof who === 'string' && who.length >= 12) ? who : '00000000000000000000';
    const a = parseInt(h.slice(0, 4), 16) || 0;
    const b = parseInt(h.slice(4, 8), 16) || 0;
    const c = parseInt(h.slice(8, 12), 16) || 0;

    const colorRGB     = PALETTE[a % PALETTE.length];
    const yOffset      = (((b & 0xFF) / 255) - 0.5) * 2 * Y_LANE_RANGE;
    const thickness    = 1.5 + (((b >> 8) & 0x07) / 7) * 4.0;       // 1.5 .. 5.5 px
    // tightness controls wave speed (advection) AND visual amplitude scale —
    // taut strings have fast waves and small displacement; slack strings flop.
    const tightness01  = ((c >> 5) & 0x1F) / 31;
    const adv          = 0.45 + tightness01 * 0.45;                  // 0.45 .. 0.90
    const ampScale     = 1.7 - tightness01 * 1.2;                    // 1.7 (slack) .. 0.5 (taut)
    const decaySec     = 2.0 + ((c & 0x1F) / 31) * 4.0;              // 2.0 .. 6.0 s
    const damping      = Math.pow(DECAY_FLOOR, 1 / (decaySec * 60 * SUBSTEPS));

    // Sound variation tables — uniform, no zero-bias.
    const octaveTable    = [-2, -2, -1, 0, +1, +1, +2, +2];
    const octaveShift    = octaveTable[(c >> 10) & 7];
    const harmonicTable  = [0, 1, 2, 3, 4, 1, 2, 3];
    const harmonicMode   = harmonicTable[(c >> 13) & 7];
    const detuneCents    = ((((a >> 8) & 0xFF) / 255) - 0.5) * 40;   // ±20 cents
    const crushTable     = [0, 4, 6, 8, 10, 12, 14, 16];
    const bitcrushBits   = crushTable[(a >> 4) & 7];

    return {
      colorRGB, yOffset, thickness, ampScale, decaySec, damping, adv,
      octaveShift, harmonicMode, detuneCents, bitcrushBits,
    };
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
        lastActiveT: Date.now(),
        cursorX: 0.5,
        cursorAt: Date.now(),
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

  // ---------- sympathetic coupling (cross-string energy exchange) ----------
  // Each substep, every sim is nudged toward the per-cell *distance-weighted*
  // mean of all *other* sims by COUPLING_STRENGTH. Weight w(A,B) = 1/(1+α·Δy²)
  // where Δy is the difference in y-lane offsets. Closer-lane neighbors couple
  // more strongly, like nearby strings on a piano. K=0.001 over 120 substeps/sec
  // gives ~12%/sec damping toward the (weighted) shared field — strings remain
  // individually identifiable while settled strings get sympathetically excited
  // by their neighbors' plucks.
  const COUPLING_STRENGTH = 0.001;
  const COUPLING_LANE_FALLOFF = 25;       // α: w = 1/(1+α·Δy²); 25 → opposite-end pairs ≈20% of same-lane
  const sharedL = new Float32Array(N);
  const sharedR = new Float32Array(N);

  function couplingStep() {
    const count = sims.size;
    if (count <= 1) return;
    const k = COUPLING_STRENGTH;
    const alpha = COUPLING_LANE_FALLOFF;
    for (const simA of sims.values()) {
      sharedL.fill(0);
      sharedR.fill(0);
      let totalW = 0;
      const yA = simA.identity.yOffset;
      for (const simB of sims.values()) {
        if (simB === simA) continue;
        const dy = yA - simB.identity.yOffset;
        const w = 1 / (1 + alpha * dy * dy);
        totalW += w;
        const wLB = simB.wL, wRB = simB.wR;
        for (let i = 0; i < N; i++) {
          sharedL[i] += w * wLB[i];
          sharedR[i] += w * wRB[i];
        }
      }
      if (totalW <= 0) continue;
      const inv = 1 / totalW;
      const wLA = simA.wL, wRA = simA.wR, posA = simA.pos;
      for (let i = 0; i < N; i++) {
        const meanOtherL = sharedL[i] * inv;
        const meanOtherR = sharedR[i] * inv;
        wLA[i] += k * (meanOtherL - wLA[i]);
        wRA[i] += k * (meanOtherR - wRA[i]);
        posA[i] = wLA[i] + wRA[i];
      }
    }
  }

  function gcSims() {
    const now = Date.now();
    for (const [who, sim] of sims) {
      if (who === myWho) continue;
      if (now - sim.cursorAt <= REMOTE_CURSOR_STALE_MS) continue;
      sims.delete(who);
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
          sim.cursorAt = Date.now();
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
      const sim = sims.get(p.who);
      if (sim) exciteSim(sim, x01, y01, 0.85 + Math.random() * 0.15);
      playPluck(x01, y01, p.who, 0.78);
      triggerSympathetic(p.who, x01, y01);
    }, PHANTOM_DELAY_MS);
  }

  // ---------- audible sympathetic echo ----------
  // When any string is plucked, fire a low-amplitude voice on every other
  // recently-active string in *that* string's identity. The whisper of the
  // room's tonal palette tracks the visual coupling — what you see ringing
  // sympathetically also sounds.
  const SYMPATHETIC_GAIN = 0.18;
  const SYMPATHETIC_MAX = 6;
  const SYMPATHETIC_RECENT_MS = 30_000;
  const SYMPATHETIC_DELAY_MIN = 60;
  const SYMPATHETIC_DELAY_JITTER = 90;

  function triggerSympathetic(sourceWho, x01, y01) {
    const now = Date.now();
    const candidates = [];
    for (const [w, sim] of sims) {
      if (w === sourceWho) continue;
      const age = now - sim.lastActiveT;
      if (age > SYMPATHETIC_RECENT_MS) continue;
      candidates.push({ w, age });
    }
    candidates.sort((a, b) => a.age - b.age);
    const limit = Math.min(candidates.length, SYMPATHETIC_MAX);
    for (let i = 0; i < limit; i++) {
      const { w } = candidates[i];
      const delay = SYMPATHETIC_DELAY_MIN + Math.random() * SYMPATHETIC_DELAY_JITTER;
      setTimeout(() => playPluck(x01, y01, w, SYMPATHETIC_GAIN), delay);
    }
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
    triggerSympathetic(myWho, x01, y01);
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
  const SELF_ALPHA = 1.0;
  const OTHER_ALPHA = 0.78;

  function renderSim(sim, ampPx) {
    const { pos, identity, who } = sim;
    const yMid = (0.5 + identity.yOffset) * viewH;
    const alpha = who === myWho ? SELF_ALPHA : OTHER_ALPHA;
    const [r, g, b] = identity.colorRGB;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = identity.thickness;
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.beginPath();
    const a = ampPx * identity.ampScale;
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * viewW;
      const y = yMid + pos[i] * a;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function renderCursor(sim) {
    const cursorAge = Date.now() - sim.cursorAt;
    if (sim.cursorAt === 0 || cursorAge > 5000) return;
    if (sim.who === myWho) return;
    const yMid = (0.5 + sim.identity.yOffset) * viewH;
    const x = sim.cursorX * viewW;
    const fade = Math.max(0, 1 - cursorAge / 5000);
    const [r, g, b] = sim.identity.colorRGB;
    ctx.fillStyle = `rgba(${r},${g},${b},${0.7 * fade})`;
    ctx.beginPath();
    ctx.arc(x, yMid, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }

  function render() {
    for (let s = 0; s < SUBSTEPS; s++) {
      for (const sim of sims.values()) stepSim(sim);
      couplingStep();
    }
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, viewW, viewH);
    const ampPx = Math.min(viewH * STRING_AMP_FRAC, 110);
    for (const sim of sims.values()) renderSim(sim, ampPx);
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
