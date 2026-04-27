import { useEffect, useMemo, useRef, useState } from 'react';

const SITE_DOMAIN = 'cbassuarez.com';
const OPERATOR_NAME = 'seb suarez';
const OPERATOR_IMAGE = '/seb-portrait.jpg';
const FEED_API_BASE = import.meta.env.VITE_FEED_API_BASE || 'https://seb-feed.cbassuarez.workers.dev';
const UI_FONT_STACK = '"Times New Roman", Times, serif';
const MONO_FONT_STACK = '"Courier New", Courier, monospace';

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

function AboutPage() {
  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>about</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ]
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
        Press kit: under construction
        <br />
        CV: in progress
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
        Quick links: [ <a href="/works">works</a> ] [ <a href="/">home</a> ]
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

function HomePage() {
  const HOME_GUESTBOOK_LIMIT = 40;
  const footerRef = useRef(null);
  const [footerSpacerPx, setFooterSpacerPx] = useState(64);
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

  useEffect(() => {
    const measure = () => {
      const next = footerRef.current?.offsetHeight;
      if (Number.isFinite(next) && next > 0) {
        setFooterSpacerPx(next);
      }
    };

    measure();
    window.addEventListener('resize', measure);

    let observer;
    if (typeof ResizeObserver !== 'undefined' && footerRef.current) {
      observer = new ResizeObserver(() => measure());
      observer.observe(footerRef.current);
    }

    return () => {
      window.removeEventListener('resize', measure);
      if (observer) observer.disconnect();
    };
  }, []);

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
            [ <a href="/about">about</a> ] [ <a href="/works">works</a> ]
          </p>
          <h3>labs</h3>
          <p>
            [ <a href="/feed">seb feed</a> ] [ <a href="/guestbook">guestbook</a> ] [ <a href="/labs/chunk-surfer/index.html">chunk surfer</a> ]
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
            [ <a href="/feed">open full seb feed</a> ]
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
            [ <a href="/guestbook">open full guestbook</a> ]
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
                  <a href="/contact">contact</a>
                </li>
                <li>
                    <a href="/works">works</a>
                  </li>
                </ul>
                <h3>labs</h3>
                <ul>
                  <li>
                    <a href="/feed">seb feed</a>
                  </li>
                  <li>
                    <a href="/guestbook">guestbook</a>
                  </li>
                  <li>
                    <a href="/labs/chunk-surfer/index.html">chunk surfer</a>
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

      <div aria-hidden="true" style={{ height: `${footerSpacerPx}px` }} />
      <div ref={footerRef} style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: '#fff' }}>
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
            [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ] [ labs: <a href="/feed">seb feed</a> / <a href="/guestbook">guestbook</a> / <a href="/labs/chunk-surfer/index.html">chunk surfer</a> ] [ <a href="/colophon">colophon</a> ]
          </small>
        </center>
      </div>
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
            <>[ <a href="/">home</a> ] [ <a href="/feed">seb feed</a> ] [ <a href="/guestbook">guestbook</a> ]</>
          ) : (
            <>[ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ] [ <a href="/feed">seb feed</a> ] [ <a href="/guestbook">guestbook</a> ]</>
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
          [ <a href="/">home</a> ] [ <a href="/feed">seb feed</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ] [ <a href="/guestbook">guestbook</a> ]
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
  const sent = new URLSearchParams(window.location.search).get('sent') === '1';
  const nextUrl = useMemo(() => `${window.location.origin}/contact?sent=1`, []);
  const localSystemTime = useMemo(
    () => new Date().toLocaleTimeString('en-US', { hour12: false, timeZoneName: 'short' }),
    []
  );
  const humanCheck = useMemo(() => {
    const a = Math.floor(Math.random() * 8) + 1;
    const b = Math.floor(Math.random() * 8) + 1;
    return { a, b, answer: a + b };
  }, []);

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
            <b>message received. signal locked.</b>
          </p>
          <p>
            [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/feed">seb feed</a> ]
          </p>
        </>
      ) : (
        <>
          <p>writes back within 24-72 hours.</p>
          <form action="https://formspree.io/f/mjkepaeo" method="POST">
            <input type="hidden" name="_next" value={nextUrl} />
            <input type="text" name="_gotcha" tabIndex="-1" autoComplete="off" style={{ display: 'none' }} />
            <p>
              name:{' '}
              <input type="text" name="name" size="24" required />
            </p>
            <p>
              email:{' '}
              <input type="email" name="email" size="28" required />
            </p>
            <p>
              subject:{' '}
              <input type="text" name="subject" size="36" required />
            </p>
            <p>
              topic:{' '}
              <select name="topic" defaultValue="commission">
                <option value="commission">commission</option>
                <option value="performance">performance</option>
                <option value="collab">collab</option>
                <option value="press">press</option>
                <option value="other">other</option>
              </select>
            </p>
            <p>
              <label>
                <input type="checkbox" name="time_sensitive" value="yes" /> this is time-sensitive
              </label>
            </p>
            <p>
              message:
              <br />
              <textarea name="message" rows="8" cols="56" required />
            </p>
            <p>
              human check ({humanCheck.a} + {humanCheck.b} = ?):{' '}
              <input
                type="text"
                name="human_check"
                size="4"
                inputMode="numeric"
                pattern={`^${humanCheck.answer}$`}
                title={`please enter ${humanCheck.answer}`}
                required
              />
            </p>
            <p>
              <button type="submit">send transmission</button>
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
        Sebastian Suarez-Solis · Advisor: Tim Feeney
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
        [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/labs/chunk-surfer/index.html">chunk surfer</a> ] [ <a href="/feed">seb feed</a> ] [ <a href="/guestbook">guestbook</a> ]
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
    </>
  );
}

function NotFoundPage() {
  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>404 // not found</i>
        </p>
      </center>

      <hr />

      <p>the page you asked for does not exist.</p>
      <p>
        [ <a href="/">home</a> ] [ <a href="/feed">seb feed</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ]
      </p>
    </>
  );
}

function LegacyWorksRedirect() {
  useEffect(() => {
    window.location.replace('/works');
  }, []);

  return (
    <p>
      redirecting to <a href="/works">/works</a>...
    </p>
  );
}

function LegacyFeedHashRedirect() {
  useEffect(() => {
    window.location.replace('/feed');
  }, []);

  return (
    <p>
      redirecting to <a href="/feed">/feed</a>...
    </p>
  );
}

export default function App() {
  const linkColor = useMemo(() => {
    const index = Math.floor(Math.random() * WEBSAFE_LINK_COLORS.length);
    return WEBSAFE_LINK_COLORS[index] || '#0000CC';
  }, []);

  const pathname = window.location.pathname;
  const hash = window.location.hash;
  const isWorksPage = window.location.pathname.startsWith('/works');
  const isAboutPage = window.location.pathname.startsWith('/about');
  const isFeedPage = window.location.pathname.startsWith('/feed');
  const isGuestbookPage = window.location.pathname.startsWith('/guestbook');
  const isContactPage = window.location.pathname.startsWith('/contact');
  const isColophonPage = window.location.pathname.startsWith('/colophon');
  const isTalkRecapPage = window.location.pathname.startsWith('/dma-2026');
  const isLegacyWorksPage = /^\/labs\/works-list\/?$/i.test(pathname);
  const isLegacyFeedHash = pathname === '/' && /^#seb-feed$/i.test(hash);

  let page = pathname === '/' ? <HomePage /> : <NotFoundPage />;
  if (isLegacyWorksPage) {
    page = <LegacyWorksRedirect />;
  } else if (isLegacyFeedHash) {
    page = <LegacyFeedHashRedirect />;
  } else if (isAboutPage) {
    page = <AboutPage />;
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
  } else if (isTalkRecapPage) {
    page = <TalkRecapPage />;
  }

  return (
    <>
      <style>{`a:link { color: ${linkColor}; } a:visited { color: ${VISITED_LINK_COLOR}; }`}</style>
      <div style={{ fontFamily: UI_FONT_STACK }}>
        {page}
      </div>
    </>
  );
}
