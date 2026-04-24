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

function mergeAndSortFeed(items) {
  return [...items]
    .filter((item) => item && item.text)
    .sort((a, b) => b.at - a.at)
    .slice(0, 16);
}

async function fetchCombinedSebFeed() {
  const endpoint = `${FEED_API_BASE}/api/feed?limit=24`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    throw new Error(`feed api failed (${response.status})`);
  }

  const payload = await response.json();
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const sources = payload?.sources && typeof payload.sources === 'object' ? payload.sources : {};

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

  return {
    items: mergeAndSortFeed(successful),
    failedCount,
    sources
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

async function fetchGuestbookEntries() {
  const response = await fetch(`${FEED_API_BASE}/api/guestbook?limit=40`);
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
    .filter((entry) => entry.message.length > 0)
    .slice(0, 40);
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
    .filter((entry) => entry.message.length > 0)
    .slice(0, 40);
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

function useSebFeed() {
  const [feedItems, setFeedItems] = useState([]);
  const [feedMeta, setFeedMeta] = useState('syncing');
  const [feedSources, setFeedSources] = useState({});
  const [isBooting, setIsBooting] = useState(true);

  useEffect(() => {
    let active = true;

    const sync = async () => {
      setFeedMeta('syncing');

      try {
        const result = await fetchCombinedSebFeed();

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
  }, []);

  return {
    feedItems,
    feedMeta,
    feedSources,
    isBooting
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
        style={{ width: '100%', height: '78vh', border: 0, display: 'block' }}
      />
    </>
  );
}

function HomePage() {
  const hits = useTruthfulHitCounter();
  const { feedItems, feedMeta, feedSources, isBooting } = useSebFeed();
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

  useEffect(() => {
    if (!isBooting) return;

    const intervalId = window.setInterval(() => {
      setBootDotCount((count) => (count % 3) + 1);
    }, 450);

    return () => window.clearInterval(intervalId);
  }, [isBooting]);

  const bootDots = '.'.repeat(bootDotCount);

  const marqueeText = useMemo(() => {
    if (isBooting) {
      return `boot: syncing seb feed${bootDots} /// boot: fetching sources${bootDots} /// boot: compiling timeline${bootDots}`;
    }

    const pieces = feedItems.slice(0, 6).map((item) => `${item.source}: ${item.text}`);

    if (pieces.length === 0) {
      return 'waiting for seb feed...';
    }

    return pieces.join(' /// ');
  }, [feedItems, isBooting, bootDots]);

  const spotifyNow = useMemo(
    () => feedItems.find((item) => String(item.source || '').toLowerCase() === 'spotify') || null,
    [feedItems]
  );
  const spotifyTrackId = spotifyTrackIdFromItem(spotifyNow);
  const [spotifyLocalProgressMs, setSpotifyLocalProgressMs] = useState(0);

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
      const entries = await createGuestbookEntry({ name: cleanName, message: cleanMessage });
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

      <marquee behavior="alternate" scrollAmount="4">
        {marqueeText}
      </marquee>

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
                  <a href="/feed">seb feed</a>
                </li>
                <li>
                  <a href="#guestbook">guestbook</a>
                </li>
                <li>
                  <a href="/works">works</a>
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
                this landing is intentionally raw HTML-era output. no stylesheet. browser defaults only.
              </p>

              <h2>what is seb doing // live feed</h2>
              {isBooting ? (
                <p>
                  <i>syncing feed{bootDots}</i>
                </p>
              ) : (
                <ul>
                  {feedItems.slice(0, 12).map((item, index) => (
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
                  <h3>listen with seb</h3>
                  <p>
                    <small>{spotifyNow.text}</small>
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

              <a id="guestbook" />
              <h2>guestbook.exe</h2>
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
              </form>

              <table border="1" cellPadding="6" width="100%">
                <tbody>
                  {guestbook.length === 0 ? (
                    <tr>
                      <td width="24%">system</td>
                      <td>
                        {guestbookStatus === 'loading' || guestbookStatus === 'saving'
                          ? 'loading entries...'
                          : 'no entries yet'}
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
          [ <a href="/feed">seb feed</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ under construction ]
        </small>
      </center>
    </>
  );
}

function FeedPage() {
  const { feedItems, feedMeta, feedSources, isBooting } = useSebFeed();
  const [bootDotCount, setBootDotCount] = useState(1);

  useEffect(() => {
    if (!isBooting) return;

    const intervalId = window.setInterval(() => {
      setBootDotCount((count) => (count % 3) + 1);
    }, 450);

    return () => window.clearInterval(intervalId);
  }, [isBooting]);

  const bootDots = '.'.repeat(bootDotCount);

  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>what is seb doing // live feed</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ <a href="/feed">seb feed</a> ]
        </p>
      </center>

      <hr />

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
  const pathname = window.location.pathname;
  const hash = window.location.hash;
  const isWorksPage = window.location.pathname.startsWith('/works');
  const isAboutPage = window.location.pathname.startsWith('/about');
  const isFeedPage = window.location.pathname.startsWith('/feed');
  const isLegacyWorksPage = /^\/labs\/works-list\/?$/i.test(pathname);
  const isLegacyFeedHash = pathname === '/' && /^#seb-feed$/i.test(hash);

  if (isLegacyWorksPage) {
    return <LegacyWorksRedirect />;
  }

  if (isLegacyFeedHash) {
    return <LegacyFeedHashRedirect />;
  }

  if (isAboutPage) {
    return <AboutPage />;
  }

  if (isWorksPage) {
    return <WorksPage />;
  }

  if (isFeedPage) {
    return <FeedPage />;
  }

  return <HomePage />;
}
