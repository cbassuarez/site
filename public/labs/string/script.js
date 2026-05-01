(() => {
  'use strict';

  // ---------- config ----------
  const PROD_API = 'https://seb-feed.cbassuarez.workers.dev';
  const params = new URLSearchParams(location.search);
  const API_BASE = (params.get('api') || PROD_API).replace(/\/+$/, '');

  const N = 720;
  const SIM_HZ = 120;
  const SIM_STEP_MS = 1000 / SIM_HZ;
  const MAX_SIM_STEPS_PER_FRAME = 10;
  const REFLECT_BASE = 0.928;

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
  const EDGE_PLUCK_FLOOR = 0.28;      // edge plucks never fully mute, but are weaker
  const REFERENCE_VIEWPORT_AREA = 1366 * 768;

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

  function clamp(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return n < min ? min : n > max ? max : n;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function viewportImpactScale() {
    const area = Math.max(1, viewW * viewH);
    // Gentle, sub-linear growth: laptops stay near 1.0, large desktops get a lift.
    return clamp(Math.pow(area / REFERENCE_VIEWPORT_AREA, 0.20), 1.0, 1.42);
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
  // tightness profile (visual + physical + sonic), decaySec, octave shift,
  // harmonic mode, detune, bitcrush bit-depth.
  function deriveIdentity(who) {
    const h = (typeof who === 'string' && who.length >= 12) ? who : '00000000000000000000';
    const a = parseInt(h.slice(0, 4), 16) || 0;
    const b = parseInt(h.slice(4, 8), 16) || 0;
    const c = parseInt(h.slice(8, 12), 16) || 0;

    const colorRGB     = PALETTE[a % PALETTE.length];
    const yOffset      = (((b & 0xFF) / 255) - 0.5) * 2 * Y_LANE_RANGE;
    const thickness    = 1.5 + (((b >> 8) & 0x07) / 7) * 4.0;       // 1.5 .. 5.5 px
    // tightness controls transport speed, visual displacement, decay, and tone.
    const tightness01  = ((c >> 5) & 0x1F) / 31;
    const slack01      = 1 - tightness01;
    const adv          = 0.34 + tightness01 * 0.62;                  // 0.34 .. 0.96
    const ampScale     = 2.4 - tightness01 * 2.0;                    // 2.4 (slack) .. 0.4 (taut)
    const pluckAmp     = 0.50 + slack01 * 0.90;                      // 0.50 .. 1.40
    const pluckWidth   = 0.55 + slack01 * 1.25;                      // 0.55 .. 1.80
    const toneBright   = 0.22 + tightness01 * 0.78;                  // 0.22 .. 1.00
    const decaySec     = 2.1 + ((c & 0x1F) / 31) * 4.2;              // 2.1 .. 6.3 s
    const damping      = Math.pow(DECAY_FLOOR, 1 / (decaySec * SIM_HZ));
    const reflectLoss  = clamp(REFLECT_BASE + tightness01 * 0.055, 0.90, 0.995);
    const bridgeCouple = 0.0007 + slack01 * 0.0008;

    // Sound variation tables — uniform, no zero-bias.
    const octaveTable    = [-2, -2, -1, 0, +1, +1, +2, +2];
    const octaveShift    = octaveTable[(c >> 10) & 7];
    const harmonicTable  = [0, 1, 2, 3, 4, 1, 2, 3];
    const harmonicMode   = harmonicTable[(c >> 13) & 7];
    const detuneCents    = ((((a >> 8) & 0xFF) / 255) - 0.5) * 40;   // ±20 cents
    const crushTable     = [0, 4, 6, 8, 10, 12, 14, 16];
    const bitcrushBits   = crushTable[(a >> 4) & 7];

    return {
      colorRGB, yOffset, thickness, tightness01, ampScale, pluckAmp, pluckWidth, toneBright, decaySec, damping, adv, reflectLoss, bridgeCouple,
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
        prevPos: new Float32Array(N),
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
    const { wL, wR, pos, prevPos, identity } = sim;
    const adv = identity.adv;
    const damp = identity.damping;
    const reflectAt0   = -wL[0]      * identity.reflectLoss;
    const reflectAtEnd = -wR[N - 1]  * identity.reflectLoss;
    for (let i = 0; i < N; i++) prevPos[i] = pos[i];
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

  function edgeExcitationGain(x01) {
    const center01 = 1 - Math.abs(clamp01(x01) - 0.5) * 2;
    return EDGE_PLUCK_FLOOR + (1 - EDGE_PLUCK_FLOOR) * center01;
  }

  function exciteSim(sim, pluck) {
    const { wL, wR, identity } = sim;
    const x01 = clamp01(pluck?.x01);
    const y01 = clamp01(pluck?.y01);
    const force01 = clamp01(pluck?.force01);
    const width01 = clamp01(pluck?.width01);
    const sign = (pluck?.sign || 1) < 0 ? -1 : 1;
    const edgeGain = edgeExcitationGain(x01);
    const viewportBoost = viewportImpactScale();
    const center = Math.max(2, Math.min(N - 3, Math.floor(x01 * (N - 1))));
    const widthSamples = Math.max(6, Math.min(96, Math.round((8 + y01 * 30) * identity.pluckWidth * (0.70 + width01 * 0.70))));
    const sigma = Math.max(1, widthSamples * 0.5);
    const sigma2 = sigma * sigma;
    const strikeAmp = sign * edgeGain * (0.90 + force01 * 0.60) * identity.pluckAmp * viewportBoost;
    for (let k = -widthSamples; k <= widthSamples; k++) {
      const idx = center + k;
      if (idx <= 0 || idx >= N - 1) continue;
      const g = Math.exp(-(k * k) / (2 * sigma2));
      const f = 0.5 * strikeAmp * g;
      wL[idx] += f;
      wR[idx] += f;
    }
    for (let i = 1; i < N - 1; i++) {
      wL[i] = clamp(wL[i], -2.8, 2.8);
      wR[i] = clamp(wR[i], -2.8, 2.8);
    }
    sim.lastActiveT = Date.now();
  }

  // ---------- sympathetic coupling (bridge-mediated cross-string exchange) ----------
  // Strings couple through a shared "bridge" drive estimate (velocity near ends),
  // then receive lane-distance-weighted bleed from neighbors.
  const COUPLING_LANE_FALLOFF = 25; // larger = steeper drop with lane distance
  const BRIDGE_TAP_LEFT = 2;
  const BRIDGE_TAP_RIGHT = N - 3;

  function couplingStep() {
    const count = sims.size;
    if (count <= 1) return;

    // First pass: estimate per-string bridge velocity.
    let globalBridgeWeighted = 0;
    let globalBridgeWeight = 0;
    for (const sim of sims.values()) {
      const vL = sim.wR[BRIDGE_TAP_LEFT] - sim.wL[BRIDGE_TAP_LEFT];
      const vR = sim.wL[BRIDGE_TAP_RIGHT] - sim.wR[BRIDGE_TAP_RIGHT];
      const bridgeV = 0.5 * (vL + vR);
      sim.bridgeV = bridgeV;
      const weight = Math.abs(bridgeV) + 0.02;
      globalBridgeWeighted += bridgeV * weight;
      globalBridgeWeight += weight;
    }
    const globalBridge = globalBridgeWeight > 0 ? (globalBridgeWeighted / globalBridgeWeight) : 0;

    // Second pass: inject a subtle bridge-normalized coupling drive.
    for (const simA of sims.values()) {
      const yA = simA.identity.yOffset;
      let neighborDrive = 0;
      let totalW = 0;
      for (const simB of sims.values()) {
        if (simB === simA) continue;
        const dy = yA - simB.identity.yOffset;
        const w = 1 / (1 + COUPLING_LANE_FALLOFF * dy * dy);
        totalW += w;
        neighborDrive += w * (simB.bridgeV - simA.bridgeV);
      }
      if (totalW <= 0) continue;
      const laneDrive = neighborDrive / totalW;
      const roomDrive = 0.25 * (globalBridge - simA.bridgeV);
      const drive = laneDrive + roomDrive;
      const impulse = simA.identity.bridgeCouple * drive;
      if (Math.abs(impulse) < 1e-6) continue;
      simA.wL[BRIDGE_TAP_LEFT] += impulse;
      simA.wR[BRIDGE_TAP_LEFT] += impulse;
      simA.wL[BRIDGE_TAP_RIGHT] += impulse;
      simA.wR[BRIDGE_TAP_RIGHT] += impulse;
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

  function playPluck(x01, y01, who, gain, pluck = null) {
    if (!ensureAudio()) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    x01 = clamp01(x01);
    y01 = clamp01(y01);
    const force01 = clamp01(pluck?.force01);
    const speed01 = clamp01(pluck?.speed01);
    const id = deriveIdentity(who);
    const baseFreq = PITCH_LOW_HZ * Math.pow(PITCH_HIGH_HZ / PITCH_LOW_HZ, x01);
    const freq = baseFreq * Math.pow(2, id.octaveShift) * Math.pow(2, id.detuneCents / 1200);
    const now = audioCtx.currentTime;
    const edgeGain = edgeExcitationGain(x01);
    const pickBrightness = clamp(0.45 + Math.abs(x01 - 0.5) * 1.2 + force01 * 0.35, 0.2, 1.55);

    const decaySec = id.decaySec;
    const env = audioCtx.createGain();
    const attackSec = VOICE_ATTACK_S * (1.48 - id.toneBright * 0.75 - speed01 * 0.35);
    const gainScale = clamp(gain * (0.68 + edgeGain * 0.42 + force01 * 0.26 + speed01 * 0.20), 0, 1.25);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gainScale * 0.40, now + Math.max(0.003, attackSec));
    env.gain.exponentialRampToValueAtTime(DECAY_FLOOR, now + decaySec);

    function addPartial(f, partialGain, harmonicN) {
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);
      const pg = audioCtx.createGain();
      const pickMode = 0.20 + 0.80 * Math.abs(Math.sin(Math.PI * harmonicN * x01));
      pg.gain.value = partialGain * pickMode;
      osc.connect(pg).connect(env);
      osc.start(now);
      osc.stop(now + decaySec + 0.05);
    }
    addPartial(freq, 1, 1);
    if (id.harmonicMode >= 1) addPartial(freq * 2, 0.12 + pickBrightness * 0.22, 2);
    if (id.harmonicMode >= 2) addPartial(freq * 3, 0.04 + pickBrightness * 0.18, 3);
    if (id.harmonicMode >= 3) addPartial(freq * 4, 0.02 + pickBrightness * 0.14, 4);
    if (id.harmonicMode >= 4) addPartial(freq * 5, 0.01 + pickBrightness * 0.10, 5);

    let signal = env;
    if (id.bitcrushBits > 0) {
      const shaper = audioCtx.createWaveShaper();
      shaper.curve = getBitcrushCurve(id.bitcrushBits);
      env.connect(shaper);
      signal = shaper;
    }

    const tone = audioCtx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.setValueAtTime(900 + (id.toneBright * 6200 + pickBrightness * 2500), now);
    tone.Q.setValueAtTime(0.65 + id.toneBright * 1.8 + force01 * 0.8, now);
    signal.connect(tone);
    signal = tone;

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
    const forceNewWho = params.get('newwho') === '1';
    try {
      if (!forceNewWho) {
        const saved = localStorage.getItem('prae:string:who');
        if (saved && /^[0-9a-f]{12}$/.test(saved)) return saved;
      }
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

  function createPluckModel(x01, y01, detail) {
    const force01 = clamp01(detail?.force01);
    const pull01 = clamp01(detail?.pull01);
    const speed01 = clamp01(detail?.speed01);
    const width01 = clamp01(
      Number.isFinite(detail?.width01)
        ? detail.width01
        : (0.45 + (1 - force01) * 0.25)
    );
    const sign = (detail?.sign || 1) < 0 ? -1 : 1;
    return { x01: clamp01(x01), y01: clamp01(y01), force01, pull01, speed01, width01, sign };
  }

  function applyPluckForWho(who, pluck, gain) {
    const sim = getSim(who);
    if (sim) exciteSim(sim, pluck);
    playPluck(pluck.x01, pluck.y01, who, gain, pluck);
    triggerSympathetic(who, pluck.x01, pluck.y01, pluck);
  }

  async function postPluck(pluck) {
    try {
      const r = await fetch(API_BASE + '/api/string/pluck', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          x: pluck.x01,
          y: pluck.y01,
          force: pluck.force01,
          pull: pluck.pull01,
          speed: pluck.speed01,
          width: pluck.width01,
          sign: pluck.sign,
          who: myWho,
        }),
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
      const pluck = createPluckModel(p.x, p.y, {
        force01: p.force,
        pull01: p.pull,
        speed01: p.speed,
        width01: p.width,
        sign: p.sign,
      });
      applyPluckForWho(p.who, pluck, 0.78);
    }, PHANTOM_DELAY_MS);
  }

  // ---------- audible sympathetic echo ----------
  // When any string is plucked, fire a low-amplitude voice on every other
  // recently-active string in *that* string's identity. The whisper of the
  // room's tonal palette tracks the visual coupling — what you see ringing
  // sympathetically also sounds.
  const SYMPATHETIC_GAIN = 0.14;
  const SYMPATHETIC_MAX = 6;
  const SYMPATHETIC_RECENT_MS = 30_000;
  const SYMPATHETIC_DELAY_MIN = 60;
  const SYMPATHETIC_DELAY_JITTER = 90;

  function triggerSympathetic(sourceWho, x01, y01, pluck) {
    const now = Date.now();
    const sourceSim = sims.get(sourceWho);
    const sourceLane = sourceSim ? sourceSim.identity.yOffset : 0;
    const candidates = [];
    for (const [w, sim] of sims) {
      if (w === sourceWho) continue;
      const age = now - sim.lastActiveT;
      if (age > SYMPATHETIC_RECENT_MS) continue;
      const dy = sourceLane - sim.identity.yOffset;
      const laneWeight = 1 / (1 + 28 * dy * dy);
      const ageWeight = 1 - age / SYMPATHETIC_RECENT_MS;
      const weight = laneWeight * ageWeight;
      candidates.push({ w, age, weight });
    }
    candidates.sort((a, b) => b.weight - a.weight);
    const limit = Math.min(candidates.length, SYMPATHETIC_MAX);
    for (let i = 0; i < limit; i++) {
      const { w, weight } = candidates[i];
      const targetSim = sims.get(w);
      if (!targetSim) continue;
      const sympatheticPluck = createPluckModel(x01, y01, {
        force01: 0.12 + clamp01(pluck?.force01) * 0.22,
        pull01: 0.08 + clamp01(pluck?.pull01) * 0.18,
        speed01: 0.06 + clamp01(pluck?.speed01) * 0.12,
        width01: 0.22 + clamp01(pluck?.width01) * 0.26,
        sign: pluck?.sign || 1,
      });
      exciteSim(targetSim, {
        ...sympatheticPluck,
        force01: sympatheticPluck.force01 * 0.35,
        pull01: sympatheticPluck.pull01 * 0.30,
        speed01: sympatheticPluck.speed01 * 0.30,
      });
      const delay = SYMPATHETIC_DELAY_MIN + Math.random() * SYMPATHETIC_DELAY_JITTER;
      const gain = SYMPATHETIC_GAIN * (0.35 + 0.65 * weight);
      setTimeout(() => playPluck(x01, y01, w, gain, sympatheticPluck), delay);
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
  let safariForce01 = 0;

  function readWebkitForce01(e) {
    const wf = Number(e?.webkitForce);
    if (!Number.isFinite(wf) || wf <= 0) return 0;
    const down = Number(window.MouseEvent?.WEBKIT_FORCE_AT_MOUSE_DOWN);
    const forceDown = Number(window.MouseEvent?.WEBKIT_FORCE_AT_FORCE_MOUSE_DOWN);
    if (Number.isFinite(down) && Number.isFinite(forceDown) && forceDown > down) {
      return clamp01((wf - down) / (forceDown - down));
    }
    return clamp01((wf - 1) / 2);
  }

  function readPointerForce01(e) {
    const p = Number(e?.pressure);
    let force01 = 0;
    if (Number.isFinite(p) && p > 0) {
      // Mouse often reports 0.5 while pressed even without real pressure sensing.
      if (!(e?.pointerType === 'mouse' && p === 0.5)) force01 = clamp01(p);
    }
    const webkitForce01 = readWebkitForce01(e);
    if (webkitForce01 > 0) force01 = Math.max(force01, webkitForce01);
    if (force01 <= 0 && safariForce01 > 0) force01 = safariForce01;
    // Non-pressure device fallback while actively pressed.
    if (force01 <= 0 && e?.buttons) force01 = 0.18;
    return clamp01(force01);
  }

  function pluckLocalTap(e) {
    const x01 = clamp01(e.clientX / viewW);
    const y01 = clamp01(e.clientY / viewH);
    const force01 = readPointerForce01(e);
    const pluck = createPluckModel(x01, y01, {
      force01,
      width01: 0.48 + (1 - force01) * 0.22,
      sign: Math.random() < 0.5 ? -1 : 1,
    });
    myCursorX = x01;
    applyPluckForWho(myWho, pluck, 0.92);
    postPluck(pluck);
  }

  canvas.addEventListener('webkitmouseforcechanged', (e) => {
    safariForce01 = readWebkitForce01(e);
  }, { passive: true });

  canvas.addEventListener('pointermove', (e) => {
    myCursorX = clamp01(e.clientX / viewW);
  }, { passive: true });

  canvas.addEventListener('pointerdown', (e) => {
    if (!ensureAudio()) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    if (!pollTimer) pollTimer = setTimeout(pollRecent, 50);
    pluckLocalTap(e);
  }, { passive: true });

  // ---------- render ----------
  const SELF_ALPHA = 1.0;
  const OTHER_ALPHA = 0.56;
  const SELF_WIDTH_BOOST = 1.55;
  const SELF_OUTLINE_ALPHA = 0.28;

  function renderSim(sim, ampPx, interpAlpha) {
    const { pos, prevPos, identity, who } = sim;
    const yMid = (0.5 + identity.yOffset) * viewH;
    const isSelf = who === myWho;
    const alpha = isSelf ? SELF_ALPHA : OTHER_ALPHA;
    const [r, g, b] = identity.colorRGB;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const a = ampPx * identity.ampScale;
    const yAt = (i) => yMid + lerp(prevPos[i], pos[i], interpAlpha) * a;
    ctx.moveTo(0, yAt(0));
    for (let i = 1; i < N - 1; i++) {
      const x = (i / (N - 1)) * viewW;
      const y = yAt(i);
      const nx = ((i + 1) / (N - 1)) * viewW;
      const ny = yAt(i + 1);
      ctx.quadraticCurveTo(x, y, 0.5 * (x + nx), 0.5 * (y + ny));
    }
    ctx.lineTo(viewW, yAt(N - 1));
    if (isSelf) {
      ctx.lineWidth = identity.thickness * SELF_WIDTH_BOOST + 2;
      ctx.strokeStyle = `rgba(0,0,0,${SELF_OUTLINE_ALPHA})`;
      ctx.stroke();
    }
    ctx.lineWidth = identity.thickness * (isSelf ? SELF_WIDTH_BOOST : 1);
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.stroke();
  }

  function renderSelfMarker(sim) {
    const yMid = (0.5 + sim.identity.yOffset) * viewH;
    const [r, g, b] = sim.identity.colorRGB;
    ctx.fillStyle = `rgba(${r},${g},${b},1)`;
    ctx.beginPath();
    ctx.arc(12, yMid, 4, 0, Math.PI * 2);
    ctx.arc(viewW - 12, yMid, 4, 0, Math.PI * 2);
    ctx.fill();
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

  let simAccumulatorMs = 0;
  let simLastFrameMs = performance.now();

  function render(nowMs) {
    let frameDelta = nowMs - simLastFrameMs;
    if (!Number.isFinite(frameDelta) || frameDelta < 0) frameDelta = SIM_STEP_MS;
    simLastFrameMs = nowMs;
    frameDelta = Math.min(frameDelta, SIM_STEP_MS * MAX_SIM_STEPS_PER_FRAME);
    simAccumulatorMs += frameDelta;

    let steps = 0;
    while (simAccumulatorMs >= SIM_STEP_MS && steps < MAX_SIM_STEPS_PER_FRAME) {
      for (const sim of sims.values()) stepSim(sim);
      couplingStep();
      simAccumulatorMs -= SIM_STEP_MS;
      steps++;
    }
    if (steps >= MAX_SIM_STEPS_PER_FRAME && simAccumulatorMs > SIM_STEP_MS * 2) {
      simAccumulatorMs = SIM_STEP_MS;
    }

    const interpAlpha = clamp01(simAccumulatorMs / SIM_STEP_MS);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, viewW, viewH);
    const ampPx = clamp(
      viewH * STRING_AMP_FRAC * (0.96 + 0.18 * (viewportImpactScale() - 1)),
      82,
      300
    );
    for (const sim of sims.values()) renderSim(sim, ampPx, interpAlpha);
    const mySim = sims.get(myWho);
    if (mySim) renderSelfMarker(mySim);
    for (const sim of sims.values()) renderCursor(sim);
    requestAnimationFrame(render);
  }
  requestAnimationFrame((t) => {
    simLastFrameMs = Number.isFinite(t) ? t : performance.now();
    requestAnimationFrame(render);
  });

  // ---------- bootstrap ----------
  // Register presence and resolve myWho before any pluck.
  postCursor(myCursorX);
  startHeartbeat();
  pollTimer = setTimeout(pollRecent, 200);
})();
