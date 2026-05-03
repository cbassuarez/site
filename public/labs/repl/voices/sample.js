// Sample voice — one-shot player. Loads PCM/MP3/OGG buffers from the sample
// bank (samples/manifest.json + samples/<name>.<ext>) lazily and caches the
// decoded AudioBuffer for the session.
//
// Exposes:
//   SampleVoice.loadManifest(url)        // returns Promise<manifest>
//   SampleVoice.playSample({ audioCtx, masterBus, time, name, params, gateDuration })
//   SampleVoice.has(name)                // true if name is in manifest
//   SampleVoice.list()                   // array of known names
//
// On a missing name the function calls onMissing(name) (if provided) so the
// REPL can warn once and substitute.

(function (root) {
  'use strict';

    const _buffers = new Map();       // name → AudioBuffer
    const _pending = new Map();       // name → Promise<AudioBuffer>
    const _activeSources = new Set(); // currently playing AudioBufferSourceNodes
    let _manifest = null;             // { version, samples: [{ name, file, ... }] }
    let _manifestUrl = '';
    let _manifestPromise = null;

  function clamp(v, lo, hi) {
    const n = Number(v);
    if (!Number.isFinite(n)) return lo;
    return n < lo ? lo : n > hi ? hi : n;
  }

  function loadManifest(url) {
    if (_manifestPromise) return _manifestPromise;
    _manifestUrl = url;
    _manifestPromise = fetch(url, { credentials: 'omit' })
      .then((r) => {
        if (!r.ok) throw new Error('manifest http ' + r.status);
        return r.json();
      })
      .then((data) => {
        _manifest = data && Array.isArray(data.samples) ? data : { version: 1, samples: [] };
        return _manifest;
      })
      .catch(() => {
        _manifest = { version: 1, samples: [] };
        return _manifest;
      });
    return _manifestPromise;
  }

  function manifestEntry(name) {
    if (!_manifest) return null;
    return _manifest.samples.find((s) => s && s.name === name) || null;
  }

  function has(name) {
    return Boolean(manifestEntry(name));
  }

  function list() {
    if (!_manifest) return [];
    return _manifest.samples.map((s) => s && s.name).filter(Boolean);
  }

  // Returns the group structure from the manifest (or [] if absent / not yet
  // loaded). Each group: { id, label, samples: [name, name, ...] }.
  function groups() {
    if (!_manifest || !Array.isArray(_manifest.groups)) return [];
    return _manifest.groups
      .filter((g) => g && Array.isArray(g.samples) && g.samples.length > 0)
      .map((g) => ({
        id: String(g.id || ''),
        label: String(g.label || g.id || ''),
        samples: g.samples.slice(),
      }));
  }

  // Resolves once the manifest has been fetched (success or empty fallback).
  function ready() {
    if (_manifestPromise) return _manifestPromise;
    return Promise.resolve(_manifest || { samples: [] });
  }

  // Returns the names of every sample whose id starts with `prefix`. Empty
  // prefix matches all. Used by the DSL's wildcard selectors.
  function expandPrefix(prefix) {
    if (!_manifest) return [];
    const p = String(prefix || '');
    const out = [];
    for (const s of _manifest.samples) {
      if (!s || typeof s.name !== 'string') continue;
      if (p === '' || s.name.startsWith(p)) out.push(s.name);
    }
    return out;
  }

  function resolveSampleUrl(entry) {
    if (!entry) return '';
    if (entry.url) return entry.url;
    const file = entry.file || (entry.name + '.mp3');
    // Resolve relative to the manifest URL if known, else the page.
    const base = _manifestUrl || (window.location.pathname.replace(/[^/]+$/, '') + 'samples/manifest.json');
    return new URL('./' + file.replace(/^\.?\/*/, ''), new URL(base, window.location.href)).toString();
  }

  function loadBuffer(audioCtx, name) {
    if (_buffers.has(name)) return Promise.resolve(_buffers.get(name));
    if (_pending.has(name)) return _pending.get(name);
    const entry = manifestEntry(name);
    if (!entry) return Promise.resolve(null);
    const url = resolveSampleUrl(entry);
    const promise = fetch(url, { credentials: 'omit' })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('sample http ' + r.status))))
      .then((bytes) => audioCtx.decodeAudioData(bytes))
      .then((buffer) => {
        _buffers.set(name, buffer);
        _pending.delete(name);
        return buffer;
      })
      .catch((err) => {
        _pending.delete(name);
        // eslint-disable-next-line no-console
        console.warn('[repl] sample load failed:', name, err);
        return null;
      });
    _pending.set(name, promise);
    return promise;
  }

  // Synchronous trigger: schedules the buffer if it's already cached, otherwise
  // kicks off a load and silently drops THIS event (the next time the slot
  // fires it'll play). This keeps scheduling non-blocking.
  function playSample(opts) {
    const audioCtx = opts.audioCtx;
    const masterBus = opts.masterBus;
    if (!audioCtx || !masterBus) return;
    const name = String(opts.name || '');
    const entry = manifestEntry(name);
    if (!entry) {
      if (typeof opts.onMissing === 'function') opts.onMissing(name);
      return;
    }

    const time = Number.isFinite(opts.time) ? Math.max(opts.time, audioCtx.currentTime) : audioCtx.currentTime;

    if (!_buffers.has(name)) {
      // Kick off load; silently miss this event.
      loadBuffer(audioCtx, name);
      return;
    }

    const buffer = _buffers.get(name);
    if (!buffer) return;

    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = clamp(opts.rate != null ? opts.rate : 1, 0.25, 4);

      const gainNode = audioCtx.createGain();
      const targetGain = clamp(opts.gain != null ? opts.gain : 1, 0, 1.5);
      gainNode.gain.value = targetGain;

      let signal = src;
      signal.connect(gainNode);
      signal = gainNode;

    if (audioCtx.createStereoPanner) {
      const pan = audioCtx.createStereoPanner();
      pan.pan.value = clamp(opts.pan || 0, -1, 1);
      signal.connect(pan);
      signal = pan;
    }
    signal.connect(masterBus);

      const start = clamp(opts.start || 0, 0, Math.max(0, buffer.duration - 0.01));
      const remaining = Math.max(0.001, buffer.duration - start);
      const rawGateDuration = Number(opts.gateDuration);
      const gateDuration = Number.isFinite(rawGateDuration) && rawGateDuration > 0
        ? Math.min(rawGateDuration, remaining)
        : null;

      try {
        gainNode.gain.cancelScheduledValues(time);

        if (gateDuration != null) {
          const attack = Math.min(0.005, Math.max(0.001, gateDuration * 0.2));
          const release = Math.min(0.02, Math.max(0.005, gateDuration * 0.25));
          const stopTime = time + gateDuration;
          const releaseStart = Math.max(time + attack, stopTime - release);

          gainNode.gain.setValueAtTime(0, time);
          gainNode.gain.linearRampToValueAtTime(targetGain, time + attack);
          gainNode.gain.setValueAtTime(targetGain, releaseStart);
          gainNode.gain.linearRampToValueAtTime(0, stopTime);
        } else {
          gainNode.gain.setValueAtTime(targetGain, time);
        }
      } catch {
        gainNode.gain.value = targetGain;
      }

      _activeSources.add(src);
      src.onended = () => {
        _activeSources.delete(src);
      };

      try {
        src.start(time, start);

        if (gateDuration != null) {
          src.stop(time + gateDuration + 0.005);
        }
      } catch (err) {
        _activeSources.delete(src);
        // eslint-disable-next-line no-console
        console.warn('[repl] sample start failed:', name, err);
      }
  }
    
    function stopAll(when) {
      const t = Number.isFinite(when) ? when : 0;

      for (const src of Array.from(_activeSources)) {
        try {
          src.stop(t);
        } catch {
          // Ignore sources that already ended or were already stopped.
        }
        _activeSources.delete(src);
      }
    }

  // Pre-warm: resolve manifest + start fetching every named sample now.
  function preload(audioCtx) {
    if (!_manifest) return Promise.resolve();
    return Promise.all(list().map((n) => loadBuffer(audioCtx, n)));
  }

    root.SampleVoice = {
      loadManifest,
      playSample,
      stopAll,
      has,
      list,
      groups,
      ready,
      preload,
      expandPrefix,
    };
})(window);
