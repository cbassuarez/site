import { useEffect, useMemo, useRef, useState } from 'react';
import TmaydLabsPage from './tmayd/TmaydLabsPage';

const SITE_DOMAIN = 'cbassuarez.com';
const OPERATOR_NAME = 'seb suarez';
const OPERATOR_IMAGE = '/seb-portrait.jpg';
const FEED_API_BASE = import.meta.env.VITE_FEED_API_BASE || 'https://seb-feed.cbassuarez.workers.dev';
const TURNSTILE_DEV_TEST_SITE_KEY = '1x00000000000000000000AA';
const TURNSTILE_SITE_KEY_BUILD = import.meta.env.VITE_TURNSTILE_SITE_KEY || (import.meta.env.DEV ? TURNSTILE_DEV_TEST_SITE_KEY : '');
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TURNSTILE_CONTACT_ACTION = 'contact_form_v1';
const CONTACT_EMAIL_REGEX = /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])$/i;
const UI_FONT_STACK = '"Times New Roman", Times, serif';
const MONO_FONT_STACK = '"Courier New", Courier, monospace';

const RAW_BUILD_SHA = String(import.meta.env.VITE_BUILD_SHA || '').trim();
const RAW_BUILD_AT = String(import.meta.env.VITE_BUILD_AT || '').trim();
const BUILD_REPO_URL = String(import.meta.env.VITE_BUILD_REPO_URL || '').replace(/\/+$/, '');
const BUILD_SHORT_SHA = RAW_BUILD_SHA ? RAW_BUILD_SHA.slice(0, 7) : 'dev';
const BUILD_DATE = /^\d{4}-\d{2}-\d{2}/.test(RAW_BUILD_AT) ? RAW_BUILD_AT.slice(0, 10) : '';
const BUILD_LABEL = BUILD_DATE ? `${BUILD_DATE} · ${BUILD_SHORT_SHA}` : BUILD_SHORT_SHA;
const BUILD_COMMIT_URL = RAW_BUILD_SHA && BUILD_REPO_URL ? `${BUILD_REPO_URL}/commit/${RAW_BUILD_SHA}` : '';

const SOCIAL_LINKS = [
  { label: 'github', url: 'https://github.com/cbassuarez' },
  { label: 'instagram', url: 'https://instagram.com/cbassuarez' },
  { label: 'spotify', url: 'https://open.spotify.com/artist/7HS6WVr7YFFl7Yf0fM7Y3W' },
  { label: 'bandcamp', url: 'https://cbassuarez.bandcamp.com' },
  { label: 'email', url: 'mailto:hello@cbassuarez.com' }
];

const WEBSAFE_LINK_COLORS = [
  '#0000CC',
  '#0033CC',
  '#006699',
  '#008080',
  '#009933',
  '#993300',
  '#CC0033',
  '#CC3300'
];
const VISITED_LINK_COLOR = '#551A8B';
const RANDOM_LABS_ROUTES = [
  '/labs/feed',
  '/labs/guestbook',
  '/labs/chunk-surfer',
  '/labs/string',
  '/room',
  '/labs/tell-me-about-your-day'
];

function pickRandomLabsRoute() {
  const index = Math.floor(Math.random() * RANDOM_LABS_ROUTES.length);
  return RANDOM_LABS_ROUTES[index] || '/labs';
}

function openRandomLabsRoute(event) {
  event.preventDefault();
  window.location.href = pickRandomLabsRoute();
}
function pickWebsafeLinkColor() {
  const index = Math.floor(Math.random() * WEBSAFE_LINK_COLORS.length);
  return WEBSAFE_LINK_COLORS[index] || '#0000CC';
}

function hexToRgb(hex) {
  const value = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-f]{6}$/i.test(value)) {
    return { r: 255, g: 255, b: 153 };
  }

  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function mixRgb(a, b, amount) {
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t)
  };
}

function rgbToCss({ r, g, b }) {
  return `rgb(${r}, ${g}, ${b})`;
}

function highlightFromLinkColor(linkColor) {
  const source = hexToRgb(linkColor);
  const paper = { r: 255, g: 255, b: 204 };
  return rgbToCss(mixRgb(source, paper, 0.72));
}

const OBLIQUE_STRATEGIES = [
  'Use an old idea.',
  'Honor thy error as a hidden intention.',
  'Try faking it.',
  'Emphasize differences.',
  'Repetition is a form of change.',
  'What would your closest friend do?',
  'Work at a different speed.',
  'Listen to the quiet voice.',
  'Is there something missing?',
  'Do the last thing first.'
];
const OBLIQUE_ATTRIBUTION = 'Brian Eno + Peter Schmidt, Oblique Strategies';

let turnstileScriptPromise = null;
function loadTurnstileScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('turnstile unavailable'));
  }
  if (window.turnstile?.render) {
    return Promise.resolve(window.turnstile);
  }
  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const scriptId = 'cf-turnstile-explicit';
    const existing = document.getElementById(scriptId);

    const onLoad = () => {
      if (window.turnstile?.render) resolve(window.turnstile);
      else reject(new Error('turnstile failed to initialize'));
    };
    const onError = () => reject(new Error('turnstile script failed to load'));

    if (existing) {
      if (window.turnstile?.render) {
        resolve(window.turnstile);
        return;
      }
      existing.addEventListener('load', onLoad, { once: true });
      existing.addEventListener('error', onError, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

function wireIframeTopNavigation(frame) {
  if (!frame) return;
  try {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) return;

    const upgradeLinks = () => {
      const links = doc.querySelectorAll('a[href]');
      links.forEach((link) => {
        const href = String(link.getAttribute('href') || '').trim();
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
        link.setAttribute('target', '_top');
      });
    };

    upgradeLinks();

    if (frame.__labsLinkObserver) {
      frame.__labsLinkObserver.disconnect();
      frame.__labsLinkObserver = null;
    }
    const observer = new MutationObserver(() => upgradeLinks());
    observer.observe(doc.documentElement || doc.body, { childList: true, subtree: true });
    frame.__labsLinkObserver = observer;
  } catch (_) {
    // Non-same-origin or inaccessible frame: no-op.
  }
}

function sourceBase(source) {
  return String(source || 'feed').toLowerCase().split(':')[0] || 'feed';
}

function formatAgeLabel(msAgo) {
  const age = Number(msAgo);
  if (!Number.isFinite(age) || age < 0) return 'just now';
  const minutes = Math.floor(age / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function selectCurrentActivityClient(feedItems, nowMs = Date.now()) {
  const ordered = [...feedItems]
    .filter((item) => item && item.text)
    .sort((a, b) => b.at - a.at);

  if (ordered.length === 0) return null;

  const isRecent = (item, windowMs = 10 * 60 * 1000) => Number.isFinite(item?.at) && nowMs - item.at <= windowMs;
  const build = (item, isLive) => ({
    source: item.source || 'feed',
    text: item.text || '',
    at: item.at || nowMs,
    url: item.url || '',
    isLive,
    ageLabel: isLive ? 'live now' : formatAgeLabel(nowMs - Number(item.at || nowMs))
  });

  const latestSpotify = ordered.find((item) => sourceBase(item.source) === 'spotify');
  if (latestSpotify?.isPlaying) return build(latestSpotify, true);

  const instagramLive = ordered.find((item) => sourceBase(item.source) === 'instagram' && isRecent(item));
  if (instagramLive) return build(instagramLive, true);

  const githubLive = ordered.find((item) => sourceBase(item.source) === 'github' && isRecent(item));
  if (githubLive) return build(githubLive, true);

  const bandcampLive = ordered.find((item) => sourceBase(item.source) === 'bandcamp' && isRecent(item));
  if (bandcampLive) return build(bandcampLive, true);

  return build(ordered[0], false);
}

function composeCurrentActivityLine(activity) {
  if (!activity?.text) return 'waiting for seb feed...';
  const prefix = activity.isLive ? 'now' : 'recent';
  const source = String(activity.source || 'feed');
  const ageSuffix = activity.isLive ? '' : ` (${activity.ageLabel || 'recent'})`;
  return `${prefix}: ${source} - ${activity.text}${ageSuffix}`;
}

function stamp(dateInput = Date.now()) {
  const now = new Date(dateInput);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  return `${hh}:${mm}:${ss}`;
}

function parseDateOrNow(value) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return Date.now();
  }

  return parsed.getTime();
}

function mergeAndSortFeed(items, maxItems = 16) {
  const sorted = [...items]
    .filter((item) => item && item.text)
    .sort((a, b) => b.at - a.at);

  if (typeof maxItems === 'number' && Number.isFinite(maxItems) && maxItems > 0) {
    return sorted.slice(0, maxItems);
  }

  return sorted;
}

function pickSourceDiverseItems(items, { total = 12, perSourceCap = 4 } = {}) {
  const selected = [];
  const perSourceCounts = new Map();

  for (const item of items) {
    if (selected.length >= total) break;
    const source = String(item?.source || 'feed');
    const current = perSourceCounts.get(source) || 0;
    if (current >= perSourceCap) continue;
    selected.push(item);
    perSourceCounts.set(source, current + 1);
  }

  if (selected.length >= total) {
    return selected;
  }

  for (const item of items) {
    if (selected.length >= total) break;
    if (selected.includes(item)) continue;
    selected.push(item);
  }

  return selected;
}

async function fetchCombinedSebFeed({ limit = 24, maxItems = 16 } = {}) {
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 24));
  const endpoint = `${FEED_API_BASE}/api/feed?limit=${safeLimit}`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    throw new Error(`feed api failed (${response.status})`);
  }

  const payload = await response.json();
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const sources = payload?.sources && typeof payload.sources === 'object' ? payload.sources : {};
  const rawCurrentActivity = payload?.currentActivity && typeof payload.currentActivity === 'object'
    ? payload.currentActivity
    : null;

  const successful = rawItems.map((item) => ({
    source: item.source || 'feed',
    text: item.text || '',
    at: parseDateOrNow(item.at),
    url: item.url || '',
    media: item.media || '',
    progressMs: Number.isFinite(item.progressMs) ? item.progressMs : 0,
    durationMs: Number.isFinite(item.durationMs) ? item.durationMs : 0,
    isPlaying: Boolean(item.isPlaying)
  }));

  const failedCount = Object.values(sources).filter((status) => status?.status !== 'ok').length;
  const currentActivity = rawCurrentActivity
    ? {
        source: rawCurrentActivity.source || 'feed',
        text: rawCurrentActivity.text || '',
        at: parseDateOrNow(rawCurrentActivity.at),
        url: rawCurrentActivity.url || '',
        isLive: Boolean(rawCurrentActivity.isLive),
        ageLabel: rawCurrentActivity.ageLabel || ''
      }
    : null;

  return {
    items: mergeAndSortFeed(successful, maxItems),
    failedCount,
    sources,
    currentActivity
  };
}

function useTruthfulHitCounter() {
  const [hits, setHits] = useState('loading...');

  useEffect(() => {
    const updateGlobalHits = async () => {
      try {
        const response = await fetch(`${FEED_API_BASE}/api/hit`);

        if (!response.ok) {
          throw new Error('hit endpoint failed');
        }

        const data = await response.json();

        if (!Number.isFinite(data.value)) {
          throw new Error('invalid hit payload');
        }

        setHits(String(data.value));
      } catch (error) {
        setHits('unavailable');
      }
    };

    updateGlobalHits();
  }, []);

  return hits;
}

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = (event) => setIsMobile(event.matches);

    setIsMobile(media.matches);
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }

    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, [breakpoint]);

  return isMobile;
}

async function fetchGuestbookEntries(limit) {
  const hasLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0;
  const endpoint = hasLimit
    ? `${FEED_API_BASE}/api/guestbook?limit=${Math.floor(limit)}`
    : `${FEED_API_BASE}/api/guestbook`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`guestbook api failed (${response.status})`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload?.entries) ? payload.entries : [];

  return rows
    .map((entry) => ({
      name: String(entry?.name || 'anonymous').trim() || 'anonymous',
      message: String(entry?.message || '').trim(),
      at: parseDateOrNow(entry?.at)
    }))
    .filter((entry) => entry.message.length > 0);
}

async function createGuestbookEntry({ name, message }) {
  const response = await fetch(`${FEED_API_BASE}/api/guestbook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, message })
  });

  if (response.status === 409) {
    const err = new Error('already_signed');
    err.code = 'already_signed';
    throw err;
  }

  if (!response.ok) {
    throw new Error(`guestbook write failed (${response.status})`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload?.entries) ? payload.entries : [];

  return rows
    .map((entry) => ({
      name: String(entry?.name || 'anonymous').trim() || 'anonymous',
      message: String(entry?.message || '').trim(),
      at: parseDateOrNow(entry?.at)
    }))
    .filter((entry) => entry.message.length > 0);
}

function spotifyTrackIdFromItem(item) {
  if (!item) {
    return '';
  }

  const media = String(item.media || '');
  if (media.startsWith('spotify:track:')) {
    return media.split(':').pop() || '';
  }

  const url = String(item.url || '');
  const match = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
  return match ? match[1] : '';
}

function formatMs(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function useSebFeed({ apiLimit = 24, maxItems = 16 } = {}) {
  const [feedItems, setFeedItems] = useState([]);
  const [feedMeta, setFeedMeta] = useState('syncing');
  const [feedSources, setFeedSources] = useState({});
  const [isBooting, setIsBooting] = useState(true);
  const [currentActivity, setCurrentActivity] = useState(null);

  useEffect(() => {
    let active = true;

    const sync = async () => {
      setFeedMeta('syncing');

      try {
        const result = await fetchCombinedSebFeed({ limit: apiLimit, maxItems });

        if (!active) {
          return;
        }

        if (result.items.length === 0) {
          setFeedMeta('no live entries found');
          setIsBooting(false);
          return;
        }

        setFeedItems(result.items);
        setFeedSources(result.sources || {});
        setCurrentActivity(result.currentActivity || null);
        setIsBooting(false);

        if (result.failedCount > 0) {
          setFeedMeta(`partial sync (${result.failedCount} source${result.failedCount > 1 ? 's' : ''} failed)`);
        } else {
          setFeedMeta('live');
        }
      } catch (error) {
        if (active) {
          setFeedMeta('feed sync failed');
          setIsBooting(false);
        }
      }
    };

    sync();

    const intervalId = window.setInterval(sync, 120000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [apiLimit, maxItems]);

  return {
    feedItems,
    feedMeta,
    feedSources,
    isBooting,
    currentActivity
  };
}

function renderInlineMarkdown(text, keyPrefix = 'md') {
  const value = String(text || '');
  const parts = [];
  const linkPattern = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let lastIndex = 0;
  let match = null;

  while ((match = linkPattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push(value.slice(lastIndex, match.index));
    }
    const label = String(match[1] || '').trim() || String(match[2] || '');
    const href = String(match[2] || '').trim();
    const external = /^https?:\/\//i.test(href);
    parts.push(
      <a
        key={`${keyPrefix}-link-${match.index}`}
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer' : undefined}
      >
        {label}
      </a>
    );
    lastIndex = linkPattern.lastIndex;
  }

  if (lastIndex < value.length) {
    parts.push(value.slice(lastIndex));
  }

  return parts;
}

function renderMarkdownBlocks(markdown) {
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let paragraphLines = [];
  let listItems = [];
  let blockIndex = 0;

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const text = paragraphLines.join(' ').trim();
    if (text) {
      blocks.push(
        <p key={`md-p-${blockIndex++}`}>
          {renderInlineMarkdown(text, `md-p-${blockIndex}`)}
        </p>
      );
    }
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems;
    blocks.push(
      <ul key={`md-ul-${blockIndex++}`}>
        {items.map((item, i) => (
          <li key={`md-li-${blockIndex}-${i}`}>
            {renderInlineMarkdown(item, `md-li-${blockIndex}-${i}`)}
          </li>
        ))}
      </ul>
    );
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith('### ')) {
      flushParagraph();
      flushList();
      blocks.push(
        <h3 key={`md-h3-${blockIndex++}`}>
          {renderInlineMarkdown(line.slice(4), `md-h3-${blockIndex}`)}
        </h3>
      );
      continue;
    }

    if (line.startsWith('## ')) {
      flushParagraph();
      flushList();
      blocks.push(
        <h2 key={`md-h2-${blockIndex++}`}>
          {renderInlineMarkdown(line.slice(3), `md-h2-${blockIndex}`)}
        </h2>
      );
      continue;
    }

    if (line.startsWith('# ')) {
      flushParagraph();
      flushList();
      blocks.push(
        <h1 key={`md-h1-${blockIndex++}`}>
          {renderInlineMarkdown(line.slice(2), `md-h1-${blockIndex}`)}
        </h1>
      );
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      listItems.push(line.replace(/^[-*]\s+/, ''));
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function MarkdownRoutePage({ title, subtitle, sourcePath }) {
  const [status, setStatus] = useState('loading');
  const [markdown, setMarkdown] = useState('');

  useEffect(() => {
    let active = true;

    const load = async () => {
      setStatus('loading');
      try {
        const response = await fetch(sourcePath, { cache: 'no-store' });
        if (!response.ok) throw new Error(`failed (${response.status})`);
        const text = await response.text();
        if (!active) return;
        setMarkdown(text);
        setStatus('ready');
      } catch (_) {
        if (!active) return;
        setMarkdown('');
        setStatus('error');
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [sourcePath]);

  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>{subtitle}</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/recent">recent</a> ] [ <a href="/labs">labs</a> ] [ <a href="/about">about</a> ] [ <a href="/press">press</a> ] [ <a href="/contact">contact</a> ]
        </p>
      </center>

      <hr />

      <h2>{title}</h2>

      {status === 'loading' ? (
        <p><i>loading…</i></p>
      ) : status === 'error' ? (
        <p>
          unable to load content. [ <a href={sourcePath}>open markdown source</a> ]
        </p>
      ) : (
        renderMarkdownBlocks(markdown)
      )}

      <hr />

      <p>
        <small>edit source: <a href={sourcePath}>{sourcePath}</a></small>
      </p>
    </>
  );
}

function RecentWorksPage() {
  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>recent</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/recent">recent</a> ] [ <a href="/labs">labs</a> ] [ <a href="/about">about</a> ] [ <a href="/press">press</a> ] [ <a href="/contact">contact</a> ]
        </p>
      </center>

      <hr />

      <h2>Recent Works</h2>
      <p>
        updated: May 1, 2026.
      </p>
      <p>
        not a full archive and not a blog; this page is a hand-curated status surface for what is most active and most important now.
      </p>

      <table border="1" cellPadding="6" width="100%">
        <thead>
          <tr>
            <th align="left">work</th>
            <th align="left">state</th>
            <th align="left">entry point</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>let go / letting go</td>
            <td>Premiered; the performance film is now in the cutting room.</td>
            <td>
              [ <a href="/labs/works-list">labs works list</a> ] [ <a href="https://www.youtube.com/watch?v=fV3o2fRln8A" target="_blank" rel="noreferrer">video</a> ]
            </td>
          </tr>
          <tr>
            <td>THE TUB</td>
            <td>Premiered; back in the shop and preparing for CalArts Expo.</td>
            <td>
              [ <a href="/dma-2026">dma recap</a> ]
            </td>
          </tr>
          <tr>
            <td>Praetorius update</td>
            <td>v0.3 next: completed Builder (CLI-in-web), full skin reskin, expanded themes, CDN-centered runtime, YouTube support, and Clean Mode for PDFs.</td>
            <td>
              [ <a href="/labs/works-list">labs works list</a> ] [ <a href="https://www.npmjs.com/package/praetorius" target="_blank" rel="noreferrer">npm</a> ] [ <a href="https://github.com/cbassuarez/praetorius" target="_blank" rel="noreferrer">github</a> ]
            </td>
          </tr>
          <tr>
            <td>organum quadrupum 'lux nova'</td>
            <td>Premiered at the Roy O. Disney Theatre at CalArts (October 2025).</td>
            <td>
              [ <a href="/works">works archive</a> ]
            </td>
          </tr>
        </tbody>
      </table>

      <h3>Where To Enter First</h3>
      <ul>
        <li>
          start with [ <a href="/labs/works-list">labs works list</a> ] for the quickest representative route through listening + score context.
        </li>
        <li>
          move to [ <a href="/works">works archive</a> ] for deeper score/media coverage across the full catalog.
        </li>
        <li>
          use [ <a href="/dma-2026">concerning human understanding (dma recap)</a> ] for project-level framing and references.
        </li>
        <li>
          step into [ <a href="/labs/string">string</a> ] for the live multi-visitor instrument layer.
        </li>
      </ul>
    </>
  );
}

function LabsDirectoryPage() {
  return (
    <MarkdownRoutePage
      title="Labs Directory"
      subtitle="labs"
      sourcePath="/content/labs.md"
    />
  );
}

function AboutPage() {
  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>about</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/press">press</a> ]
        </p>
      </center>

      <hr />

      <h2>Seb Suarez</h2>
      <p>
        <img src={OPERATOR_IMAGE} alt="Seb Suarez portrait" width="360" />
      </p>
      <p>
        Composer-performer and visual artist based in Los Angeles, working across albums, installation,
        and research.
      </p>
      <p>
        Current focus: prepared-piano resonances and spatial/industrial light as instrument.
      </p>
      <p>
        Upcoming: <strong>Rings/Resonators</strong> and <strong>25HUNDRED</strong>.
      </p>
      <p>Available for commissions, installations, performances, and talks.</p>

      <hr />

      <h3>Contact</h3>
      <p>
        Email: <a href="mailto:contact@cbassuarez.com">contact@cbassuarez.com</a>
      </p>
      <p>
        Press: <a href="/press">open press page</a>
        <br />
        CV: <a href="/press/suarez-solis_sebastian_cv_may2026.pdf" target="_blank" rel="noreferrer" download>download PDF</a> (last updated May 1, 2026)
      </p>

      <hr />

      <h3>Selected Highlights</h3>
      <ul>
        <li>2023–2025: CalArts HASOM Dean’s Discretionary Fund — 3× $2,000</li>
        <li>2024: Google Ad Grants (in-kind) — $120,000/yr (Dex DSL)</li>
        <li>2024: Donors (Zeffy) — $3,000 for 33 Strings + in-kind support</li>
        <li>2023: Peabody LAUNCH Grant — $5,000 (Dex DSL)</li>
        <li>2022: Common Tone New Music Festival — Fellowship ($750)</li>
      </ul>

      <h3>Teaching & Service</h3>
      <ul>
        <li>2025: HASOM Project Week — guest lecture (large-format works)</li>
        <li>2023: CalArts AiR Week — host and finale presenter</li>
        <li>2024–2025: Ethical Investment Committee, CalArts</li>
      </ul>

      <hr />

      <p>
        Quick links: [ <a href="/works">works</a> ] [ <a href="/press">press</a> ] [ <a href="/">home</a> ]
      </p>
    </>
  );
}

function PressPage() {
  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>press</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/recent">recent</a> ] [ <a href="/about">about</a> ] [ <a href="/press">press</a> ] [ <a href="/contact">contact</a> ]
        </p>
      </center>

      <hr />

      <h2>Press</h2>
      <p>
        Updated: May 1, 2026.
      </p>
      <p>
        Sebastian Suarez-Solis (b. 1999) is a Caracas-born Venezuelan-American sonic and visual artist.
      </p>
      <p>
        pronouns: they/them.
      </p>

      <h3>Short Bio (Press-Ready)</h3>
      <p>
        Sebastian Suarez-Solis (b. 1999) is a Caracas-born Venezuelan-American sonic and visual artist whose work ranges from musical composition to visual pieces, installations, performances, happenings, and artist-built cybernetic systems. Their dialectic output is rooted in the ablation of established performance practice, introducing spontaneity, irreverence, and profane action wherever possible, as in the prepared harpsichord solo Seven Sounds for Strings. Recent cybernetic projects include let go / letting go, THE TUB, String, and Praetorius.
      </p>

      <h3>Long Bio (Press-Ready)</h3>
      <p>
        Sebastian Suarez-Solis (b. 1999) is a sonic and visual artist whose works range from musical compositions to visual pieces, installations, performances, and happenings. A Caracas-born Venezuelan-American artist, their dialectic output is derived from the ablation of established performance practice, injecting elements of spontaneity, irreverence, and profane action into their works wherever possible.
      </p>
      <p>
        Their practice moves across many formats, including scrolling cell-score/video-game music tapestries, concert works, sonic sculpture, painting, MaxMSP patches, video installation, and extensive noise-set performance. As a performer, they have recently worked with drum set, amplified bass viola da gamba, prepared guitar, harpsichord (prepared and otherwise), and laptop, with an emphasis on free improvisation, Fluxus performance, low-fidelity amplification, and cybernetic approaches to live system behavior. Current projects include let go / letting go, THE TUB, String, and Praetorius.
      </p>
      <p>
        Sebastian completed their master's degree in music composition at the Peabody Institute of The Johns Hopkins University, where they studied under Sky Macklay, Oscar Bettison, Michael Hersch, and Felipe Lara. They have recently worked with Parker Quartet, Mivos Quartet, Ensemble Dal Niente, Alexandre Ribeiro, Trio Immersio, Estrella Consort, and TORCH Collective, among others. They are a co-founder of Dex Digital Sample Library, an online open-access collection of Creative Commons commissioned recordings.
      </p>

      <h3>Downloads</h3>
      <ul>
        <li>
          CV (PDF, last updated May 1, 2026): <a href="/press/suarez-solis_sebastian_cv_may2026.pdf" target="_blank" rel="noreferrer" download>download</a>
        </li>
        <li>
          Headshot (JPG): <a href="/press/seb-suarez-headshot.jpg" target="_blank" rel="noreferrer" download>download</a>
        </li>
        <li>
          Short bio (TXT): <a href="/press/seb-suarez-short-bio.txt" target="_blank" rel="noreferrer" download>download</a>
        </li>
        <li>
          Long bio (TXT): <a href="/press/seb-suarez-long-bio.txt" target="_blank" rel="noreferrer" download>download</a>
        </li>
      </ul>

      <h3>Selected Current Projects</h3>
      <ul>
        <li>
          let go / letting go: premiered; performance film in post-production. [ <a href="/labs/works-list">entry</a> ] [ <a href="https://www.youtube.com/watch?v=fV3o2fRln8A" target="_blank" rel="noreferrer">video</a> ]
        </li>
        <li>
          THE TUB: premiered; currently being prepared for CalArts Expo. [ <a href="/dma-2026">context</a> ]
        </li>
        <li>
          Praetorius: artist-built publication infrastructure (v0.3 in progress). [ <a href="https://www.npmjs.com/package/praetorius" target="_blank" rel="noreferrer">npm</a> ] [ <a href="https://github.com/cbassuarez/praetorius" target="_blank" rel="noreferrer">github</a> ]
        </li>
        <li>
          organum quadrupum 'lux nova': premiered at Roy O. Disney Theatre at CalArts (October 2025). [ <a href="/works">works archive</a> ]
        </li>
      </ul>

      <h3>Press Contact</h3>
      <p>
        email: <a href="mailto:contact@cbassuarez.com">contact@cbassuarez.com</a>
      </p>
      <p>
        For interviews, features, commissioning inquiries, performances, and exhibition context packets.
      </p>
    </>
  );
}

function WorksPage() {
  const isMobile = useIsMobile();

  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>works</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ]
        </p>
      </center>

      <hr />

      <iframe
        title="Praetorius Works"
        src="/works-console/index.html?nostyle=1&headless=1"
        style={{ width: '100%', height: isMobile ? '64vh' : '78vh', border: 0, display: 'block' }}
      />
      {isMobile ? (
        <p>
          <small>
            mobile fallback: [ <a href="/works-console/index.html?nostyle=1&headless=1">open works console directly</a> ]
          </small>
        </p>
      ) : null}
    </>
  );
}

function LabsWorksListPage() {
  return (
    <iframe
      title="Praetorius Labs Works List"
      src="/labs/works-list/index.html"
      onLoad={(event) => wireIframeTopNavigation(event.currentTarget)}
      style={{ width: '100%', height: '100vh', border: 0, display: 'block' }}
    />
  );
}

function StringLabPage() {
  const isMobile = useIsMobile();

  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>string</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ]
        </p>
      </center>

      <hr />

      <iframe
        title="String Lab"
        src="/labs/string/index.html?v=20260501ws2"
        onLoad={(event) => wireIframeTopNavigation(event.currentTarget)}
        style={{ width: '100%', height: isMobile ? '64vh' : '78vh', border: 0, display: 'block' }}
      />
      {isMobile ? (
        <p>
          <small>
            mobile fallback: [ <a href="/labs/string/index.html?v=20260501ws2">open string directly</a> ]
          </small>
        </p>
      ) : null}
    </>
  );
}

function ReplLabPage() {
  const isMobile = useIsMobile();

  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>repl</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/labs">labs</a> ] [ <a href="/labs/string">string</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ]
        </p>
      </center>

      <hr />

      <iframe
        title="cbassuarez REPL"
        src="/labs/repl/index.html?v=20260503r5"
        onLoad={(event) => wireIframeTopNavigation(event.currentTarget)}
        style={{ width: '100%', height: isMobile ? '72vh' : '82vh', border: 0, display: 'block' }}
      />
      {isMobile ? (
        <p>
          <small>
            mobile fallback: [ <a href="/labs/repl/index.html?v=20260503r5">open repl directly</a> ]
          </small>
        </p>
      ) : null}
    </>
  );
}

function ChunkSurferLabPage() {
  const isMobile = useIsMobile();

  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>labs / chunk surfer</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ]
        </p>
      </center>

      <hr />

      <iframe
        title="Chunk Surfer Lab"
        src="/labs/chunk-surfer/index.html"
        onLoad={(event) => wireIframeTopNavigation(event.currentTarget)}
        style={{ width: '100%', height: isMobile ? '64vh' : '78vh', border: 0, display: 'block' }}
      />
      {isMobile ? (
        <p>
          <small>
            mobile fallback: [ <a href="/labs/chunk-surfer/index.html">open chunk surfer directly</a> ]
          </small>
        </p>
      ) : null}
    </>
  );
}

function SiteLeftPane() {
  const hits = useTruthfulHitCounter();

  return (
    <>
      <h3>navigation</h3>
      <ul>
        <li>
          <a href="/about">about</a>
        </li>
        <li>
          <a href="/press">press</a>
        </li>
        <li>
          <a href="/contact">contact</a>
        </li>
        <li>
          <a href="/works">works</a>
        </li>
        <li>
          <a href="/recent">recent</a>
        </li>
        <li>
          <a href="/labs">labs</a>
        </li>
      </ul>

      <h3>labs</h3>
        <ul>
          <li>
            <a href="/labs/feed">seb feed</a>
          </li>
          <li>
            <a href="/labs/guestbook">guestbook</a>
          </li>
          <li>
            <a href="/labs/chunk-surfer">chunk surfer</a>
          </li>
          <li>
            <a href="/labs/string">string</a>
          </li>
          <li>
            <a href="/room">anteroom</a> <small>(usually closed)</small>
          </li>
        </ul>

      <h3>operator</h3>
      <p>
        <img src={OPERATOR_IMAGE} alt="Seb Suarez" width="180" />
      </p>
      <p>{OPERATOR_NAME}</p>
      <p>page views (last 52 weeks): {hits}</p>

      <h3>social</h3>
      <ul>
        {SOCIAL_LINKS.map((link) => (
          <li key={link.label}>
            <a href={link.url} target={link.url.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

function SplitPaneLayout({ children, naturalHeight = false }) {
  const obliqueLine = useMemo(() => {
    const index = Math.floor(Math.random() * OBLIQUE_STRATEGIES.length);
    return OBLIQUE_STRATEGIES[index] || 'Use an old idea.';
  }, []);
  const paneHeight = '72vh';

  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>cybernetic artist homepage</i>
        </p>
        <p>
          <small>
            <q>{obliqueLine}</q>
            <br />
            <i>{OBLIQUE_ATTRIBUTION}</i>
          </small>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/recent">recent</a> ] [ <a href="/labs">labs</a> ] [ <a href="/about">about</a> ] [ <a href="/press">press</a> ] [ <a href="/contact">contact</a> ]
        </p>
      </center>

      <hr />

      <table border="1" cellPadding="8" width="100%" style={{ tableLayout: 'fixed' }}>
        <tbody>
          <tr>
            <td width="30%" valign="top" style={{ width: '30%' }}>
              <div
  className="shell-left-pane"
  style={naturalHeight ? { minHeight: paneHeight } : { height: paneHeight, overflowY: 'auto' }}
>
  <SiteLeftPane />
</div>
            </td>
            <td width="70%" valign="top" style={{ width: '70%' }}>
              <div
  className="shell-right-pane"
  style={naturalHeight ? { minHeight: paneHeight } : { height: paneHeight, overflowY: 'auto' }}
>
  {children}
</div>
            </td>
          </tr>
        </tbody>
      </table>
      <style>{`
        .shell-left-pane > :first-child { margin-top: 0; }
        .shell-right-pane > :first-child { margin-top: 0; }
        .shell-right-pane > center:first-child { display: none; }
        .shell-right-pane > hr:first-of-type { display: none; }
      `}</style>
    </>
  );
}

function GlobalFooter() {
  return (
    <>
      <hr />
      <center>
        <small>
          {SOCIAL_LINKS.map((link, index) => (
            <span key={link.label}>
              {index > 0 ? ' [ ' : '[ '}
              <a href={link.url} target={link.url.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
                {link.label}
              </a>{' '}
              ]
            </span>
          ))}{' '}
          [ <a href="/works">works</a> ] [ <a href="/recent">recent</a> ] [ <a href="/labs">labs</a> ] [ <a href="/about">about</a> ] [ <a href="/press">press</a> ] [ <a href="/contact">contact</a> ] [ labs: <a href="/labs/feed">seb feed</a> / <a href="/labs/guestbook">guestbook</a> / <a href="/labs/chunk-surfer">chunk surfer</a> / <a href="/labs/string">string</a> / <a href="/labs/repl">repl</a> ] [ <a href="/colophon">colophon</a> ] [ <a href="/access">access</a> ]
        </small>
      </center>
    </>
  );
}

function SiteVersion() {
  const labelStyle = { color: '#666', fontSize: '0.78em', display: 'block', padding: '6px 8px 10px' };
  return (
    <center>
      <small style={labelStyle}>
        build ·{' '}
        {BUILD_COMMIT_URL ? (
          <a href={BUILD_COMMIT_URL} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
            {BUILD_LABEL}
          </a>
        ) : (
          BUILD_LABEL
        )}
      </small>
    </center>
  );
}

function HomePage({ shellMode = false }) {
  const HOME_GUESTBOOK_LIMIT = 40;
  const isMobile = useIsMobile();
  const hits = useTruthfulHitCounter();
  const { feedItems, feedMeta, feedSources, isBooting, currentActivity } = useSebFeed();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [guestbook, setGuestbook] = useState([]);
  const [guestbookStatus, setGuestbookStatus] = useState('loading');
  const [bootDotCount, setBootDotCount] = useState(1);
  const obliqueLine = useMemo(() => {
    const index = Math.floor(Math.random() * OBLIQUE_STRATEGIES.length);
    return OBLIQUE_STRATEGIES[index] || 'Use an old idea.';
  }, []);

  useEffect(() => {
    let active = true;

    const loadGuestbook = async () => {
      setGuestbookStatus('loading');

      try {
        const entries = await fetchGuestbookEntries(HOME_GUESTBOOK_LIMIT);
        if (!active) return;
        setGuestbook(entries);
        setGuestbookStatus('ready');
      } catch (error) {
        if (!active) return;
        setGuestbook([]);
        setGuestbookStatus('offline');
      }
    };

    loadGuestbook();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isBooting) return;

    const intervalId = window.setInterval(() => {
      setBootDotCount((count) => (count % 3) + 1);
    }, 450);

    return () => window.clearInterval(intervalId);
  }, [isBooting]);

  const bootDots = '.'.repeat(bootDotCount);
  const [marqueeStableText, setMarqueeStableText] = useState('waiting for seb feed...');
  const [marqueeStableKey, setMarqueeStableKey] = useState('');
  const mobileStatusText = isBooting ? `syncing feed${bootDots}` : marqueeStableText;

  const marqueeText = useMemo(() => {
    if (isBooting) {
      return `boot: syncing seb feed${bootDots} /// boot: fetching sources${bootDots} /// boot: compiling timeline${bootDots}`;
    }
    return marqueeStableText;
  }, [isBooting, bootDots, marqueeStableText]);

  useEffect(() => {
    if (isBooting) return;

    const fallbackActivity = selectCurrentActivityClient(feedItems, Date.now());
    const activity = currentActivity || fallbackActivity;
    const activityKey = activity
      ? `${activity.source || 'feed'}|${activity.text || ''}|${activity.at || ''}`
      : 'none';

    if (activityKey !== marqueeStableKey) {
      setMarqueeStableKey(activityKey);
      setMarqueeStableText(composeCurrentActivityLine(activity));
    }
  }, [isBooting, currentActivity, feedItems, marqueeStableKey]);

  const spotifyNow = useMemo(
    () => feedItems.find((item) => String(item.source || '').toLowerCase() === 'spotify') || null,
    [feedItems]
  );
  const spotifyTrackId = spotifyTrackIdFromItem(spotifyNow);
  const [spotifyLocalProgressMs, setSpotifyLocalProgressMs] = useState(0);
  const homeFeedPreview = useMemo(
    () => pickSourceDiverseItems(feedItems, { total: 12, perSourceCap: 3 }),
    [feedItems]
  );

  useEffect(() => {
    setSpotifyLocalProgressMs(Number(spotifyNow?.progressMs) || 0);
  }, [spotifyNow?.url, spotifyNow?.at, spotifyNow?.progressMs]);

  useEffect(() => {
    if (!spotifyNow?.isPlaying) return;

    const intervalId = window.setInterval(() => {
      setSpotifyLocalProgressMs((current) => {
        const next = current + 1000;
        const max = Number(spotifyNow?.durationMs) || 0;
        return max > 0 ? Math.min(next, max) : next;
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [spotifyNow?.isPlaying, spotifyNow?.durationMs, spotifyNow?.url, spotifyNow?.at]);

  const submitGuestbook = async (event) => {
    event.preventDefault();

    const cleanName = name.trim() || 'anonymous';
    const cleanMessage = message.trim();

    if (!cleanMessage) {
      return;
    }

    try {
      setGuestbookStatus('saving');
      await createGuestbookEntry({ name: cleanName, message: cleanMessage });
      const entries = await fetchGuestbookEntries(HOME_GUESTBOOK_LIMIT);
      setGuestbook(entries);
      setName('');
      setMessage('');
      setGuestbookStatus('ready');
    } catch (error) {
      if (error?.code === 'already_signed') {
        setGuestbookStatus('duplicate');
      } else {
        setGuestbookStatus('offline');
      }
    }
  };

  if (shellMode) {
    return (
      <>
        <marquee behavior="scroll" direction="left" scrollAmount="2" scrollDelay="30" style={{ fontFamily: MONO_FONT_STACK }}>
          {marqueeText}
        </marquee>

        <a id="about" />
        <h2>about</h2>
        <p>
          I build cybernetic work: connected pieces that listen, relay, adapt, and evolve in real time.
        </p>
        <p>
          I also create tools: <a href="https://cbassuarez.github.io/praetorius" target="_blank" rel="noreferrer">Praetorius</a>, <a href="https://tenneyapp.com" target="_blank" rel="noreferrer">Tenney</a>, and <a href="https://synctimerapp.com" target="_blank" rel="noreferrer">SyncTimer</a>.
        </p>
<left>
  <p>
    <small>
      <tt>─────────────────────────────────────────────</tt>
    </small>
  </p>
</left>

        <p>
        visit <a href="/works">works</a> to explore pieces; <a href="/contact">contact</a> for commissions, performances, and collaborations; </p>
        
        <p>
                or let the site choose a random{' '}
<a href="/labs" onClick={openRandomLabsRoute}>labs page</a> (experimental pieces and methods of interacting with my work).
        </p>
        
        <h2>what is seb doing // live feed</h2>
        <div style={{ minHeight: '21em', fontFamily: MONO_FONT_STACK }}>
          {isBooting ? (
            <p>
              <i>syncing feed{bootDots}</i>
            </p>
          ) : (
            <ul>
              {homeFeedPreview.map((item, index) => (
                <li key={`${item.source}-${item.at}-${index}`}>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      [{stamp(item.at)}] {item.source}
                    </a>
                  ) : (
                    <span>[{stamp(item.at)}] {item.source}</span>
                  )}{' '}
                  - {item.text}
                </li>
              ))}
            </ul>
          )}
          {spotifyNow && spotifyTrackId ? (
            <>
              <h3 style={{ fontFamily: UI_FONT_STACK }}>listen with seb</h3>
              <p>
                <small>
                  {spotifyNow.text}
                </small>
              </p>
              <p>
                <a href={spotifyNow.url || `https://open.spotify.com/track/${spotifyTrackId}`} target="_blank" rel="noreferrer">
                  open in spotify
                </a>
              </p>
              {Number(spotifyNow?.durationMs) > 0 ? (
                <p>
                  <small>
                    playhead: {formatMs(spotifyLocalProgressMs)} / {formatMs(spotifyNow.durationMs)}
                    {spotifyNow?.isPlaying ? '' : ' (paused)'}
                  </small>
                </p>
              ) : null}
            </>
          ) : null}
          <p>
            <small>
              feed sync: {feedMeta}
              <br />
              sources:{' '}
              {Object.keys(feedSources).length > 0
                ? Object.entries(feedSources)
                    .map(([name, status]) => `${name}:${status?.status || 'unknown'}`)
                    .join(' | ')
                : 'worker feed (pending)'}
            </small>
          </p>
        </div>

        <a id="guestbook" />
        <h2>guestbook.exe [NEW]</h2>
        <form onSubmit={submitGuestbook}>
          <p>
            name:{' '}
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              size="24"
            />
          </p>
          <p>
            message:{' '}
            <input
              type="text"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              size="48"
            />
          </p>
          <p>
            <button type="submit">sign guestbook</button>
          </p>
          {guestbookStatus === 'duplicate' ? (
            <p><small>you&apos;ve already signed the guestbook.</small></p>
          ) : null}
        </form>

        <table border="1" cellPadding="6" width="100%" style={{ fontFamily: MONO_FONT_STACK }}>
          <tbody>
            {guestbook.length === 0 ? (
              <tr>
                <td width="24%">system</td>
                <td>
                  {guestbookStatus === 'loading' || guestbookStatus === 'saving'
                    ? 'loading entries...'
                    : 'new feature: be the first to sign.'}
                </td>
              </tr>
            ) : null}
            {guestbook.map((entry, index) => (
              <tr key={`${entry.name}-${entry.message}-${index}`}>
                <td width="24%">{entry.name}</td>
                <td>{entry.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }

  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>cybernetic artist homepage</i>
        </p>
        <p>
          <small>
            <q>{obliqueLine}</q>
            <br />
            <i>{OBLIQUE_ATTRIBUTION}</i>
          </small>
        </p>
      </center>

      <hr />

      {isMobile ? (
        <p>
          <small style={{ fontFamily: MONO_FONT_STACK }}>{mobileStatusText}</small>
        </p>
      ) : (
        <marquee behavior="scroll" direction="left" scrollAmount="2" scrollDelay="30" style={{ fontFamily: MONO_FONT_STACK }}>
          {marqueeText}
        </marquee>
      )}

      {isMobile ? (
        <>
          <h3>navigation</h3>
          <p>
            [ <a href="/about">about</a> ] [ <a href="/press">press</a> ] [ <a href="/works">works</a> ] [ <a href="/recent">recent</a> ] [ <a href="/labs">labs</a> ]
          </p>
          <h3>labs</h3>
          <p>
          [ <a href="/labs/feed">seb feed</a> ] [ <a href="/labs/guestbook">guestbook</a> ] [ <a href="/labs/chunk-surfer">chunk surfer</a> ] [ <a href="/labs/string">string</a> ] [ <a href="/room">anteroom</a> <small>(usually closed)</small> ]
        </p>

          <h3>operator</h3>
          <p>
            <img src={OPERATOR_IMAGE} alt="Seb Suarez" width="140" />
          </p>
          <p>{OPERATOR_NAME}</p>
          <p>page views (last 52 weeks): {hits}</p>

          <h3>about</h3>
          <p>
            I build cybernetic work: connected pieces that listen, relay, adapt, and evolve in real time.
          </p>
          <p>
            currently building live cybernetic works. visit <a href="/works">works</a> to explore pieces, or <a href="/contact">contact</a> for commissions, performances, and collaborations.
          </p>
          <p>
            I also create tools: <a href="https://github.com/cbassuarez/praetorius" target="_blank" rel="noreferrer">Praetorius</a>, <a href="https://github.com/stagedevices/Tenney" target="_blank" rel="noreferrer">Tenney</a>, and <a href="https://github.com/cbassuarez/SyncTimer" target="_blank" rel="noreferrer">SyncTimer</a>.
          </p>

          <h3>what is seb doing // live feed</h3>
          <div style={{ fontFamily: MONO_FONT_STACK }}>
            {isBooting ? (
              <p>
                <i>syncing feed{bootDots}</i>
              </p>
            ) : (
              <ul>
                {homeFeedPreview.slice(0, 8).map((item, index) => (
                  <li key={`${item.source}-${item.at}-${index}`}>
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer">
                        [{stamp(item.at)}] {item.source}
                      </a>
                    ) : (
                      <span>[{stamp(item.at)}] {item.source}</span>
                    )}{' '}
                    - {item.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p>
            [ <a href="/labs/feed">open full seb feed</a> ]
          </p>

          <h3>guestbook.exe [NEW]</h3>
          <form onSubmit={submitGuestbook}>
            <p>
              name:{' '}
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                size="16"
              />
            </p>
            <p>
              message:{' '}
              <input
                type="text"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                size="28"
              />
            </p>
            <p>
              <button type="submit">sign guestbook</button>
            </p>
            {guestbookStatus === 'duplicate' ? (
              <p><small>you&apos;ve already signed the guestbook.</small></p>
            ) : null}
          </form>

          <table border="1" cellPadding="6" width="100%" style={{ fontFamily: MONO_FONT_STACK }}>
            <tbody>
              {guestbook.length === 0 ? (
                <tr>
                  <td>system</td>
                  <td>
                    {guestbookStatus === 'loading' || guestbookStatus === 'saving'
                      ? 'loading entries...'
                      : 'new feature: be the first to sign.'}
                  </td>
                </tr>
              ) : null}
              {guestbook.slice(0, 8).map((entry, index) => (
                <tr key={`${entry.name}-${entry.message}-${index}`}>
                  <td>{entry.name}</td>
                  <td>{entry.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            [ <a href="/labs/guestbook">open full guestbook</a> ]
          </p>

          <h3>social</h3>
          <ul>
            {SOCIAL_LINKS.map((link) => (
              <li key={link.label}>
                <a href={link.url} target={link.url.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <table border="1" cellPadding="8" width="100%">
          <tbody>
            <tr>
              <td width="30%" valign="top">
                <h3>navigation</h3>
              <ul>
                <li>
                  <a href="/about">about</a>
                </li>
                <li>
                  <a href="/press">press</a>
                </li>
                <li>
                  <a href="/contact">contact</a>
                </li>
                <li>
                    <a href="/works">works</a>
                  </li>
                <li>
                  <a href="/recent">recent</a>
                </li>
                <li>
                  <a href="/labs">labs</a>
                </li>
                </ul>
                <h3>labs</h3>
                <ul>
                  <li>
                    <a href="/labs/feed">seb feed</a>
                  </li>
                  <li>
                    <a href="/labs/guestbook">guestbook</a>
                  </li>
                  <li>
                    <a href="/labs/chunk-surfer">chunk surfer</a>
                  </li>
                  <li>
                    <a href="/labs/string">string</a>
                  </li>
                  <li>
                    <a href="/room">anteroom</a> <small>(usually closed)</small>
                  </li>
                </ul>

                <h3>operator</h3>
                <p>
                  <img src={OPERATOR_IMAGE} alt="Seb Suarez" width="180" />
                </p>
                <p>{OPERATOR_NAME}</p>
                <p>page views (last 52 weeks): {hits}</p>

                <h3>social</h3>
                <ul>
                  {SOCIAL_LINKS.map((link) => (
                    <li key={link.label}>
                      <a href={link.url} target={link.url.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </td>

              <td valign="top">
                <a id="about" />
                <h2>about</h2>
                <p>
                  I build cybernetic work: connected pieces that listen, relay, adapt, and evolve in real
                  time.
                </p>
                <p>
                  currently building live cybernetic works. visit <a href="/works">works</a> to explore pieces, or <a href="/contact">contact</a> for commissions, performances, and collaborations.
                </p>
                <p>
                  press page: [ <a href="/press">open</a> ] | cv: [ <a href="/press/suarez-solis_sebastian_cv_may2026.pdf" target="_blank" rel="noreferrer" download>download PDF</a> ]
                </p>
                <p>
                  I also create tools: <a href="https://github.com/cbassuarez/praetorius" target="_blank" rel="noreferrer">Praetorius</a>, <a href="https://github.com/stagedevices/Tenney" target="_blank" rel="noreferrer">Tenney</a>, and <a href="https://github.com/cbassuarez/SyncTimer" target="_blank" rel="noreferrer">SyncTimer</a>.
                </p>

                <h2>what is seb doing // live feed</h2>
                <div style={{ minHeight: '21em', fontFamily: MONO_FONT_STACK }}>
                  {isBooting ? (
                    <p>
                      <i>syncing feed{bootDots}</i>
                    </p>
                  ) : (
                    <ul>
                      {homeFeedPreview.map((item, index) => (
                        <li key={`${item.source}-${item.at}-${index}`}>
                          {item.url ? (
                            <a href={item.url} target="_blank" rel="noreferrer">
                              [{stamp(item.at)}] {item.source}
                            </a>
                          ) : (
                            <span>[{stamp(item.at)}] {item.source}</span>
                          )}{' '}
                          - {item.text}
                        </li>
                      ))}
                    </ul>
                  )}
                  {spotifyNow && spotifyTrackId ? (
                    <>
                      <h3 style={{ fontFamily: UI_FONT_STACK }}>listen with seb</h3>
                      <p>
                        <small>
                          {spotifyNow.text}
                        </small>
                      </p>
                      <p>
                        <a href={spotifyNow.url || `https://open.spotify.com/track/${spotifyTrackId}`} target="_blank" rel="noreferrer">
                          open in spotify
                        </a>
                      </p>
                      {Number(spotifyNow?.durationMs) > 0 ? (
                        <p>
                          <small>
                            playhead: {formatMs(spotifyLocalProgressMs)} / {formatMs(spotifyNow.durationMs)}
                            {spotifyNow?.isPlaying ? '' : ' (paused)'}
                          </small>
                        </p>
                      ) : null}
                    </>
                  ) : null}
                  <p>
                    <small>
                      feed sync: {feedMeta}
                      <br />
                      sources:{' '}
                      {Object.keys(feedSources).length > 0
                        ? Object.entries(feedSources)
                            .map(([name, status]) => `${name}:${status?.status || 'unknown'}`)
                            .join(' | ')
                        : 'worker feed (pending)'}
                    </small>
                  </p>
                </div>

                <a id="guestbook" />
                <h2>guestbook.exe [NEW]</h2>
                <form onSubmit={submitGuestbook}>
                  <p>
                    name:{' '}
                    <input
                      type="text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      size="24"
                    />
                  </p>
                  <p>
                    message:{' '}
                    <input
                      type="text"
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      size="48"
                    />
                  </p>
                  <p>
                    <button type="submit">sign guestbook</button>
                  </p>
                  {guestbookStatus === 'duplicate' ? (
                    <p><small>you&apos;ve already signed the guestbook.</small></p>
                  ) : null}
                </form>

                <table border="1" cellPadding="6" width="100%" style={{ fontFamily: MONO_FONT_STACK }}>
                  <tbody>
                    {guestbook.length === 0 ? (
                      <tr>
                        <td width="24%">system</td>
                        <td>
                          {guestbookStatus === 'loading' || guestbookStatus === 'saving'
                            ? 'loading entries...'
                            : 'new feature: be the first to sign.'}
                        </td>
                      </tr>
                    ) : null}
                    {guestbook.map((entry, index) => (
                      <tr key={`${entry.name}-${entry.message}-${index}`}>
                        <td width="24%">{entry.name}</td>
                        <td>{entry.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      )}

    </>
  );
}

function FeedPage() {
  const isMobile = useIsMobile();
  const { feedItems, feedMeta, feedSources, isBooting, currentActivity } = useSebFeed({ apiLimit: 200, maxItems: null });
  const [bootDotCount, setBootDotCount] = useState(1);

  useEffect(() => {
    if (!isBooting) return;

    const intervalId = window.setInterval(() => {
      setBootDotCount((count) => (count % 3) + 1);
    }, 450);

    return () => window.clearInterval(intervalId);
  }, [isBooting]);

  const bootDots = '.'.repeat(bootDotCount);
  const feedStatusLine = useMemo(() => {
    if (isBooting) return `syncing feed${bootDots}`;
    const fallbackActivity = selectCurrentActivityClient(feedItems, Date.now());
    return composeCurrentActivityLine(currentActivity || fallbackActivity);
  }, [isBooting, bootDots, currentActivity, feedItems]);

  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>what is seb doing // live feed</i>
        </p>
        <p>
          {isMobile ? (
            <>[ <a href="/">home</a> ] [ <a href="/labs/feed">seb feed</a> ] [ <a href="/labs/guestbook">guestbook</a> ]</>
          ) : (
            <>[ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ] [ <a href="/labs/feed">seb feed</a> ] [ <a href="/labs/guestbook">guestbook</a> ]</>
          )}
        </p>
      </center>

      <hr />

      {isMobile ? (
        <p style={{ fontFamily: MONO_FONT_STACK }}>
          <small>{feedStatusLine}</small>
        </p>
      ) : null}

      <p>
        <b>live timeline</b> (newest first)
      </p>

      <div style={{ fontFamily: MONO_FONT_STACK }}>
        {isBooting ? (
          <p>
            <i>syncing feed{bootDots}</i>
          </p>
        ) : (
          <ul>
            {feedItems.map((item, index) => (
              <li key={`${item.source}-${item.at}-${index}`}>
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer">
                    [{stamp(item.at)}] {item.source}
                  </a>
                ) : (
                  <span>[{stamp(item.at)}] {item.source}</span>
                )}{' '}
                - {item.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p>
        <small>
          feed sync: {feedMeta}
          <br />
          sources:{' '}
          {Object.keys(feedSources).length > 0
            ? Object.entries(feedSources)
                .map(([name, status]) => `${name}:${status?.status || 'unknown'}`)
                .join(' | ')
            : 'worker feed (pending)'}
        </small>
      </p>
    </>
  );
}

function GuestbookPage() {
  const isMobile = useIsMobile();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [guestbook, setGuestbook] = useState([]);
  const [guestbookStatus, setGuestbookStatus] = useState('loading');

  useEffect(() => {
    let active = true;

    const loadGuestbook = async () => {
      setGuestbookStatus('loading');
      try {
        const entries = await fetchGuestbookEntries();
        if (!active) return;
        setGuestbook(entries);
        setGuestbookStatus('ready');
      } catch (error) {
        if (!active) return;
        setGuestbook([]);
        setGuestbookStatus('offline');
      }
    };

    loadGuestbook();

    return () => {
      active = false;
    };
  }, []);

  const submitGuestbook = async (event) => {
    event.preventDefault();
    const cleanName = name.trim() || 'anonymous';
    const cleanMessage = message.trim();
    if (!cleanMessage) return;

    try {
      setGuestbookStatus('saving');
      await createGuestbookEntry({ name: cleanName, message: cleanMessage });
      const entries = await fetchGuestbookEntries();
      setGuestbook(entries);
      setName('');
      setMessage('');
      setGuestbookStatus('ready');
    } catch (error) {
      if (error?.code === 'already_signed') {
        setGuestbookStatus('duplicate');
      } else {
        setGuestbookStatus('offline');
      }
    }
  };

  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>guestbook.exe [NEW] // full history</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/labs/feed">seb feed</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ] [ <a href="/labs/guestbook">guestbook</a> ]
        </p>
      </center>

      <hr />

      <form onSubmit={submitGuestbook}>
        <p>
          name:{' '}
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} size={isMobile ? '16' : '24'} />
        </p>
        <p>
          message:{' '}
          <input type="text" value={message} onChange={(event) => setMessage(event.target.value)} size={isMobile ? '30' : '60'} />
        </p>
        <p>
          <button type="submit">sign guestbook</button>
        </p>
        {guestbookStatus === 'duplicate' ? (
          <p><small>you&apos;ve already signed the guestbook.</small></p>
        ) : null}
      </form>

      <table border="1" cellPadding="6" width="100%" style={{ fontFamily: MONO_FONT_STACK }}>
        <tbody>
          {guestbook.length === 0 ? (
            <tr>
              <td width={isMobile ? undefined : '24%'}>system</td>
              <td>
                {guestbookStatus === 'loading' || guestbookStatus === 'saving'
                  ? 'loading entries...'
                  : 'new feature: be the first to sign.'}
              </td>
            </tr>
          ) : null}
          {guestbook.map((entry, index) => (
            <tr key={`${entry.name}-${entry.message}-${index}`}>
              <td width={isMobile ? undefined : '24%'}>{entry.name}</td>
              <td>{entry.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ContactPage() {
  const sentFromQuery = new URLSearchParams(window.location.search).get('sent') === '1';
  const sentFromPath = /^\/contact\/sent\/?$/i.test(window.location.pathname);
  const hasRecentLocalRelay = () => {
    try {
      const raw = window.sessionStorage.getItem('contact:last_relay_at');
      if (!raw) return false;
      const atMs = Date.parse(raw);
      if (!Number.isFinite(atMs)) return false;
      return (Date.now() - atMs) < (30 * 60 * 1000);
    } catch (_) {
      return false;
    }
  };
  const localSystemTime = useMemo(
    () => new Date().toLocaleTimeString('en-US', { hour12: false, timeZoneName: 'short' }),
    []
  );
  const [resolvedTurnstileSiteKey, setResolvedTurnstileSiteKey] = useState(() => TURNSTILE_SITE_KEY_BUILD || '');
  const [siteKeyStatus, setSiteKeyStatus] = useState(() => (TURNSTILE_SITE_KEY_BUILD ? 'ready' : 'loading'));
  const turnstileEnabled = Boolean(resolvedTurnstileSiteKey);
  const [submitState, setSubmitState] = useState((sentFromQuery || sentFromPath) && hasRecentLocalRelay() ? 'sent' : 'idle');
  const [submitError, setSubmitError] = useState('');
  const [submitNote, setSubmitNote] = useState('');
  const [turnstileStatus, setTurnstileStatus] = useState('idle');
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileHostRef = useRef(null);
  const turnstileWidgetIdRef = useRef(null);
  const [formValues, setFormValues] = useState({
    name: '',
    email: '',
    subject: '',
    topic: 'commission',
    timeSensitive: false,
    message: '',
    gotcha: ''
  });

  function updateField(field, value) {
    setFormValues((current) => ({ ...current, [field]: value }));
  }

  useEffect(() => {
    if ((sentFromPath || sentFromQuery) && !hasRecentLocalRelay()) {
      window.history.replaceState({}, '', '/contact');
    }
  }, [sentFromPath, sentFromQuery]);

  useEffect(() => {
    if (TURNSTILE_SITE_KEY_BUILD) {
      setResolvedTurnstileSiteKey(TURNSTILE_SITE_KEY_BUILD);
      setSiteKeyStatus('ready');
      return;
    }

    let cancelled = false;
    setSiteKeyStatus('loading');

    const loadSiteKey = async () => {
      try {
        const response = await fetch(`${FEED_API_BASE}/api/contact-config`, { headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error(`contact-config failed (${response.status})`);
        const payload = await response.json();
        const siteKey = String(payload?.turnstileSiteKey || '').trim();
        if (cancelled) return;
        if (siteKey) {
          setResolvedTurnstileSiteKey(siteKey);
          setSiteKeyStatus('ready');
        } else {
          setResolvedTurnstileSiteKey('');
          setSiteKeyStatus('missing');
        }
      } catch (_) {
        if (cancelled) return;
        setResolvedTurnstileSiteKey('');
        setSiteKeyStatus('missing');
      }
    };

    loadSiteKey();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!turnstileEnabled || submitState === 'sent') return undefined;
    const host = turnstileHostRef.current;
    if (!host) return undefined;

    let cancelled = false;
    setTurnstileStatus('loading');
    setTurnstileToken('');

    const boot = async () => {
      try {
        const turnstile = await loadTurnstileScript();
        if (cancelled) return;

        host.innerHTML = '';
        turnstileWidgetIdRef.current = turnstile.render(host, {
          sitekey: resolvedTurnstileSiteKey,
          theme: 'light',
          action: TURNSTILE_CONTACT_ACTION,
          callback: (token) => {
            setTurnstileToken(String(token || ''));
            setTurnstileStatus('verified');
          },
          'expired-callback': () => {
            setTurnstileToken('');
            setTurnstileStatus('expired');
          },
          'error-callback': () => {
            setTurnstileToken('');
            setTurnstileStatus('error');
          }
        });
        setTurnstileStatus('idle');
      } catch (_) {
        if (cancelled) return;
        setTurnstileStatus('error');
      }
    };

    boot();

    return () => {
      cancelled = true;
      const turnstile = window.turnstile;
      const widgetId = turnstileWidgetIdRef.current;
      if (turnstile && widgetId !== null && widgetId !== undefined) {
        try {
          turnstile.remove(widgetId);
        } catch (_) {
          // Ignore widget teardown errors.
        }
      }
      turnstileWidgetIdRef.current = null;
    };
  }, [resolvedTurnstileSiteKey, submitState, turnstileEnabled]);

  function resetTurnstile() {
    setTurnstileToken('');
    const turnstile = window.turnstile;
    const widgetId = turnstileWidgetIdRef.current;
    if (turnstile && widgetId !== null && widgetId !== undefined) {
      try {
        turnstile.reset(widgetId);
      } catch (_) {
        // Ignore reset errors; user can refresh if needed.
      }
    }
    setTurnstileStatus('idle');
  }

  function isValidEmailAddress(value) {
    const email = String(value || '').trim();
    if (!CONTACT_EMAIL_REGEX.test(email)) return false;
    const lowered = email.toLowerCase();
    const local = lowered.split('@')[0] || '';
    const domain = lowered.split('@')[1] || '';
    // Heuristic anti-placeholder checks (not a deliverability guarantee).
    const blockedLocalParts = new Set(['a', 'aa', 'test', 'testing', 'asdf', 'qwerty', 'user', 'admin', 'none', 'na', 'n/a']);
    const blockedDomains = new Set(['example.com', 'test.com', 'localhost', 'mailinator.com', 'tempmail.com', 'fake.com']);
    if (blockedLocalParts.has(local)) return false;
    if (blockedDomains.has(domain)) return false;
    if (domain.startsWith('example.') || domain.startsWith('test.')) return false;
    return true;
  }

  async function submitContactForm(event) {
    event.preventDefault();
    event.stopPropagation();
    if (submitState === 'sending' || submitState === 'sent') return;

    setSubmitError('');
    setSubmitNote('');

    if (formValues.gotcha.trim()) {
      setSubmitState('sent');
      return;
    }

    if (!turnstileEnabled) {
      setSubmitState('error');
      setSubmitError(siteKeyStatus === 'loading'
        ? 'human verification is still loading. please wait a moment and retry.'
        : 'human verification is unavailable. please try again shortly.');
      return;
    }

    if (!turnstileToken) {
      setSubmitState('error');
      setSubmitError('please complete the cloudflare human check before sending.');
      return;
    }

    const name = formValues.name.trim();
    const email = formValues.email.trim();
    const subject = formValues.subject.trim();
    const message = formValues.message.trim();

    if (!name || !email || !subject || !message) {
      setSubmitState('error');
      setSubmitError('missing required field(s). please complete name, email, subject, and message.');
      return;
    }

    if (!isValidEmailAddress(email)) {
      setSubmitState('error');
      setSubmitError('please enter a valid, reachable email address (for example: name@domain.com).');
      return;
    }

    setSubmitState('sending');

    try {
      const response = await fetch(`${FEED_API_BASE}/api/contact`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify({
          name,
          email,
          subject,
          topic: formValues.topic,
          time_sensitive: formValues.timeSensitive ? 'yes' : 'no',
          message,
          gotcha: formValues.gotcha,
          turnstileToken
        })
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch (_) {
        payload = null;
      }

      if (!response.ok) {
        let detail = '';
        let deliveryDetail = '';
        let badHostname = '';
        detail = String(payload?.error || '');
        deliveryDetail = String(payload?.detail || '');
        badHostname = String(payload?.hostname || '');
        if (detail === 'turnstile_bad_hostname') {
          throw new Error(badHostname ? `bad_hostname:${badHostname}` : 'bad_hostname');
        }
        if (detail === 'turnstile_bad_action' || detail === 'turnstile_failed' || response.status === 403) {
          throw new Error('verification_failed');
        }
        if (response.status === 503 || detail === 'turnstile_unconfigured') {
          throw new Error('verification_unavailable');
        }
        if (detail === 'invalid_email') {
          throw new Error('invalid_email');
        }
        if (detail === 'contact_delivery_failed') {
          throw new Error(deliveryDetail ? `mail_relay_failed:${deliveryDetail}` : 'mail_relay_failed');
        }
        throw new Error(`contact submit failed (${response.status})`);
      }

      const relayed = Boolean(payload?.relayed);
      if (!relayed) {
        throw new Error('contact_not_relayed');
      }
      const messageId = String(payload?.messageId || '').trim();
      setSubmitNote(messageId ? `relayed to destination mailbox (id: ${messageId}).` : 'relayed to destination mailbox.');
      try {
        window.sessionStorage.setItem('contact:last_relay_at', String(payload?.at || new Date().toISOString()));
      } catch (_) {
        // Non-blocking local marker.
      }

      setSubmitState('sent');
      setFormValues({
        name: '',
        email: '',
        subject: '',
        topic: 'commission',
        timeSensitive: false,
        message: '',
        gotcha: ''
      });
      window.history.replaceState({}, '', '/contact/sent');
    } catch (error) {
      setSubmitState('error');
      if (error instanceof Error && error.message === 'verification_failed') {
        setSubmitError('cloudflare verification failed or expired. please retry the human check and send again.');
      } else if (error instanceof Error && error.message.startsWith('bad_hostname')) {
        const observed = error.message.includes(':') ? error.message.split(':').slice(1).join(':') : '';
        setSubmitError(`verification hostname mismatch${observed ? ` (${observed})` : ''}. add this hostname to the turnstile widget and TURNSTILE_ALLOWED_HOSTNAMES.`);
      } else if (error instanceof Error && error.message === 'verification_unavailable') {
        setSubmitError('cloudflare verification is temporarily unavailable. please retry in a moment.');
      } else if (error instanceof Error && error.message === 'invalid_email') {
        setSubmitError('email address was rejected. please use a full address like name@domain.com.');
      } else if (error instanceof Error && error.message.startsWith('mail_relay_')) {
        const raw = error.message.split(':').slice(1).join(':').trim();
        setSubmitError(raw ? `delivery failed: ${raw}` : 'delivery failed. please retry.');
      } else if (error instanceof Error && error.message === 'contact_not_relayed') {
        setSubmitError('message was not relayed. nothing was delivered. please retry.');
      } else {
        setSubmitError('transmission failed. refresh the human check and retry, or email contact@cbassuarez.com directly.');
      }
      resetTurnstile();
    }
  }

  const sent = submitState === 'sent';

  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>contact seb</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ]
        </p>
      </center>

      <hr />

      {sent ? (
        <>
          <p>
            <b>message relayed. signal locked.</b>
          </p>
          {submitNote ? (
            <p>
              <small>{submitNote}</small>
            </p>
          ) : null}
          <p>
            [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/labs/feed">seb feed</a> ]
          </p>
        </>
      ) : (
        <>
          <p>writes back within 24-72 hours.</p>
          <form onSubmit={submitContactForm} noValidate>
            <input
              type="text"
              name="_gotcha"
              tabIndex="-1"
              autoComplete="off"
              value={formValues.gotcha}
              onChange={(event) => updateField('gotcha', event.target.value)}
              style={{ display: 'none' }}
            />
            <p>
              name:{' '}
              <input
                type="text"
                name="name"
                size="24"
                value={formValues.name}
                onChange={(event) => updateField('name', event.target.value)}
                required
              />
            </p>
            <p>
              email:{' '}
              <input
                type="email"
                name="email"
                size="28"
                value={formValues.email}
                onChange={(event) => updateField('email', event.target.value)}
                autoComplete="email"
                required
              />
            </p>
            <p>
              subject:{' '}
              <input
                type="text"
                name="subject"
                size="36"
                value={formValues.subject}
                onChange={(event) => updateField('subject', event.target.value)}
                required
              />
            </p>
            <p>
              topic:{' '}
              <select
                name="topic"
                value={formValues.topic}
                onChange={(event) => updateField('topic', event.target.value)}
              >
                <option value="commission">commission</option>
                <option value="performance">performance</option>
                <option value="collab">collab</option>
                <option value="press">press</option>
                <option value="other">other</option>
              </select>
            </p>
            <p>
              <label>
                <input
                  type="checkbox"
                  name="time_sensitive"
                  checked={formValues.timeSensitive}
                  onChange={(event) => updateField('timeSensitive', event.target.checked)}
                /> this is time-sensitive
              </label>
            </p>
            <p>
              message:
              <br />
              <textarea
                name="message"
                rows="8"
                cols="56"
                value={formValues.message}
                onChange={(event) => updateField('message', event.target.value)}
                required
              />
            </p>
            <p>
              cloudflare human check:
              <br />
              {turnstileEnabled ? (
                <span ref={turnstileHostRef} />
              ) : siteKeyStatus === 'loading' ? (
                <small>loading verification key...</small>
              ) : (
                <small>verification unavailable (missing site key)</small>
              )}
              {turnstileEnabled && turnstileStatus === 'loading' ? (
                <>
                  <br />
                  <small>loading verification widget...</small>
                </>
              ) : null}
              {turnstileEnabled && turnstileStatus === 'error' ? (
                <>
                  <br />
                  <small>verification widget failed to load. disable blockers and retry.</small>
                </>
              ) : null}
            </p>
            {submitState === 'error' && submitError ? (
              <p>
                <small>{submitError}</small>
              </p>
            ) : null}
            <p>
              <button type="submit" disabled={submitState === 'sending' || !turnstileEnabled || !turnstileToken}>
                {submitState === 'sending' ? 'sending...' : 'send transmission'}
              </button>
            </p>
          </form>
        </>
      )}

      <hr />

      <p>
        <small>local system time: {localSystemTime}</small>
      </p>
    </>
  );
}

function TalkRecapPage() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => document.head.removeChild(meta);
  }, []);

  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>dma — april 2026</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ]
        </p>
      </center>

      <hr />

      <h2>Concerning Human Understanding</h2>
      <p>
        <i>The Case for a Radical Constructivist Approach in Music and Aesthetic Theory</i>
      </p>
      <p>
        Sebastian Suarez-Solis
        <br />
        Advisors: Tim Feeney · Andrew Grueschow · Volker Straebel
        <br />
        California Institute of the Arts · DMA · October 2025
      </p>
      <p>
        Talk delivered April 2026 at CalArts. This page collects the materials,
        references, and works named during the talk for attendees who would like
        to revisit them.
      </p>

      <hr />

      <h2>Epigraph</h2>
      <blockquote>
        <p>
          "We have come to believe that the old hierarchies of power can be
          replaced by self-organising networks ... Today we dream of systems
          that can balance and stabilise themselves without the intervention of
          authoritarian power. But in reality, this is the dream of the machines."
        </p>
        <p>
          — Adam Curtis, <i>All Watched Over By Machines of Loving Grace</i> (BBC, 2011)
        </p>
      </blockquote>

      <h3>Selected quotations</h3>
      <blockquote>
        <p>
          A wholly objective cybernetic assessment of art and artmaking is not
          necessarily pertinent to cybernetics nor artmaking.
        </p>
      </blockquote>
      <blockquote>
        <p>
          To reference an artwork is already to subjectivize it.
        </p>
      </blockquote>
      <p>
        Keywords pursued throughout the paper: second-order cybernetics, eigenform,
        immanence, self-organisation, cybernetic art, radical constructivism.
      </p>

      <hr />

      <h2>Five projects</h2>

      <h3>1. Concerning Human Understanding (paper)</h3>
      <p>
        Theoretical and historical framework for second-order cybernetics in
        artistic research, drawing on Margaret Mead, Ernst von Glasersfeld,
        Ranulph Glanville, and P. R. Masani, with case studies of Schöffer's
        <i> CYSP 1</i> (1956), Kac and Nakamura's <i>Essay Concerning Human
        Understanding</i> (1994), and a survey of work by Olafur Eliasson. The
        paper argues for a constructivist cybernetics of art that takes the
        observer's position as constitutive of the artistic event. A practicum,
        <i> CONSTRUCTIONS</i> (2025), is incorporated as the author's own
        contemporary case study.
      </p>

      <h3>2. LetGo — confessional cinema, directed live</h3>
      <p>
        Premiered at the California Institute of the Arts on Wednesday,
        22 April 2026. A conducted, confessional cinema system pairing a single
        projector surface with a field of NFC-identified audience phones. Two
        principal visual streams: Super 8 drive-by footage of California power
        infrastructure, and redacted-face footage of speaking subjects. Held
        alongside the work: James Benning's durational landscape film and Agnès
        Varda's <i>The Gleaners and I</i> (2000).
      </p>

      <h3>3. THE TUB</h3>
      <p>
        A Swift harness with a sampler-oriented audio engine and manifest-backed
        routing across banks, instruments, chords, motifs, and spatial patterns.
        The mode engine refuses synthetic test-tone fallback: real audio input
        is required for the system to enter its operating mode at all.
        Maintenance, failure, and environmental conditions are framed as
        cybernetic participants in the work.
      </p>

      <h3>4. Praetorius</h3>
      <p>
        An artist-made tool for publishing score-centric works. Features include
        PDF page-follow synchronized to media time, a works-set authoring wizard,
        a paste-able Squarespace embed, and deep links with start-time anchors.
        Available on npm: <code>npm i -g praetorius</code>. Operates as the
        publication infrastructure that lets cybernetic and non-cybernetic works
        share a single evidential surface.
      </p>
      <p>
        Links:{' '}
        <a href="https://www.npmjs.com/package/praetorius" target="_blank" rel="noreferrer">npm</a>{' '}·{' '}
        <a href="https://github.com/cbassuarez/praetorius" target="_blank" rel="noreferrer">github</a>
      </p>

      <h3>5. cbassuarez.com</h3>
      <p>
        The site is treated as a cybernetic work in itself: visitor navigation
        authors what is encountered; the operator's live activity (Spotify,
        GitHub, Instagram, Bandcamp) is surfaced through the home page; an open
        guestbook accumulates a timeline of passages. The labs page hosts an
        ASCII MUD biome explorer where works in the world are reached through
        movement through a 2D space.
      </p>
      <p>
        Walk the site:{' '}
        [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/labs/chunk-surfer">chunk surfer</a> ] [ <a href="/labs/string">string</a> ] [ <a href="/labs/feed">seb feed</a> ] [ <a href="/labs/guestbook">guestbook</a> ]
      </p>

      <hr />

      <h2>Bibliography</h2>

      <p>
        American Society for Cybernetics, Heinz Von Foerster, and Margaret Mead.
        <i> Purposive Systems: Proceedings of the First Annual Symposium of the
        American Society for Cybernetics</i>. Spartan Books, 1968.
      </p>

      <p>
        Curtis, Adam, dir. <i>All Watched Over by Machines of Loving Grace</i>.
        BBC, 6 June 2011.{' '}
        <a href="https://www.filmsforaction.org/watch/bbc-all-watched-over-by-machines-of-loving-grace/?part=1" target="_blank" rel="noreferrer">part 1</a> ·{' '}
        <a href="https://www.filmsforaction.org/watch/bbc-all-watched-over-by-machines-of-loving-grace/?part=2" target="_blank" rel="noreferrer">part 2</a> ·{' '}
        <a href="https://www.filmsforaction.org/watch/bbc-all-watched-over-by-machines-of-loving-grace/?part=3" target="_blank" rel="noreferrer">part 3</a>.
      </p>

      <p>
        "Cybernetic Serendipity | Database of Digital Art." Accessed 11 January 2025.{' '}
        <a href="http://dada.compart-bremen.de/item/exhibition/3" target="_blank" rel="noreferrer">compart-bremen.de</a>.
      </p>

      <p>
        Eliasson, Olafur. Selected works:{' '}
        <a href="https://olafureliasson.net/artwork/pluriverse-assembly-2021/" target="_blank" rel="noreferrer"><i>Pluriverse Assembly</i> (2021)</a>,{' '}
        <a href="https://olafureliasson.net/artwork/room-for-one-colour-1997/" target="_blank" rel="noreferrer"><i>Room for One Colour</i> (1997)</a>,{' '}
        <a href="https://olafureliasson.net/artwork/self-loop-2015/" target="_blank" rel="noreferrer"><i>Self-Loop</i> (2015)</a>,{' '}
        <a href="https://olafureliasson.net/artwork/the-listening-dimension-orbit-1-2017/" target="_blank" rel="noreferrer"><i>The Listening Dimension</i> (orbits 1–3, 2017)</a>,{' '}
        <a href="https://olafureliasson.net/artwork/the-living-lighthouse-2023/" target="_blank" rel="noreferrer"><i>The Living Lighthouse</i> (2023)</a>,{' '}
        <a href="https://olafureliasson.net/artwork/the-unspeakable-openness-of-things-2018/" target="_blank" rel="noreferrer"><i>The Unspeakable Openness of Things</i> (2018)</a>,{' '}
        <a href="https://olafureliasson.net/artwork/your-pluralistic-coming-together-2024/" target="_blank" rel="noreferrer"><i>Your Pluralistic Coming Together</i> (2024)</a>.
      </p>

      <p>
        Foerster, Heinz Von. <i>Cybernetics of Cybernetics</i>.
      </p>

      <p>
        Franchetto, Jade. "CYSP 1., Nicolas Schöffer, 1956." <i>unmondemoderne</i>, January 2021.{' '}
        <a href="https://unmondemoderne.wordpress.com/2021/01/12/cysp-1-nicolas-schoffer-1956/" target="_blank" rel="noreferrer">link</a>.
      </p>

      <p>
        Glanville, Ranulph, and CybernEthics Research. <i>The Importance of Being Ernst</i>.
      </p>

      <p>
        Gur, Golan. "The Other Marxism: Georg Knepler and the Anthropology of Music."
        <i> Musicologica Austriaca</i>, no. 2016 (May 2016).{' '}
        <a href="https://www.musau.org/parts/neue-article-page/view/28" target="_blank" rel="noreferrer">link</a>.
      </p>

      <p>
        Kac, Eduardo, and Ikuo Nakamura. <i>Essay Concerning Human Understanding</i>. 1994.{' '}
        <a href="https://www.ekac.org/essay.html" target="_blank" rel="noreferrer">ekac.org/essay.html</a>.
      </p>

      <p>
        Kauffman, Louis H. "EigenForm." <i>Kybernetes</i> 34, no. 1/2 (2005): 129–50.{' '}
        <a href="https://doi.org/10.1108/03684920510575780" target="_blank" rel="noreferrer">doi</a>.
      </p>

      <p>
        Kollias, Phivos-Angelos. "The Self-Organising Work of Music."{' '}
        <i>Organised Sound</i> 16, no. 2 (2011): 192–99.{' '}
        <a href="https://doi.org/10.1017/S1355771811000148" target="_blank" rel="noreferrer">doi</a>.
      </p>

      <p>
        Lautenschlaeger, Graziele, and Anja Pratschke. "Electronic Art and
        Second Order Cybernetic: From Art in Process to Process in Art."{' '}
        <i>SIGraDi</i> 2008.
      </p>

      <p>
        LeBlanc, Lindsay. "Nicolas Schöffer and the Scattered Origins of
        Cybernetic Art History." Master's thesis, Concordia University, 2019.{' '}
        <a href="https://spectrum.library.concordia.ca/id/eprint/985837/" target="_blank" rel="noreferrer">link</a>.
      </p>

      <p>
        Maddox, Cain. <i>PROXIMATE</i>. Released 8 November 2024. macOS.{' '}
        <a href="https://store.steampowered.com/app/2957800/PROXIMATE/" target="_blank" rel="noreferrer">steam</a>.
      </p>

      <p>
        Mailman, Joshua Banks. "Cybernetic Phenomenology of Music, Embodied
        Speculative Realism, and Aesthetics-Driven Techné for Spontaneous
        Audio-Visual Expression." <i>Perspectives of New Music</i> 54, no. 1 (2016): 5.{' '}
        <a href="https://doi.org/10.7757/persnewmusi.54.1.0005" target="_blank" rel="noreferrer">doi</a>.
      </p>

      <p>
        Masani, P. R. "The Scientific Methodology in the Light of Cybernetics."{' '}
        <i>Kybernetes</i> 23, no. 4 (1994): 1–132.{' '}
        <a href="https://doi.org/10.1108/03684929410058713" target="_blank" rel="noreferrer">doi</a>.
      </p>

      <p>
        Qureshi, Regula. <i>Music and Marx: Ideas, Practices, Politics</i>.
        Routledge, 2014.
      </p>

      <p>
        Schöffer, Nicolas. <i>CYSP 1</i>. 1956. Steel and durable aluminum,
        mixed media, electronics.{' '}
        <a href="http://dada.compart-bremen.de/item/artwork/670" target="_blank" rel="noreferrer">database of digital art</a>.
      </p>

      <p>
        Scholte, Tom. "'Black Box' Theatre: Second-Order Cybernetics and
        Naturalism in Rehearsal and Performance." In{' '}
        <i>Series on Knots and Everything</i>, vol. 60. World Scientific, 2017.{' '}
        <a href="https://doi.org/10.1142/9789813226265_0044" target="_blank" rel="noreferrer">doi</a>.
      </p>

      <p>
        Scott, D. W. "Music as Semiotic Eigenbehavior."{' '}
        <i>Constructivist Foundations</i> 12, no. 3 (2017): 342–52.
      </p>

      <p>
        Shanken, Edward A. <i>Art in the Information Age: Cybernetics, Software,
        Telematics and the Conceptual Contributions of Art and Technology to Art
        History and Aesthetic Theory</i>. PhD diss., Duke University, 2001.{' '}
        <a href="https://artexetra.wordpress.com/wp-content/uploads/2010/04/shanken_art_info_age_diss_2001.pdf" target="_blank" rel="noreferrer">pdf</a>.
      </p>

      <hr />

      <h2>Contact</h2>
      <p>
        For follow-up about the talk or any of the works named —
      </p>
      <p>
        Email: <a href="mailto:contact@cbassuarez.com">contact@cbassuarez.com</a>
      </p>
      <p>
        Or: <a href="/contact">/contact</a>
      </p>

      <hr />

      <p>
        [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ] [ <a href="/colophon">colophon</a> ]
      </p>
    </>
  );
}

function ColophonPage() {
  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>colophon</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ]
        </p>
      </center>

      <hr />

      <p>1995/no-stylesheet concept with browser-default rendering.</p>
      <p>live data sources: spotify, instagram, github, bandcamp.</p>
      <p>feed API: <a href="https://seb-feed.cbassuarez.workers.dev/api/feed?limit=20" target="_blank" rel="noreferrer">seb-feed.cbassuarez.workers.dev</a></p>
      <p>works shell: Praetorius embed at <code>/works-console</code>.</p>
      <p>hosting: static site + cloudflare worker endpoints.</p>
      <p>
        also reachable: <code>curl cbassuarez.com/cli</code>{' · '}
        <code>ssh ssh.cbassuarez.com</code>{' · '}
        <code>gemini://gemini.cbassuarez.com</code>{' · '}
        <a href="/humans.txt">/humans.txt</a>{' · '}
        <a href="/access">/access</a>
      </p>
      <p>
        build:{' '}
        {BUILD_COMMIT_URL ? (
          <a href={BUILD_COMMIT_URL} target="_blank" rel="noreferrer">
            <code>{BUILD_LABEL}</code>
          </a>
        ) : (
          <code>{BUILD_LABEL}</code>
        )}
        {' '}(<a href="/version.json" target="_blank" rel="noreferrer">version.json</a>)
      </p>
    </>
  );
}

function AccessPage() {
  const rowStyle = { margin: '0.4em 0', display: 'flex', flexWrap: 'wrap', gap: '0.4em 1.2em' };
  const labelStyle = { minWidth: '20em', fontFamily: MONO_FONT_STACK };
  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>access</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ] [ <a href="/colophon">colophon</a> ]
        </p>
      </center>

      <hr />

      <p>
        this site is reachable in five registers. each one returns the same
        essential thing — that this is seb's site, that it has some live
        surfaces, and how to reach the operator. the registers differ in
        the texture of the reply.
      </p>

      <div style={{ marginTop: '1em' }}>
        <p style={rowStyle}>
          <code style={labelStyle}>https://cbassuarez.com</code>
          <span>the React site you are looking at.</span>
        </p>
        <p style={rowStyle}>
          <code style={labelStyle}>curl cbassuarez.com/cli</code>
          <span>the hand-typed letter, in plain text.</span>
        </p>
        <p style={rowStyle}>
          <code style={labelStyle}>ssh ssh.cbassuarez.com</code>
          <span>one-shot interactive surface.</span>
        </p>
        <p style={rowStyle}>
          <code style={labelStyle}>gemini://gemini.cbassuarez.com</code>
          <span>the Gemini protocol mirror.</span>
        </p>
        <p style={rowStyle}>
          <code style={labelStyle}><a href="/humans.txt">/humans.txt</a></code>
          <span>the operator's signed colophon.</span>
        </p>
      </div>

      <p style={{ marginTop: '1.5em' }}>live pieces in the browser:</p>

      <div>
        <p style={rowStyle}>
          <code style={labelStyle}><a href="/labs/string">/labs/string</a></code>
          <span>shared string instrument, multi-visitor.</span>
        </p>
        <p style={rowStyle}>
          <code style={labelStyle}><a href="/labs/repl">/labs/repl</a></code>
          <span>live-coding REPL in score-grid notation.</span>
        </p>
        <p style={rowStyle}>
          <code style={labelStyle}><a href="/labs/feed">/labs/feed</a></code>
          <span>everything I did online today.</span>
        </p>
        <p style={rowStyle}>
          <code style={labelStyle}><a href="/labs/guestbook">/labs/guestbook</a></code>
          <span>a place to leave a small mark.</span>
        </p>
      </div>

      <p style={{ marginTop: '1.5em' }}>smaller endpoints for those building things:</p>

      <div>
        <p style={rowStyle}>
          <code style={labelStyle}><a href="/version.json">/version.json</a></code>
          <span>the live build manifest.</span>
        </p>
        <p style={rowStyle}>
          <code style={labelStyle}><a href="https://seb-feed.cbassuarez.workers.dev/api/feed?limit=20" target="_blank" rel="noreferrer">/api/feed</a></code>
          <span>the seb feed as JSON.</span>
        </p>
        <p style={rowStyle}>
          <code style={labelStyle}><a href="https://seb-feed.cbassuarez.workers.dev/api/coroom/snapshot" target="_blank" rel="noreferrer">/api/coroom/snapshot</a></code>
          <span>/404 anteroom state as JSON.</span>
        </p>
        <p style={rowStyle}>
          <code style={labelStyle}><a href="/.well-known/cli-letter.txt">/.well-known/cli-letter.txt</a></code>
          <span>canonical text of the curl letter.</span>
        </p>
      </div>

      <p style={{ marginTop: '1.5em' }}>
        — more at <a href="/colophon">/colophon</a>
      </p>
    </>
  );
}

const COROOM_PALETTE = [
  [168, 36, 56], [192, 57, 43], [211, 84, 0], [184, 110, 33],
  [127, 96, 0], [85, 122, 58], [39, 174, 96], [22, 160, 133],
  [26, 140, 130], [31, 78, 121], [41, 128, 185], [58, 49, 133],
  [108, 52, 131], [142, 68, 173], [162, 62, 140], [196, 82, 139],
  [146, 52, 95], [80, 45, 73], [61, 44, 74], [38, 70, 83],
  [42, 64, 69], [73, 56, 38], [60, 40, 22], [44, 62, 80]
];

function coRoomColor(who) {
  const h = typeof who === 'string' && who.length >= 4 ? who : '0000';
  const idx = (parseInt(h.slice(0, 4), 16) || 0) % COROOM_PALETTE.length;
  const [r, g, b] = COROOM_PALETTE[idx];
  return `rgb(${r},${g},${b})`;
}

const COROOM_WHO_REGEX = /^[0-9a-f]{8,12}$|^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COROOM_PIECE_TITLE = 'Anteroom';
const COROOM_PIECE_YEAR = 2026;
const COROOM_PIECE_DESCRIPTION =
  'You have found a piece that exists only when ≥2 strangers simultaneously request a page that does not exist.';

function generateUuid() {
  try {
    if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID().toLowerCase();
    }
  } catch (_) {}
  // RFC 4122 v4 fallback using crypto.getRandomValues if available, else Math.random.
  const bytes = new Uint8Array(16);
  try {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
  } catch (_) {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function loadOrCreateCoRoomWho() {
  try {
    const saved = window.localStorage.getItem('prae:coroom:who');
    if (saved && COROOM_WHO_REGEX.test(saved)) return saved.toLowerCase();
  } catch (_) {}
  const w = generateUuid();
  try { window.localStorage.setItem('prae:coroom:who', w); } catch (_) {}
  return w;
}

function formatCoRoomDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${String(rm).padStart(2, '0')}m`;
  }
  return `${String(m).padStart(2, '0')}m ${String(r).padStart(2, '0')}s`;
}

function formatCoRoomTimestamp(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 19);
  return `${date} ${time} UTC`;
}

function formatCoRoomLocation(location) {
  const trimmed = String(location || '').trim();
  return trimmed || 'unknown location';
}

function NotFoundPlain({ isRoomPage = false }) {
  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>404 // not found</i>
        </p>
      </center>

      <hr />

     {isRoomPage ? (
  <>
    <p>the anteroom is not accessible right now.</p>
    <p>
      <small>it appears only under certain conditions of simultaneous access.</small>
    </p>
  </>
) : (
  <p>the page you asked for does not exist.</p>
)}
      <p>
        [ <a href="/">home</a> ] [ <a href="/labs/feed">seb feed</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ]
      </p>
      <p>
        <small>build: <code>{BUILD_LABEL}</code></small>
      </p>
    </>
  );
}

function CoRoomMemberRow({ member, currentTick, isSelf }) {
  const joinedAt = Number(member.joinedAt) || currentTick;
  const here = formatCoRoomDuration(Math.max(0, currentTick - joinedAt));
  const idStyle = { fontFamily: MONO_FONT_STACK, fontSize: '0.85em', wordBreak: 'break-all' };
  const dotStyle = {
    display: 'inline-block',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: coRoomColor(member.who),
    marginRight: '0.6em',
    verticalAlign: 'middle',
    boxShadow: isSelf ? '0 0 0 2px rgba(0,0,0,0.18)' : 'none'
  };
  return (
    <p style={{ margin: '0.3em 0', lineHeight: 1.55 }}>
      <span style={dotStyle} />
      <span style={idStyle}>{member.who}</span>
      <br />
      <small style={{ marginLeft: '1.5em' }}>
        from <i>{formatCoRoomLocation(member.location)}</i> · here {here}
        {isSelf ? ' · this is you' : ''}
      </small>
    </p>
  );
}

function CoRoomView({ currentInstance, log, count, peak, members, selfWho, highlightColor }) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const startedAt = currentInstance?.startedAt || tick;
  const durationMs = Math.max(0, tick - startedAt);

  const wrapStyle = { maxWidth: '46em', margin: '0 auto', padding: '0 1em' };
  const headerStyle = { textAlign: 'center', marginTop: '1em' };
  const titleStyle = { fontStyle: 'italic', margin: '0.4em 0', letterSpacing: '0.02em' };
  const yearStyle = { color: '#666', marginLeft: '0.5em' };
  const descriptionStyle = { lineHeight: 1.6, margin: '0.8em 0', textAlign: 'left' };
const roomStatusHighlightStyle = {
  backgroundColor: highlightColor || '#ffff99',
  color: '#111',
  padding: '0 0.15em'
};
const sectionTitleStyle = { fontStyle: 'italic', margin: '1.2em 0 0.4em', textAlign: 'center' };

  return (
    <>
      <center>
        <h1 style={{ marginBottom: 0 }}>{SITE_DOMAIN}</h1>
        <p style={{ margin: '0.2em 0' }}>
          <small>
            <i>404 // not found</i> · <i>occupied</i>
          </small>
        </p>
        <p style={{ margin: '0.4em 0' }}>
          [ <a href="/">home</a> ] [ <a href="/labs/feed">seb feed</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ]
        </p>
      </center>

      <hr />

      <div style={wrapStyle}>
        <div style={headerStyle}>
          <p style={titleStyle}>
            <strong>{COROOM_PIECE_TITLE}</strong>
            <span style={yearStyle}>({COROOM_PIECE_YEAR})</span>
          </p>
        </div>

        <p style={descriptionStyle}>{COROOM_PIECE_DESCRIPTION}</p>

        <p style={{ ...descriptionStyle, color: '#444' }}>
  <small>
    <img
      src="/icons/warning.png"
      alt="[!]"
      width="24"
      height="24"
      align="absmiddle"
    />{' '}
    <mark style={roomStatusHighlightStyle}>
      This piece is accessible because there are currently <b>{count}</b> simultaneous visitors on a 404 page.
    </mark>{' '}
    When the count drops below 2, the room closes, this instance is appended to the log below, and both visitors&apos;
    views revert to the ordinary 404. Identifiers shown below are persistent UUIDs stored in each visitor&apos;s
    browser; locations are derived from the connecting network and are approximate.
  </small>
</p>


        <hr style={{ margin: '1.5em 0' }} />

        <p style={sectionTitleStyle}>currently in this instance</p>
        <div style={{ margin: '0 auto', maxWidth: '40em' }}>
          {members.length === 0 ? (
            <p style={{ textAlign: 'center' }}><small>(awaiting members…)</small></p>
          ) : (
            members.map((m) => (
              <CoRoomMemberRow
                key={m.who}
                member={m}
                currentTick={tick}
                isSelf={m.who === selfWho}
              />
            ))
          )}
        </div>

        <p style={{ textAlign: 'center', margin: '1em 0 0.2em' }}>
          <small>
            since {formatCoRoomTimestamp(startedAt)} · {formatCoRoomDuration(durationMs)} · peak {peak} ·{' '}
            {count} present
          </small>
        </p>

        <hr style={{ margin: '1.5em 0' }} />

        <p style={sectionTitleStyle}>log of every prior co-presence instance</p>
        {log.length === 0 ? (
          <p style={{ textAlign: 'center' }}><small>no prior instances on record.</small></p>
        ) : (
          <pre style={{
    fontFamily: MONO_FONT_STACK,
    fontSize: '0.82em',
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    background: '#f5f5f0',
    padding: '0.8em 1em',
    border: '1px solid #ddd'
  }}>
{log.map((entry) => {
  const started = formatCoRoomTimestamp(entry.startedAt);
  const dur = formatCoRoomDuration(entry.durationMs);
  const peakStr = String(entry.peak).padStart(2, ' ');
  const memberLines = Array.isArray(entry.members)
    ? entry.members.map((mm) => {
        const who = String(mm?.who || '').trim();
        const loc = formatCoRoomLocation(mm?.location);
        return who ? `      · ${who}  (${loc})` : '';
      }).filter(Boolean).join('\n')
    : '';
  const header = `${started}   ${dur}   peak ${peakStr}`;
  return memberLines ? `${header}\n${memberLines}\n\n` : `${header}\n\n`;
}).join('')}
          </pre>
        )}

        <p style={{ textAlign: 'center', margin: '2em 0 1em' }}>
          <small>
            piece: <i>{COROOM_PIECE_TITLE}</i> ({COROOM_PIECE_YEAR}) · seb suarez · cbassuarez.com
          </small>
        </p>
      </div>
    </>
  );
}

function NotFoundPage({ isRoomPage = false }) {
  const [who] = useState(() => loadOrCreateCoRoomWho());
  const [count, setCount] = useState(1);
  const [peak, setPeak] = useState(1);
  const [members, setMembers] = useState([]);
  const [currentInstance, setCurrentInstance] = useState(null);
  const [log, setLog] = useState([]);
  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const pingTimerRef = useRef(null);
  const backoffRef = useRef(800);
  const roomHighlightColor = useMemo(() => highlightFromLinkColor(pickWebsafeLinkColor()), []);

  useEffect(() => {
    let cancelled = false;
    let ws = null;

    const wsBase = (() => {
      try {
        const u = new URL(FEED_API_BASE);
        u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
        return u.origin.replace(/\/+$/, '');
      } catch (_) {
        return FEED_API_BASE.replace(/^http(s?):\/\//i, (_m, s) => (s ? 'wss://' : 'ws://'));
      }
    })();
    const url = `${wsBase}/api/coroom/socket?who=${encodeURIComponent(who)}`;

    function clearTimers() {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
    }

    function applyHello(msg) {
      const c = Number(msg.count) || 0;
      setCount(c);
      if (msg.currentInstance) {
        setCurrentInstance({
          startedAt: Number(msg.currentInstance.startedAt) || Date.now(),
          peak: Number(msg.currentInstance.peak) || c
        });
        setPeak(Number(msg.currentInstance.peak) || c);
        setMembers(Array.isArray(msg.currentInstance.members) ? msg.currentInstance.members : []);
      } else {
        setCurrentInstance(null);
        setPeak(Math.max(1, c));
        setMembers([]);
      }
      if (Array.isArray(msg.log)) setLog(msg.log);
    }

    function handleMessage(raw) {
      let msg;
      try { msg = JSON.parse(typeof raw === 'string' ? raw : ''); } catch (_) { return; }
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'hello':
          applyHello(msg);
          return;
        case 'open':
          setCurrentInstance({
            startedAt: Number(msg.startedAt) || Date.now(),
            peak: Number(msg.peak) || 2
          });
          setPeak(Number(msg.peak) || 2);
          if (Array.isArray(msg.members)) {
            setMembers(msg.members);
            setCount(msg.members.length);
          }
          return;
        case 'presence':
          if (Array.isArray(msg.members)) {
            setMembers(msg.members);
            setCount(msg.members.length);
          } else if (Number.isFinite(msg.count)) {
            setCount(Number(msg.count));
          }
          if (Number.isFinite(msg.peak)) setPeak(Number(msg.peak));
          return;
        case 'close':
          if (msg.entry && typeof msg.entry === 'object') {
            setLog((prev) => [msg.entry, ...prev].slice(0, 200));
          }
          setCurrentInstance(null);
          setMembers([]);
          setCount((c) => Math.min(c, 1));
          return;
        case 'pong':
        default:
          return;
      }
    }

    function connect() {
      if (cancelled) return;
      try {
        ws = new WebSocket(url);
      } catch (_) {
        scheduleReconnect();
        return;
      }
      socketRef.current = ws;
      ws.addEventListener('open', () => {
        if (cancelled || ws !== socketRef.current) return;
        backoffRef.current = 800;
        if (pingTimerRef.current) clearInterval(pingTimerRef.current);
        pingTimerRef.current = setInterval(() => {
          if (!socketRef.current || socketRef.current.readyState !== 1) return;
          try { socketRef.current.send(JSON.stringify({ type: 'ping', t: Date.now() })); } catch (_) {}
        }, 25_000);
      });
      ws.addEventListener('message', (e) => {
        if (cancelled || ws !== socketRef.current) return;
        handleMessage(e.data);
      });
      ws.addEventListener('close', () => {
        if (cancelled || ws !== socketRef.current) return;
        socketRef.current = null;
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        scheduleReconnect();
      });
      ws.addEventListener('error', () => {
        // close handler will fire next; nothing to do here.
      });
    }

    function scheduleReconnect() {
      if (cancelled) return;
      if (reconnectTimerRef.current) return;
      const delay = Math.min(15_000, Math.max(800, backoffRef.current));
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        backoffRef.current = Math.min(15_000, Math.max(800, backoffRef.current * 1.7));
        connect();
      }, delay);
    }

    connect();

    return () => {
      cancelled = true;
      clearTimers();
      if (socketRef.current) {
        try { socketRef.current.close(1000, 'unmount'); } catch (_) {}
        socketRef.current = null;
      }
    };
  }, [who]);

  if (count >= 2) {
    return (
      <CoRoomView
          currentInstance={currentInstance}
          log={log}
          count={count}
          peak={peak}
          members={members}
          selfWho={who}
          highlightColor={roomHighlightColor}
        />
    );
  }
 return <NotFoundPlain isRoomPage={isRoomPage} />;
}

function LegacyFeedHashRedirect() {
  useEffect(() => {
    window.location.replace('/labs/feed');
  }, []);

  return (
    <p>
      redirecting to <a href="/labs/feed">/labs/feed</a>...
    </p>
  );
}

export default function App() {
  const linkColor = useMemo(() => pickWebsafeLinkColor(), []);
  const isMobile = useIsMobile();

  // Print a one-time-per-session greeting in the dev console enumerating the
  // alternate command-line surfaces. Visible only to people who open devtools;
  // gated on sessionStorage so it doesn't repeat on internal navigations.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem('cbassuarez:console-greeted')) return;
      window.sessionStorage.setItem('cbassuarez:console-greeted', '1');
    } catch (_) { /* private mode etc. — fall through, prints once per page load */ }
    const dim = 'color:#666;font-family:monospace;font-size:12px;line-height:1.5;';
    const head = 'color:#0000CC;font-family:monospace;font-size:14px;font-weight:bold;line-height:1.6;';
    /* eslint-disable no-console */
    console.log('%ccbassuarez.com', head);
    console.log('%calso reachable from the command line:', dim);
    console.log('%c  curl cbassuarez.com/cli', dim);
    console.log('%c  ssh  ssh.cbassuarez.com', dim);
    console.log('%c  gemini://gemini.cbassuarez.com', dim);
    console.log('%c  /humans.txt   /.well-known/cli-letter.txt', dim);
    /* eslint-enable no-console */
  }, []);

  const pathname = window.location.pathname;
  const hash = window.location.hash;
  const isHomePage = pathname === '/';
  const isWorksPage = window.location.pathname.startsWith('/works');
  const isAboutPage = window.location.pathname.startsWith('/about');
  const isPressPage = /^\/press\/?$/i.test(pathname);
  const isFeedPage = /^\/labs\/feed\/?$/i.test(pathname);
  const isGuestbookPage = /^\/labs\/guestbook\/?$/i.test(pathname);
  const isContactPage = window.location.pathname.startsWith('/contact');
  const isColophonPage = window.location.pathname.startsWith('/colophon');
  const isAccessPage = /^\/access\/?$/i.test(pathname);
  const isTalkRecapPage = window.location.pathname.startsWith('/dma-2026');
  const isRecentPage = /^\/(?:recent|events)\/?$/i.test(pathname);
  const isLabsWorksListPage = /^\/labs\/works?-list\/?$/i.test(pathname);
  const isChunkSurferPage = /^\/labs\/chunk-surfer\/?$/i.test(pathname);
  const isLabsDirectoryPage = /^\/labs\/?$/i.test(pathname);
  const isLabsChildRoute = /^\/labs\/.+/i.test(pathname);
  const isStringPage = /^\/labs\/string\/?$/i.test(pathname);
  const isReplPage = /^\/labs\/repl\/?$/i.test(pathname);
  const isTmaydLabsPage = pathname.startsWith('/labs/tell-me-about-your-day');
  const isRoomPage = /^\/room\/?$/i.test(pathname);
  const isLegacyFeedHash = pathname === '/' && /^#seb-feed$/i.test(hash);
  const isKnownRoute =
  isRoomPage ||
  isHomePage ||
  isWorksPage ||
  isAboutPage ||
  isPressPage ||
  isFeedPage ||
  isGuestbookPage ||
  isContactPage ||
  isColophonPage ||
  isAccessPage ||
  isTalkRecapPage ||
  isRecentPage ||
  isLabsWorksListPage ||
  isChunkSurferPage ||
  isLabsDirectoryPage ||
  isStringPage ||
  isReplPage ||
  isTmaydLabsPage ||
  isLegacyFeedHash;

const isNotFoundRoute = !isKnownRoute;
  const useSplitPaneShell = !isMobile && !isWorksPage && !isLabsChildRoute;
  const hideGlobalFooter = isWorksPage || isLabsChildRoute;

  let page = isHomePage ? <HomePage shellMode={useSplitPaneShell} /> : <NotFoundPage />;
  if (isLabsWorksListPage) {
    page = <LabsWorksListPage />;
  } else if (isChunkSurferPage) {
    page = <ChunkSurferLabPage />;
  } else if (isLabsDirectoryPage) {
    page = <LabsDirectoryPage />;
  } else if (isRecentPage) {
    page = <RecentWorksPage />;
  } else if (isStringPage) {
    page = <StringLabPage />;
  } else if (isReplPage) {
    page = <ReplLabPage />;
  } else if (isLegacyFeedHash) {
    page = <LegacyFeedHashRedirect />;
    } else if (isRoomPage) {
  page = <NotFoundPage isRoomPage />;
  } else if (isTmaydLabsPage) {
    page = <TmaydLabsPage pathname={pathname} />;
  } else if (isAboutPage) {
    page = <AboutPage />;
  } else if (isPressPage) {
    page = <PressPage />;
  } else if (isWorksPage) {
    page = <WorksPage />;
  } else if (isFeedPage) {
    page = <FeedPage />;
  } else if (isGuestbookPage) {
    page = <GuestbookPage />;
  } else if (isContactPage) {
    page = <ContactPage />;
  } else if (isColophonPage) {
    page = <ColophonPage />;
  } else if (isAccessPage) {
    page = <AccessPage />;
  } else if (isTalkRecapPage) {
    page = <TalkRecapPage />;
  }
const content = useSplitPaneShell ? (
  <SplitPaneLayout naturalHeight={isNotFoundRoute}>
    {page}
  </SplitPaneLayout>
) : page;
  return (
    <>
      <style>{`a:link { color: ${linkColor}; } a:visited { color: ${VISITED_LINK_COLOR}; }`}</style>
      <div style={{ fontFamily: UI_FONT_STACK }}>
        {content}
      </div>
      {hideGlobalFooter ? null : <GlobalFooter />}
      <SiteVersion />
    </>
  );
}
