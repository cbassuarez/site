import { createMockManifest, MOCK_LIVE_FRAME, MOCK_STATUS } from './tmaydMockData';
import {
  isValidArchiveDate,
  normalizeLiveFrame,
  normalizeManifest,
  normalizeStatus
} from './tmaydUtils';

const API_TIMEOUT_MS = 10000;

function cleanBase(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed === '/') {
    return '/';
  }
  return trimmed.replace(/\/$/, '');
}

function getConfiguredApiBase() {
  const preferred = cleanBase(import.meta.env.VITE_TMYD_API_BASE);
  if (preferred) {
    return preferred;
  }
  return cleanBase(import.meta.env.VITE_TMYAD_API_BASE);
}

export function getApiBase() {
  return getConfiguredApiBase();
}

function isApiConfigured() {
  return Boolean(getConfiguredApiBase());
}

function joinApiUrl(base, path) {
  if (!base || base === "/") {
    return path;
  }
  if (/\/api$/i.test(base) && path.startsWith("/api/")) {
    return base + path.slice(4);
  }
  return base + path;
}

function toErrorKindFromStatus(status) {
  if (status === 429) {
    return 'rate_limited';
  }
  if (status >= 500) {
    return 'unavailable';
  }
  if (status >= 400) {
    return 'bad_request';
  }
  return 'unknown';
}

function resolveAssetUrl(url, apiBase) {
  const value = typeof url === 'string' ? url.trim() : '';
  if (!value) {
    return '';
  }
  if (/^(https?:|data:)/i.test(value)) {
    return value;
  }
  if (!apiBase || apiBase === '/') {
    return value;
  }
  if (/^https?:\/\//i.test(apiBase)) {
    const origin = new URL(apiBase).origin;
    if (value.startsWith('/')) {
      return `${origin}${value}`;
    }
    return new URL(value, `${origin}/`).toString();
  }
  return value;
}

function normalizeManifestAssetUrls(manifest, apiBase) {
  const normalized = normalizeManifest(manifest);
  return {
    ...normalized,
    frames: normalized.frames.map((frame) => ({
      ...frame,
      thumbUrl: resolveAssetUrl(frame.thumbUrl, apiBase),
      cropUrl: resolveAssetUrl(frame.cropUrl, apiBase),
      rawUrl: resolveAssetUrl(frame.rawUrl, apiBase)
    })),
    derived: {
      ...normalized.derived,
      contactSheetUrl: resolveAssetUrl(normalized.derived.contactSheetUrl, apiBase),
      stripUrls: normalized.derived.stripUrls.map((url) => resolveAssetUrl(url, apiBase)),
      timelapseUrl: resolveAssetUrl(normalized.derived.timelapseUrl, apiBase)
    }
  };
}

async function safeFetchJson(path, { method = 'GET', payload } = {}) {
  const apiBase = getConfiguredApiBase();
  if (!apiBase) {
    return {
      ok: false,
      status: 0,
      errorKind: 'offline',
      data: null
    };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(joinApiUrl(apiBase, path), {
      method,
      headers: payload ? { 'content-type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        errorKind: toErrorKindFromStatus(response.status),
        data
      };
    }

    return {
      ok: true,
      status: response.status,
      errorKind: null,
      data
    };
  } catch (error) {
    const isAbort = error && typeof error === 'object' && error.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      errorKind: isAbort ? 'unavailable' : 'offline',
      data: null
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function safeMessage(payload, fallback) {
  if (payload && typeof payload === 'object' && typeof payload.message === 'string') {
    const trimmed = payload.message.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return fallback;
}

export async function fetchTmaydStatus() {
  if (!isApiConfigured()) {
    return {
      ok: true,
      mock: true,
      errorKind: null,
      data: MOCK_STATUS
    };
  }

  const result = await safeFetchJson('/api/tmayd/status');
  if (!result.ok) {
    return {
      ok: false,
      mock: true,
      errorKind: result.errorKind || 'unknown',
      data: {
        ...MOCK_STATUS,
        status: 'offline',
        message: 'TMAYD API unavailable. Showing offline preview.'
      }
    };
  }

  return {
    ok: true,
    mock: false,
    errorKind: null,
    data: normalizeStatus(result.data)
  };
}

export async function fetchLiveFrame() {
  if (!isApiConfigured()) {
    return {
      ok: true,
      mock: true,
      errorKind: null,
      data: MOCK_LIVE_FRAME
    };
  }

  const result = await safeFetchJson('/api/tmayd/live/latest');
  if (!result.ok) {
    return {
      ok: false,
      mock: true,
      errorKind: result.errorKind || 'unknown',
      data: {
        ...MOCK_LIVE_FRAME,
        status: 'offline',
        caption: 'TMAYD live frame unavailable. Showing offline preview.'
      }
    };
  }

  const apiBase = getConfiguredApiBase();
  const normalized = normalizeLiveFrame(result.data);
  return {
    ok: true,
    mock: false,
    errorKind: null,
    data: {
      ...normalized,
      imageUrl: resolveAssetUrl(normalized.imageUrl, apiBase)
    }
  };
}

export async function fetchTodayReel() {
  const today = new Date().toISOString().slice(0, 10);

  if (!isApiConfigured()) {
    return {
      ok: true,
      mock: true,
      errorKind: null,
      data: createMockManifest(today)
    };
  }

  const result = await safeFetchJson('/api/tmayd/reels/today');
  if (!result.ok) {
    return {
      ok: false,
      mock: true,
      errorKind: result.errorKind || 'unknown',
      data: createMockManifest(today)
    };
  }

  const apiBase = getConfiguredApiBase();
  return {
    ok: true,
    mock: false,
    errorKind: null,
    data: normalizeManifestAssetUrls(result.data, apiBase)
  };
}

export async function fetchReelByDate(date) {
  const safeDate = isValidArchiveDate(date) ? date : new Date().toISOString().slice(0, 10);

  if (!isApiConfigured()) {
    return {
      ok: true,
      mock: true,
      errorKind: null,
      data: createMockManifest(safeDate)
    };
  }

  const result = await safeFetchJson(`/api/tmayd/reels/${safeDate}`);
  if (!result.ok) {
    return {
      ok: false,
      mock: true,
      errorKind: result.errorKind || 'unknown',
      data: createMockManifest(safeDate)
    };
  }

  const apiBase = getConfiguredApiBase();
  return {
    ok: true,
    mock: false,
    errorKind: null,
    data: normalizeManifestAssetUrls(result.data, apiBase)
  };
}

export async function submitTmaydMessage({ text, consent, displayName } = {}) {
  const messageText = typeof text === 'string' ? text.trim() : '';

  if (!isApiConfigured()) {
    return {
      status: 'unavailable',
      message: 'The machine is not currently accepting messages.',
      errorKind: 'unavailable'
    };
  }

  const payload = {
    text: messageText,
    consent: Boolean(consent)
  };
  if (typeof displayName === 'string' && displayName.trim()) {
    payload.displayName = displayName.trim();
  }

  const result = await safeFetchJson('/api/tmayd/submissions', {
    method: 'POST',
    payload
  });

  const body = result.data && typeof result.data === 'object' ? result.data : {};

  if (!result.ok) {
    if (result.errorKind === 'rate_limited') {
      return {
        status: 'rate_limited',
        message: safeMessage(body, 'Too many submissions. Please try again later.'),
        errorKind: 'rate_limited'
      };
    }
    if (result.errorKind === 'bad_request') {
      return {
        status: 'rejected',
        kind: 'hard',
        message: safeMessage(body, 'This message cannot be accepted. Please submit a non-identifying reflection about your day.'),
        errorKind: 'bad_request'
      };
    }

    return {
      status: 'unavailable',
      message: safeMessage(body, 'The machine is temporarily not accepting messages. Please try again later.'),
      errorKind: result.errorKind || 'unknown'
    };
  }

  const status = typeof body.status === 'string' ? body.status : '';

  if (status === 'accepted') {
    return {
      status: 'accepted',
      publicCode: typeof body.publicCode === 'string' ? body.publicCode : '',
      message: safeMessage(body, 'Your message entered the print queue.')
    };
  }

  if (status === 'rejected') {
    const kind = body.kind === 'soft' ? 'soft' : 'hard';
    const fallback = kind === 'soft'
      ? 'This message includes identifying information. Please submit a non-identifying version.'
      : 'This message cannot be accepted. Please submit a non-identifying reflection about your day.';
    return {
      status: 'rejected',
      kind,
      message: safeMessage(body, fallback)
    };
  }

  if (status === 'soft_rejected') {
    return {
      status: 'rejected',
      kind: 'soft',
      message: safeMessage(body, 'This message includes identifying information. Please submit a non-identifying version.')
    };
  }

  if (status === 'hard_rejected') {
    return {
      status: 'rejected',
      kind: 'hard',
      message: safeMessage(body, 'This message cannot be accepted. Please submit a non-identifying reflection about your day.')
    };
  }

  if (status === 'rate_limited') {
    return {
      status: 'rate_limited',
      message: safeMessage(body, 'Too many submissions. Please try again later.')
    };
  }

  if (status === 'unavailable') {
    return {
      status: 'unavailable',
      message: safeMessage(body, 'The machine is temporarily not accepting messages. Please try again later.')
    };
  }

  return {
    status: 'unavailable',
    message: 'The machine is temporarily not accepting messages. Please try again later.',
    errorKind: 'unknown'
  };
}
