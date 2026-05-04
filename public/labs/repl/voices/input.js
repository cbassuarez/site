// Live input voice — first-class browser mic/interface/tab input for the REPL.
// Owns permission, MediaStreamSource routing, per-block monitor sends, and
// normalized live attractor publication. Kept isolated from string/sample voices
// so live input cannot regress existing transport or one-shot playback.

(function (root) {
  'use strict';

  const SOURCE_KINDS = ['mic', 'interface', 'tab'];
  const FFT_SIZE = 2048;
  const MIN_DB = -90;
  const MAX_DB = -10;

  let audioCtx = null;
  let raf = 0;
  let listeners = [];

  const sources = new Map();
  const blockRoutes = new WeakMap();

  function clamp(v, lo, hi) {
    const n = Number(v);
    if (!Number.isFinite(n)) return lo;
    return n < lo ? lo : n > hi ? hi : n;
  }

  function clamp01(v) { return clamp(v, 0, 1); }

  function nowIso() {
    try { return new Date().toISOString(); } catch (_) { return ''; }
  }

  function normalizeKind(kind) {
    const key = String(kind || 'mic').trim().toLowerCase();
    return SOURCE_KINDS.includes(key) ? key : 'mic';
  }

  function emptyState(kind) {
    return {
      kind,
      status: 'disconnected',
      label: '',
      level: 0,
      error: '',
      updatedAt: nowIso(),
    };
  }

  function ensureRecord(kind) {
    const key = normalizeKind(kind);
    if (sources.has(key)) return sources.get(key);
    const record = {
      kind: key,
      stream: null,
      sourceNode: null,
      analyser: null,
      timeData: null,
      freqData: null,
      lastSpectrum: null,
      lastRms: 0,
      lastFlux: 0,
      onsetHold: 0,
      onsetTimes: [],
      state: emptyState(key),
    };
    sources.set(key, record);
    return record;
  }

  function snapshot() {
    const out = {};
    for (const kind of SOURCE_KINDS) out[kind] = { ...ensureRecord(kind).state };
    return out;
  }

  function notify() {
    const snap = snapshot();
    for (const fn of listeners) {
      try { fn(snap); } catch (_) {}
    }
  }

  function setAudioContext(ctx) {
    if (!ctx || audioCtx === ctx) return;
    audioCtx = ctx;

    // MediaStreamSource nodes are bound to one AudioContext. If the page ever
    // swaps contexts, drop old live routes rather than leaving stale graph edges.
    for (const kind of SOURCE_KINDS) {
      const record = ensureRecord(kind);
      if (record.stream) stop(kind);
    }
  }

  function ensureAudioContext(opts) {
    if (opts && opts.audioCtx) setAudioContext(opts.audioCtx);
    if (audioCtx) return audioCtx;
    if (root.StringVoice && root.StringVoice.ensureAudio) {
      setAudioContext(root.StringVoice.ensureAudio());
    }
    return audioCtx;
  }

  async function listDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((device) => device && device.kind === 'audioinput');
    } catch (_) {
      return [];
    }
  }

  function setRequesting(record) {
    record.state = {
      ...record.state,
      status: 'requesting',
      error: '',
      updatedAt: nowIso(),
    };
    notify();
  }

  function setError(record, err) {
    record.state = {
      ...record.state,
      status: 'error',
      error: err && err.message ? err.message : String(err || 'input permission failed'),
      level: 0,
      updatedAt: nowIso(),
    };
    publishSilence(record.kind);
    notify();
  }

  function labelForStream(kind, stream) {
    const tracks = stream && stream.getAudioTracks ? stream.getAudioTracks() : [];
    const label = tracks[0] && tracks[0].label ? tracks[0].label : '';
    if (label) return label;
    if (kind === 'tab') return 'tab audio';
    if (kind === 'interface') return 'audio interface';
    return 'microphone';
  }

  function mediaConstraints(kind, opts) {
    const deviceId = opts && opts.deviceId ? String(opts.deviceId) : '';
    const audio = deviceId
      ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

    if (kind === 'tab') {
      // Chrome exposes tab/system audio through getDisplayMedia. Requesting
      // video makes the chooser reliable; video tracks are stopped immediately.
      return { audio: true, video: true };
    }

    return { audio };
  }

  async function requestStream(kind, opts) {
    if (!navigator.mediaDevices) throw new Error('media input is unavailable in this browser');
    if (kind === 'tab') {
      if (!navigator.mediaDevices.getDisplayMedia) throw new Error('tab audio capture is unavailable in this browser');
      const stream = await navigator.mediaDevices.getDisplayMedia(mediaConstraints(kind, opts));
      const audioTracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
      if (!audioTracks.length) {
        if (stream.getTracks) stream.getTracks().forEach((track) => track.stop());
        throw new Error('no tab audio track was shared');
      }
      if (stream.getVideoTracks) stream.getVideoTracks().forEach((track) => track.stop());
      return stream;
    }

    if (!navigator.mediaDevices.getUserMedia) throw new Error('microphone input is unavailable in this browser');
    return navigator.mediaDevices.getUserMedia(mediaConstraints(kind, opts));
  }

  async function enable(kindLike, opts) {
    const kind = normalizeKind(kindLike);
    const ctx = ensureAudioContext(opts || {});
    if (!ctx) throw new Error('this browser does not support Web Audio input');

    const record = ensureRecord(kind);
    if (record.stream && record.sourceNode && record.analyser) {
      record.state = { ...record.state, status: 'live', error: '', updatedAt: nowIso() };
      notify();
      return record.state;
    }

    setRequesting(record);

    try {
      const stream = await requestStream(kind, opts || {});
      const sourceNode = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.minDecibels = MIN_DB;
      analyser.maxDecibels = MAX_DB;
      analyser.smoothingTimeConstant = 0.72;

      sourceNode.connect(analyser);

      record.stream = stream;
      record.sourceNode = sourceNode;
      record.analyser = analyser;
      record.timeData = new Float32Array(analyser.fftSize);
      record.freqData = new Float32Array(analyser.frequencyBinCount);
      record.lastSpectrum = new Float32Array(analyser.frequencyBinCount);
      record.lastRms = 0;
      record.lastFlux = 0;
      record.onsetHold = 0;
      record.onsetTimes = [];
      record.state = {
        kind,
        status: 'live',
        label: labelForStream(kind, stream),
        level: 0,
        error: '',
        updatedAt: nowIso(),
      };

      for (const track of stream.getAudioTracks ? stream.getAudioTracks() : []) {
        track.addEventListener('ended', () => stop(kind), { once: true });
      }

      startAnalysisLoop();
      notify();
      return record.state;
    } catch (err) {
      setError(record, err);
      throw err;
    }
  }

  function disconnectRoute(route) {
    if (!route) return;
    try { route.input.disconnect(); } catch (_) {}
    try { route.gain.disconnect(); } catch (_) {}
    try { route.pan.disconnect(); } catch (_) {}
  }

  function disconnectBlock(block) {
    const route = blockRoutes.get(block);
    if (!route) return;
    disconnectRoute(route);
    blockRoutes.delete(block);
  }

  function stop(kindLike) {
    const kind = normalizeKind(kindLike);
    const record = ensureRecord(kind);

    for (const [block, route] of Array.from(blockRoutes.entries ? blockRoutes.entries() : [])) {
      if (route && route.kind === kind) disconnectBlock(block);
    }

    // WeakMap is not iterable in browsers, so block cleanup is also performed
    // from scheduler.disconnectBlock(). The stream/source cleanup below is the
    // important part for the explicit stop button.
    try { if (record.sourceNode) record.sourceNode.disconnect(); } catch (_) {}
    try { if (record.analyser) record.analyser.disconnect(); } catch (_) {}
    if (record.stream && record.stream.getTracks) {
      record.stream.getTracks().forEach((track) => {
        try { track.stop(); } catch (_) {}
      });
    }

    record.stream = null;
    record.sourceNode = null;
    record.analyser = null;
    record.timeData = null;
    record.freqData = null;
    record.lastSpectrum = null;
    record.lastRms = 0;
    record.lastFlux = 0;
    record.onsetHold = 0;
    record.onsetTimes = [];
    record.state = emptyState(kind);
    publishSilence(kind);
    notify();
  }

  function publishSilence(kind) {
    if (!root.ReplAttractors || !root.ReplAttractors.setLive) return;
    const silent = {
      intensity: 0,
      volatility: 0,
      pressure: 0,
      density: 0,
      periodicity: 0,
      rupture: 0,
      age: 1,
      confidence: 0,
      source: 'live',
      label: kind,
      updatedAt: nowIso(),
    };
    root.ReplAttractors.setLive(kind, silent);
    root.ReplAttractors.setLive('input', { ...silent, label: 'input' });
  }

  function spectralMetrics(record) {
    const freq = record.freqData;
    const last = record.lastSpectrum;
    if (!freq || !freq.length) {
      return { centroid: 0, flatness: 0, flux: 0, lowMidEnergy: 0, brightness: 0, noisiness: 0, roughness: 0 };
    }

    let sum = 0;
    let weighted = 0;
    let geo = 0;
    let flux = 0;
    let lowMid = 0;
    let high = 0;
    let rough = 0;
    const n = freq.length;

    for (let i = 0; i < n; i++) {
      const v = Math.max(0, freq[i]);
      sum += v;
      weighted += v * (i / Math.max(1, n - 1));
      geo += Math.log(Math.max(1e-6, v));
      if (last) {
        const d = v - last[i];
        if (d > 0) flux += d;
        if (i > 0) rough += Math.abs(v - freq[i - 1]);
        last[i] = v;
      }
      const pos = i / Math.max(1, n - 1);
      if (pos >= 0.06 && pos <= 0.35) lowMid += v;
      if (pos >= 0.55) high += v;
    }

    const mean = sum / n;
    const flatness = mean > 1e-6 ? Math.exp(geo / n) / mean : 0;
    return {
      centroid: sum > 1e-6 ? weighted / sum : 0,
      flatness: clamp01(flatness),
      flux: clamp01(flux / Math.max(1, n * 0.12)),
      lowMidEnergy: clamp01(lowMid / Math.max(1, sum)),
      brightness: clamp01(high / Math.max(1, sum) * 2.2),
      noisiness: clamp01(flatness * 1.18),
      roughness: clamp01(rough / Math.max(1, n * 0.18)),
    };
  }

  function analyze(record, t) {
    if (!record.analyser || !record.timeData || !record.freqData) return;
    record.analyser.getFloatTimeDomainData(record.timeData);
    record.analyser.getFloatFrequencyData(record.freqData);

    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < record.timeData.length; i++) {
      const v = record.timeData[i];
      sumSq += v * v;
      peak = Math.max(peak, Math.abs(v));
    }

    const rms = Math.sqrt(sumSq / Math.max(1, record.timeData.length));
    const level = clamp01(rms * 6);
    const delta = Math.max(0, rms - record.lastRms);
    const metrics = spectralMetrics(record);
    const flux = clamp01(metrics.flux * 0.7 + delta * 20);
    const onset = flux > 0.28 && rms > 0.012 ? 1 : 0;

    if (onset) {
      record.onsetHold = 1;
      record.onsetTimes.push(t);
    } else {
      record.onsetHold *= 0.84;
    }

    record.onsetTimes = record.onsetTimes.filter((x) => t - x <= 4);
    const density = clamp01(record.onsetTimes.length / 12);
    const confidence = clamp01((rms - 0.004) * 22);
    const silence = rms < 0.006 ? 1 : 0;
    const periodicity = clamp01((1 - metrics.noisiness) * confidence);

    const signals = {
      intensity: level,
      volatility: flux,
      pressure: metrics.lowMidEnergy,
      density,
      periodicity,
      rupture: clamp01(record.onsetHold),
      age: silence,
      confidence,
      rms: level,
      peak: clamp01(peak),
      onset: clamp01(record.onsetHold),
      centroid: metrics.centroid,
      flatness: metrics.flatness,
      noisiness: metrics.noisiness,
      pitch: 0,
      flux,
      silence,
      brightness: metrics.brightness,
      roughness: metrics.roughness,
      source: 'live',
      label: record.kind,
      updatedAt: nowIso(),
    };

    record.lastRms = rms;
    record.lastFlux = flux;
    record.state = {
      ...record.state,
      status: 'live',
      level,
      updatedAt: signals.updatedAt,
    };

    if (root.ReplAttractors && root.ReplAttractors.setLive) {
      root.ReplAttractors.setLive(record.kind, signals);
      root.ReplAttractors.setLive('input', { ...signals, label: 'input' });
    }
  }

  function analysisFrame() {
    raf = 0;
    const t = audioCtx ? audioCtx.currentTime : performance.now() / 1000;
    let anyLive = false;

    for (const kind of SOURCE_KINDS) {
      const record = ensureRecord(kind);
      if (record.state.status === 'live' && record.analyser) {
        anyLive = true;
        analyze(record, t);
      }
    }

    if (anyLive) {
      notify();
      raf = requestAnimationFrame(analysisFrame);
    }
  }

  function startAnalysisLoop() {
    if (raf) return;
    raf = requestAnimationFrame(analysisFrame);
  }

  function routeForBlock(block, kind, destination) {
    let route = blockRoutes.get(block);
    const ctx = audioCtx;
    if (!ctx || !block) return null;

    if (route && route.kind === kind && route.destination === destination) return route;

    if (route) disconnectRoute(route);

    const input = ctx.createGain();
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    gain.gain.value = 0;
    if (pan) {
      pan.pan.value = 0;
      input.connect(gain);
      gain.connect(pan);
      pan.connect(destination);
    } else {
      input.connect(gain);
      gain.connect(destination);
    }

    route = { kind, input, gain, pan, destination };
    blockRoutes.set(block, route);
    return route;
  }

  function syncBlock(opts) {
    const block = opts && opts.block;
    const kind = normalizeKind(opts && opts.kind);
    const ctx = ensureAudioContext(opts || {});
    const destination = opts && opts.destination;
    if (!block || !ctx || !destination) return false;

    const record = ensureRecord(kind);
    if (!record.sourceNode || record.state.status !== 'live') return false;

    const route = routeForBlock(block, kind, destination);
    if (!route) return false;

    if (!route.connectedSource) {
      try {
        record.sourceNode.connect(route.input);
        route.connectedSource = record.sourceNode;
      } catch (_) {}
    } else if (route.connectedSource !== record.sourceNode) {
      try { route.connectedSource.disconnect(route.input); } catch (_) {}
      try { record.sourceNode.connect(route.input); } catch (_) {}
      route.connectedSource = record.sourceNode;
    }

    const time = Number.isFinite(opts.time) ? opts.time : ctx.currentTime;
    const gain = clamp(Number(opts.gain), 0, 2);
    const monitor = opts.monitor == null ? gain : clamp(Number(opts.monitor), 0, 2);
    const level = clamp(gain * monitor, 0, 2);
    const pan = clamp(Number(opts.pan), -1, 1);

    try {
      route.gain.gain.cancelScheduledValues(time);
      route.gain.gain.setTargetAtTime(level, Math.max(ctx.currentTime, time), 0.025);
    } catch (_) {
      try { route.gain.gain.value = level; } catch (__) {}
    }

    if (route.pan && route.pan.pan) {
      try {
        route.pan.pan.cancelScheduledValues(time);
        route.pan.pan.setTargetAtTime(pan, Math.max(ctx.currentTime, time), 0.025);
      } catch (_) {
        try { route.pan.pan.value = pan; } catch (__) {}
      }
    }

    return true;
  }

  function onStateChange(fn) {
    if (typeof fn !== 'function') return function noop() {};
    listeners.push(fn);
    try { fn(snapshot()); } catch (_) {}
    return function unsubscribe() {
      listeners = listeners.filter((item) => item !== fn);
    };
  }

  root.InputVoice = {
    setAudioContext,
    listDevices,
    enable,
    stop,
    syncBlock,
    disconnectBlock,
    getState: snapshot,
    onStateChange,
  };
})(window);
