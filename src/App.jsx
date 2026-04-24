import { useEffect, useMemo, useState } from 'react';

const SITE_DOMAIN = 'cbassuarez.com';
const OPERATOR_NAME = 'seb suarez';
const OPERATOR_IMAGE = '/seb-portrait.jpg';
const FEED_API_BASE = import.meta.env.VITE_FEED_API_BASE || 'https://seb-feed.cbassuarez.workers.dev';

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
  '#6633CC',
  '#990099',
  '#993300',
  '#CC0033',
  '#CC3300'
];

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

  const spotifyLive = ordered.find((item) => sourceBase(item.source) === 'spotify' && item.isPlaying);
  if (spotifyLive) return build(spotifyLive, true);

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
  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>works</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ]
        </p>
      </center>

      <hr />

      <iframe
        title="Praetorius Works"
        src="/works-console/index.html"
        style={{ width: '100%', height: '70vh', border: 0, display: 'block' }}
      />
      <p>
        <small>
          fallback: [ <a href="/works-console/index.html">open works console directly</a> ]
        </small>
      </p>
    </>
  );
}

function HomePage() {
  const HOME_GUESTBOOK_LIMIT = 40;
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
      setGuestbookStatus('offline');
    }
  };

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

      <marquee behavior="scroll" direction="left" scrollAmount="2" scrollDelay="30">
        {marqueeText}
      </marquee>

      <h3>navigation</h3>
      <p>
        [ <a href="/about">about</a> ] [ <a href="/feed">seb feed</a> ] [ <a href="/guestbook">guestbook</a> ] [ <a href="/works">works</a> ]
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
        this landing is intentionally raw HTML-era output. no stylesheet. browser defaults only.
      </p>

      <h3>what is seb doing // live feed</h3>
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
            size="20"
          />
        </p>
        <p>
          message:{' '}
          <input
            type="text"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            size="36"
          />
        </p>
        <p>
          <button type="submit">sign guestbook</button>
        </p>
      </form>

      <table border="1" cellPadding="6" width="100%">
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
          [ <a href="/feed">seb feed</a> ] [ <a href="/guestbook">guestbook</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ under construction ]
        </small>
      </center>
    </>
  );
}

function FeedPage() {
  const { feedItems, feedMeta, feedSources, isBooting, currentActivity } = useSebFeed({ apiLimit: 5000, maxItems: null });
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
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/feed">seb feed</a> ] [ <a href="/guestbook">guestbook</a> ]
        </p>
      </center>

      <hr />

      <p>
        <small>{feedStatusLine}</small>
      </p>

      <p>
        <b>live timeline</b> (newest first)
      </p>

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
      setGuestbookStatus('offline');
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
          [ <a href="/">home</a> ] [ <a href="/feed">seb feed</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/guestbook">guestbook</a> ]
        </p>
      </center>

      <hr />

      <form onSubmit={submitGuestbook}>
        <p>
          name:{' '}
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} size="20" />
        </p>
        <p>
          message:{' '}
          <input type="text" value={message} onChange={(event) => setMessage(event.target.value)} size="36" />
        </p>
        <p>
          <button type="submit">sign guestbook</button>
        </p>
      </form>

      <table border="1" cellPadding="6" width="100%">
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
          {guestbook.map((entry, index) => (
            <tr key={`${entry.name}-${entry.message}-${index}`}>
              <td>{entry.name}</td>
              <td>{entry.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const isLegacyWorksPage = /^\/labs\/works-list\/?$/i.test(pathname);
  const isLegacyFeedHash = pathname === '/' && /^#seb-feed$/i.test(hash);

  let page = <HomePage />;
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
  }

  return (
    <>
      <style>{`a, a:visited { color: ${linkColor}; }`}</style>
      {page}
    </>
  );
}
