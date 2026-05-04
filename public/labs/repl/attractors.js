// Attractors — public/local/internal data adapters normalized into one
// organismic bias field.
//
// Design:
//   attractor weather
//   attractor weather.dew
//   attractor quake
//   attractor tide
//   attractor solar
//   attractor archive
//
// Each attractor returns normalized signals:
//
//   {
//     intensity:   0..1,
//     volatility: 0..1,
//     pressure:   0..1,
//     density:    0..1,
//     periodicity:0..1,
//     rupture:    0..1,
//     age:        0..1,
//     confidence: 0..1,
//     source:     'live' | 'fallback'
//   }
//
// These signals do not directly set music. The scheduler uses them to bias
// wildcard/random choices for params, speed, samples, and random pitch.

(function (root) {
  'use strict';

  const CACHE_TTL_MS = 10 * 60 * 1000;
  const WEATHER_DEFAULT_POINT = { lat: 34.0522, lon: -118.2437, label: 'los-angeles' };
  const DEFAULT_TIDE_STATION = '9410660'; // Los Angeles, CA
  const NASA_DEMO_KEY = 'DEMO_KEY';

  const cache = new Map();
  const liveCache = new Map();

  const ZERO = freezeSignals({
    intensity: 0,
    volatility: 0,
    pressure: 0,
    density: 0,
    periodicity: 0,
    rupture: 0,
    age: 1,
    confidence: 0,
    source: 'fallback',
    label: 'none',
  });

  function freezeSignals(v) {
    return Object.freeze(normalizeSignals(v));
  }

  function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  function clamp(v, lo, hi) {
    const n = Number(v);
    if (!Number.isFinite(n)) return lo;
    return n < lo ? lo : n > hi ? hi : n;
  }

  function normalizeSignals(raw) {
    const out = {
      intensity: clamp01(raw && raw.intensity),
      volatility: clamp01(raw && raw.volatility),
      pressure: clamp01(raw && raw.pressure),
      density: clamp01(raw && raw.density),
      periodicity: clamp01(raw && raw.periodicity),
      rupture: clamp01(raw && raw.rupture),
      age: clamp01(raw && raw.age),
      confidence: clamp01(raw && raw.confidence),
      source: raw && raw.source ? String(raw.source) : 'fallback',
      label: raw && raw.label ? String(raw.label) : '',
      updatedAt: raw && raw.updatedAt ? String(raw.updatedAt) : new Date().toISOString(),
    };

    return out;
  }

  function parseAttractorSpec(input) {
    if (!input) return null;

    if (typeof input === 'string') {
      return parseAttractorSpec({ raw: input });
    }

    const raw = String(input.raw || input.name || '').trim().toLowerCase();
    if (!raw || raw === 'off' || raw === 'none') return null;

    const parts = raw.split('.').filter(Boolean);
    const kind = parts[0] || 'archive';
    const mode = parts.slice(1).join('.') || '';

    return {
      raw,
      kind,
      mode,
      source: input.source || {},
    };
  }

  function sourceValue(spec, key, fallback) {
    if (!spec || !spec.source) return fallback;
    const v = spec.source[key];
    return v == null || v === '' ? fallback : v;
  }

  function parseCoords(value) {
    const raw = String(value || '').trim();
    const m = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      lat: clamp(lat, -90, 90),
      lon: clamp(lon, -180, 180),
    };
  }

  function liveKeyFor(spec) {
    const raw = spec && spec.raw ? String(spec.raw).toLowerCase() : '';
    const kind = spec && spec.kind ? String(spec.kind).toLowerCase() : raw;
    if (raw === 'mic' || raw === 'interface' || raw === 'tab' || raw === 'input') return raw;
    if (kind === 'mic' || kind === 'interface' || kind === 'tab' || kind === 'input') return kind;
    return '';
  }

  function liveValueFor(spec) {
    const key = liveKeyFor(spec);
    if (!key) return null;
    return liveCache.get(key) || null;
  }

  function setLive(label, signals) {
    const key = String(label || '').trim().toLowerCase();
    if (!key) return;
    liveCache.set(key, freezeSignals({
      ...(signals || {}),
      source: 'live',
      label: signals && signals.label ? signals.label : key,
      updatedAt: signals && signals.updatedAt ? signals.updatedAt : new Date().toISOString(),
    }));
  }

  function clearLive(label) {
    const key = String(label || '').trim().toLowerCase();
    if (!key) return;
    liveCache.delete(key);
  }

  function keyFor(spec) {
    return JSON.stringify({
      kind: spec.kind,
      mode: spec.mode,
      source: spec.source || {},
    });
  }

  function get(specLike) {
    const spec = parseAttractorSpec(specLike);
    if (!spec) return Promise.resolve(ZERO);

    const live = liveValueFor(spec);
    if (live) return Promise.resolve(live);

    const key = keyFor(spec);
    const hit = cache.get(key);
    const now = Date.now();

    if (hit && now - hit.at < CACHE_TTL_MS) {
      return hit.promise;
    }

    const promise = fetchAttractor(spec)
      .then((signals) => freezeSignals(signals))
      .catch(() => fallbackFor(spec));

    cache.set(key, { at: now, promise });
    return promise;
  }

  function peek(specLike) {
    const spec = parseAttractorSpec(specLike);
    if (!spec) return ZERO;

    const live = liveValueFor(spec);
    if (live) return live;

    const hit = cache.get(keyFor(spec));
    if (!hit || !hit.value) {
      // Kick the request off asynchronously, but never block scheduling.
      get(spec).then((v) => {
        const k = keyFor(spec);
        const current = cache.get(k);
        if (current) current.value = v;
      });
      return fallbackFor(spec);
    }

    return hit.value;
  }

  function warm(program) {
    if (!program || !Array.isArray(program.blocks)) return;
    for (const block of program.blocks) {
      if (block && block.attractor) {
        get(block.attractor).then((v) => {
          const spec = parseAttractorSpec(block.attractor);
          if (!spec) return;
          const current = cache.get(keyFor(spec));
          if (current) current.value = v;
        });
      }
    }
  }

  async function fetchAttractor(spec) {
    switch (spec.kind) {
      case 'weather': return fetchWeather(spec);
      case 'quake': return fetchQuake(spec);
      case 'tide': return fetchTide(spec);
      case 'solar': return fetchSolar(spec);

      // v1 fallback/synthetic adapters. They still produce normalized fields
      // so patches remain portable while richer API adapters are added later.
      case 'air':
      case 'traffic':
      case 'grid':
      case 'orbit':
      case 'civic':
      case 'archive':
      case 'tub':
      case 'room':
      case 'audience':
      case 'input':
      case 'mic':
      case 'interface':
      case 'tab':
      case 'body':
      case 'memory':
      case 'habit':
      case 'error':
      case 'feedback':
        return fallbackFor(spec);

      default:
        return fallbackFor(spec);
    }
  }

  async function fetchJson(url) {
    const r = await fetch(url, {
      credentials: 'omit',
      headers: { Accept: 'application/geo+json, application/json' },
    });
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }

  async function fetchWeather(spec) {
    const station = String(sourceValue(spec, 'station', '')).trim().toUpperCase();
    const coords = parseCoords(sourceValue(spec, 'coords', '')) || WEATHER_DEFAULT_POINT;

    let observation = null;

    if (station && station !== 'AUTO') {
      const latest = await fetchJson(`https://api.weather.gov/stations/${encodeURIComponent(station)}/observations/latest`);
      observation = latest && latest.properties ? latest.properties : null;
    } else {
      const point = await fetchJson(`https://api.weather.gov/points/${coords.lat},${coords.lon}`);
      const stationsUrl = point && point.properties && point.properties.observationStations;
      if (stationsUrl) {
        const stations = await fetchJson(stationsUrl);
        const first = stations && stations.features && stations.features[0];
        const id = first && first.properties && first.properties.stationIdentifier;
        if (id) {
          const latest = await fetchJson(`https://api.weather.gov/stations/${encodeURIComponent(id)}/observations/latest`);
          observation = latest && latest.properties ? latest.properties : null;
        }
      }
    }

    if (!observation) return fallbackFor(spec);

    const tempC = valueOf(observation.temperature);
    const dewC = valueOf(observation.dewpoint);
    const windKmh = valueOf(observation.windSpeed);
    const gustKmh = valueOf(observation.windGust);
    const pressurePa = valueOf(observation.barometricPressure);
    const visibilityM = valueOf(observation.visibility);

    const humidityProxy = Number.isFinite(tempC) && Number.isFinite(dewC)
      ? clamp01((dewC + 5) / Math.max(1, tempC + 10))
      : 0.35;

    const wind = Number.isFinite(windKmh) ? clamp01(windKmh / 80) : 0.25;
    const gust = Number.isFinite(gustKmh) ? clamp01(gustKmh / 100) : wind;
    const pressure = Number.isFinite(pressurePa) ? clamp01((pressurePa - 97000) / 7000) : 0.5;
    const visibility = Number.isFinite(visibilityM) ? clamp01(1 - visibilityM / 16000) : 0.2;
    const age = ageFromTime(observation.timestamp, 3 * 60 * 60 * 1000);

    return normalizeSignals({
      intensity: clamp01((humidityProxy + wind + visibility) / 3),
      volatility: clamp01((gust + wind) / 2),
      pressure,
      density: clamp01((humidityProxy + visibility) / 2),
      periodicity: 0.25,
      rupture: clamp01(gust * 0.35),
      age,
      confidence: 0.9 * (1 - age),
      source: 'live',
      label: `weather${station ? ':' + station : ''}`,
      updatedAt: observation.timestamp || new Date().toISOString(),
    });
  }

  async function fetchQuake(spec) {
    const feed = String(sourceValue(spec, 'feed', 'all_day')).toLowerCase();
    const feedName = /^[a-z0-9_]+$/.test(feed) ? feed : 'all_day';
    const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feedName}.geojson`;
    const data = await fetchJson(url);
    const features = Array.isArray(data.features) ? data.features : [];

    let maxMag = 0;
    let maxRupture = 0;
    let latestTime = 0;
    let depthScore = 0;

    for (const f of features) {
      const p = f && f.properties ? f.properties : {};
      const g = f && f.geometry ? f.geometry : {};
      const mag = Number(p.mag);
      const time = Number(p.time);
      const coords = Array.isArray(g.coordinates) ? g.coordinates : [];
      const depthKm = Number(coords[2]);

      if (Number.isFinite(mag)) {
        maxMag = Math.max(maxMag, mag);
        maxRupture = Math.max(maxRupture, clamp01((mag - 3) / 4));
      }
      if (Number.isFinite(time)) latestTime = Math.max(latestTime, time);
      if (Number.isFinite(depthKm)) depthScore = Math.max(depthScore, clamp01(1 - depthKm / 250));
    }

    const count = features.length;
    const age = latestTime ? clamp01((Date.now() - latestTime) / (24 * 60 * 60 * 1000)) : 1;

    return normalizeSignals({
      intensity: clamp01(maxMag / 8),
      volatility: clamp01(count / 80),
      pressure: depthScore,
      density: clamp01(count / 50),
      periodicity: 0.05,
      rupture: maxRupture,
      age,
      confidence: features.length ? 0.95 * (1 - age * 0.5) : 0.4,
      source: 'live',
      label: `quake:${feedName}`,
      updatedAt: latestTime ? new Date(latestTime).toISOString() : new Date().toISOString(),
    });
  }

  async function fetchTide(spec) {
    const station = String(sourceValue(spec, 'station', DEFAULT_TIDE_STATION)).trim() || DEFAULT_TIDE_STATION;
    const url = new URL('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter');
    url.searchParams.set('product', 'water_level');
    url.searchParams.set('application', 'cbassuarez-repl');
    url.searchParams.set('begin_date', 'latest');
    url.searchParams.set('range', '6');
    url.searchParams.set('datum', 'MLLW');
    url.searchParams.set('station', station);
    url.searchParams.set('time_zone', 'gmt');
    url.searchParams.set('units', 'metric');
    url.searchParams.set('format', 'json');

    const data = await fetchJson(url.toString());
    const rows = Array.isArray(data.data) ? data.data : [];
    const values = rows
      .map((row) => Number(row.v))
      .filter((v) => Number.isFinite(v));

    if (!values.length) return fallbackFor(spec);

    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const latest = values[values.length - 1];
    const prev = values.length > 1 ? values[values.length - 2] : latest;
    const range = Math.max(0.001, max - min);
    const heightNorm = clamp01((latest - min) / range);
    const motion = clamp01(Math.abs(latest - prev) / Math.max(0.001, range * 0.5));

    return normalizeSignals({
      intensity: heightNorm,
      volatility: motion,
      pressure: heightNorm,
      density: clamp01(range / 3),
      periodicity: 0.9,
      rupture: clamp01(Math.max(0, heightNorm - 0.85) * 4),
      age: 0.1,
      confidence: 0.85,
      source: 'live',
      label: `tide:${station}`,
      updatedAt: new Date().toISOString(),
    });
  }

  async function fetchSolar(spec) {
    const today = new Date();
    const start = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startDate = isoDate(start);
    const endDate = isoDate(today);

    const endpoints = [
      `https://api.nasa.gov/DONKI/FLR?startDate=${startDate}&endDate=${endDate}&api_key=${NASA_DEMO_KEY}`,
      `https://api.nasa.gov/DONKI/GST?startDate=${startDate}&endDate=${endDate}&api_key=${NASA_DEMO_KEY}`,
      `https://api.nasa.gov/DONKI/CME?startDate=${startDate}&endDate=${endDate}&api_key=${NASA_DEMO_KEY}`,
    ];

    const results = await Promise.allSettled(endpoints.map(fetchJson));

    const flares = Array.isArray(valueFromSettled(results[0])) ? valueFromSettled(results[0]) : [];
    const storms = Array.isArray(valueFromSettled(results[1])) ? valueFromSettled(results[1]) : [];
    const cmes = Array.isArray(valueFromSettled(results[2])) ? valueFromSettled(results[2]) : [];

    let flareScore = 0;
    let latest = 0;

    for (const f of flares) {
      flareScore = Math.max(flareScore, flareClassScore(f.classType || f.class_type || ''));
      latest = Math.max(latest, Date.parse(f.beginTime || f.peakTime || f.endTime || '') || 0);
    }

    for (const s of storms) {
      latest = Math.max(latest, Date.parse(s.startTime || '') || 0);
    }

    for (const c of cmes) {
      latest = Math.max(latest, Date.parse(c.startTime || '') || 0);
    }

    const eventCount = flares.length + storms.length + cmes.length;
    const age = latest ? clamp01((Date.now() - latest) / (7 * 24 * 60 * 60 * 1000)) : 1;

    return normalizeSignals({
      intensity: clamp01(Math.max(flareScore, eventCount / 20)),
      volatility: clamp01(eventCount / 12),
      pressure: clamp01((storms.length + cmes.length) / 8),
      density: clamp01(eventCount / 16),
      periodicity: 0.15,
      rupture: clamp01(Math.max(flareScore, storms.length / 4)),
      age,
      confidence: eventCount ? 0.8 * (1 - age * 0.5) : 0.35,
      source: 'live',
      label: 'solar:donki',
      updatedAt: latest ? new Date(latest).toISOString() : new Date().toISOString(),
    });
  }

  function valueOf(obj) {
    if (!obj || typeof obj !== 'object') return NaN;
    return Number(obj.value);
  }

  function ageFromTime(iso, staleMs) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return 1;
    return clamp01((Date.now() - t) / staleMs);
  }

  function valueFromSettled(r) {
    return r && r.status === 'fulfilled' ? r.value : null;
  }

  function isoDate(d) {
    return d.toISOString().slice(0, 10);
  }

  function flareClassScore(classType) {
    const raw = String(classType || '').trim().toUpperCase();
    const m = raw.match(/^([ABCXMN])(\d+(?:\.\d+)?)?/);
    if (!m) return 0;
    const letter = m[1];
    const n = Number(m[2] || 1);
    const base = letter === 'X' ? 0.85
      : letter === 'M' ? 0.6
      : letter === 'C' ? 0.35
      : letter === 'B' ? 0.15
      : 0.05;
    return clamp01(base + Math.log10(Math.max(1, n)) * 0.15);
  }

  function fallbackFor(specLike) {
    const spec = parseAttractorSpec(specLike) || { kind: 'none', mode: '', raw: 'none' };
    const t = Date.now() / 1000;
    const seed = hash01(`${spec.kind}.${spec.mode}.${JSON.stringify(spec.source || {})}`);
    const slow = 0.5 + 0.5 * Math.sin(t * (0.005 + seed * 0.01) + seed * 10);
    const med = 0.5 + 0.5 * Math.sin(t * (0.019 + seed * 0.017) + seed * 17);
    const fast = 0.5 + 0.5 * Math.sin(t * (0.051 + seed * 0.03) + seed * 31);

    const profile = fallbackProfile(spec.kind);

    return freezeSignals({
      intensity: mix(profile.intensity, med, 0.35),
      volatility: mix(profile.volatility, fast, 0.35),
      pressure: mix(profile.pressure, slow, 0.35),
      density: mix(profile.density, med, 0.25),
      periodicity: mix(profile.periodicity, slow, 0.3),
      rupture: mix(profile.rupture, fast, 0.2),
      age: 1,
      confidence: 0.25,
      source: 'fallback',
      label: spec.raw || spec.kind,
      updatedAt: new Date().toISOString(),
    });
  }

  function fallbackProfile(kind) {
    switch (kind) {
      case 'weather': return { intensity: 0.45, volatility: 0.35, pressure: 0.55, density: 0.45, periodicity: 0.25, rupture: 0.1 };
      case 'quake': return { intensity: 0.35, volatility: 0.7, pressure: 0.6, density: 0.45, periodicity: 0.05, rupture: 0.6 };
      case 'tide': return { intensity: 0.5, volatility: 0.2, pressure: 0.5, density: 0.35, periodicity: 0.9, rupture: 0.05 };
      case 'solar': return { intensity: 0.55, volatility: 0.55, pressure: 0.65, density: 0.4, periodicity: 0.15, rupture: 0.45 };
      case 'air': return { intensity: 0.45, volatility: 0.25, pressure: 0.65, density: 0.7, periodicity: 0.2, rupture: 0.15 };
      case 'traffic': return { intensity: 0.55, volatility: 0.45, pressure: 0.5, density: 0.85, periodicity: 0.6, rupture: 0.2 };
      case 'grid': return { intensity: 0.6, volatility: 0.35, pressure: 0.75, density: 0.55, periodicity: 0.5, rupture: 0.25 };
      case 'orbit': return { intensity: 0.35, volatility: 0.25, pressure: 0.4, density: 0.25, periodicity: 0.85, rupture: 0.1 };
      case 'civic': return { intensity: 0.5, volatility: 0.45, pressure: 0.55, density: 0.65, periodicity: 0.25, rupture: 0.25 };
      case 'archive': return { intensity: 0.4, volatility: 0.3, pressure: 0.35, density: 0.8, periodicity: 0.35, rupture: 0.05 };
      case 'tub': return { intensity: 0.65, volatility: 0.5, pressure: 0.55, density: 0.55, periodicity: 0.2, rupture: 0.35 };
      case 'memory':
      case 'habit':
        return { intensity: 0.35, volatility: 0.15, pressure: 0.45, density: 0.7, periodicity: 0.6, rupture: 0.05 };
      case 'error':
      case 'feedback':
        return { intensity: 0.55, volatility: 0.6, pressure: 0.65, density: 0.5, periodicity: 0.2, rupture: 0.5 };
      default:
        return { intensity: 0, volatility: 0, pressure: 0, density: 0, periodicity: 0, rupture: 0 };
    }
  }

  function mix(a, b, amount) {
    return a + (b - a) * amount;
  }

  function hash01(s) {
    let h = 2166136261;
    const raw = String(s || '');
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
  }

  root.ReplAttractors = {
    get,
    peek,
    warm,
    setLive,
    clearLive,
    parseAttractorSpec,
    normalizeSignals,
  };
})(window);
