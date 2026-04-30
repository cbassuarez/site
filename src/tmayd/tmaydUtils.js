const STATUS_LABELS = {
  inactive: 'inactive',
  offline: 'offline',
  idle: 'idle',
  printing: 'printing',
  capturing: 'capturing',
  reset_required: 'reset required',
  maintenance: 'maintenance'
};

const SAFE_STATUSES = new Set(Object.keys(STATUS_LABELS));

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeString(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.trim();
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStatusValue(value, fallback = 'inactive') {
  const normalized = safeString(value).toLowerCase();
  return SAFE_STATUSES.has(normalized) ? normalized : fallback;
}

export function safeStatusLabel(status) {
  const normalized = normalizeStatusValue(status);
  return STATUS_LABELS[normalized] || STATUS_LABELS.inactive;
}

export function isValidArchiveDate(value) {
  if (typeof value !== 'string') {
    return false;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  const iso = parsed.toISOString().slice(0, 10);
  return iso === value;
}

export function formatTmaydDateTime(value) {
  const raw = safeString(value);
  if (!raw) {
    return 'unknown';
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short'
  }).format(parsed);
}

export function buildCacheBustedUrl(url, token) {
  const base = safeString(url);
  if (!base) {
    return '';
  }
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}cb=${encodeURIComponent(String(token || '0'))}`;
}

export function normalizeStatus(payload) {
  const source = isObject(payload) ? payload : {};
  return {
    status: normalizeStatusValue(source.status, 'inactive'),
    intakeOpen: Boolean(source.intakeOpen),
    printingOpen: Boolean(source.printingOpen),
    archiveOpen: Boolean(source.archiveOpen),
    lastHeartbeatAt: safeString(source.lastHeartbeatAt),
    message: safeString(source.message)
  };
}

export function normalizeLiveFrame(payload) {
  const source = isObject(payload) ? payload : {};
  return {
    status: normalizeStatusValue(source.status, 'inactive'),
    imageUrl: safeString(source.imageUrl),
    observedAt: safeString(source.observedAt),
    width: safeNumber(source.width, 0),
    height: safeNumber(source.height, 0),
    caption: safeString(source.caption)
  };
}

export function normalizeManifest(payload) {
  const source = isObject(payload) ? payload : {};
  const date = isValidArchiveDate(source.date) ? source.date : '';
  const frames = safeArray(source.frames).map((frame, index) => {
    const row = isObject(frame) ? frame : {};
    return {
      publicCode: safeString(row.publicCode, `DAY-UNKNOWN-${String(index + 1).padStart(4, '0')}`),
      capturedAt: safeString(row.capturedAt),
      thumbUrl: safeString(row.thumbUrl),
      cropUrl: safeString(row.cropUrl),
      rawUrl: safeString(row.rawUrl),
      width: safeNumber(row.width, 0),
      height: safeNumber(row.height, 0)
    };
  });

  const derived = isObject(source.derived) ? source.derived : {};

  return {
    date,
    reelId: safeString(source.reelId),
    status: safeString(source.status, 'open'),
    generatedAt: safeString(source.generatedAt),
    frames,
    derived: {
      contactSheetUrl: safeString(derived.contactSheetUrl),
      stripUrls: safeArray(derived.stripUrls).map((url) => safeString(url)).filter(Boolean),
      timelapseUrl: safeString(derived.timelapseUrl)
    }
  };
}
