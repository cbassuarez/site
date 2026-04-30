import { normalizeLiveFrame, normalizeManifest, normalizeStatus } from './tmaydUtils';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function makeSvgDataUrl({ label, width = 640, height = 960 }) {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#f9f9f9" />
  <rect x="16" y="16" width="${Math.max(0, width - 32)}" height="${Math.max(0, height - 32)}" fill="none" stroke="#111" stroke-width="2" />
  <text x="${Math.floor(width / 2)}" y="${Math.floor(height / 2)}" text-anchor="middle" font-family="Courier New, monospace" font-size="24" fill="#111">${label}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function makeFrame(date, index) {
  const ordinal = String(index + 1).padStart(4, '0');
  const publicCode = `DAY-${date.replace(/-/g, '')}-${ordinal}`;
  const thumbUrl = makeSvgDataUrl({ label: `${publicCode} thumb`, width: 280, height: 420 });
  const cropUrl = makeSvgDataUrl({ label: publicCode, width: 800, height: 1200 });
  const rawUrl = makeSvgDataUrl({ label: `${publicCode} raw`, width: 1200, height: 1800 });

  return {
    publicCode,
    capturedAt: `${date}T${String(8 + index).padStart(2, '0')}:12:44Z`,
    thumbUrl,
    cropUrl,
    rawUrl,
    width: 1200,
    height: 1800
  };
}

export const MOCK_STATUS = normalizeStatus({
  status: 'inactive',
  intakeOpen: false,
  printingOpen: false,
  archiveOpen: true,
  lastHeartbeatAt: '',
  message: 'Mock/offline preview mode.'
});

export const MOCK_LIVE_FRAME = normalizeLiveFrame({
  status: 'inactive',
  imageUrl: '',
  observedAt: '',
  width: 0,
  height: 0,
  caption: 'No live frame in mock mode.'
});

export function createMockManifest(date = todayIsoDate()) {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayIsoDate();
  const frames = [0, 1, 2, 3].map((index) => makeFrame(safeDate, index));

  return normalizeManifest({
    date: safeDate,
    reelId: `R${safeDate.replace(/-/g, '')}-A`,
    status: 'open',
    generatedAt: new Date().toISOString(),
    frames,
    derived: {
      contactSheetUrl: makeSvgDataUrl({ label: `${safeDate} contact sheet`, width: 1400, height: 900 }),
      stripUrls: [
        makeSvgDataUrl({ label: `${safeDate} strip 0001`, width: 900, height: 2200 }),
        makeSvgDataUrl({ label: `${safeDate} strip 0002`, width: 900, height: 2200 })
      ],
      timelapseUrl: ''
    }
  });
}
