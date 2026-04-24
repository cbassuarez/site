import { useEffect, useMemo, useState } from 'react';

const SITE_DOMAIN = 'cbassuarez.com';
const OPERATOR_NAME = 'seb suarez';

const GITHUB_USERS = ['cbassuarez'];

const SOCIAL_RSS_SOURCES = [
  {
    label: 'bandcamp',
    url: 'https://cbassuarez.bandcamp.com/feed'
  }
];

const SOCIAL_LINKS = [
  { label: 'github', url: 'https://github.com/cbassuarez' },
  { label: 'bandcamp', url: 'https://cbassuarez.bandcamp.com' },
  { label: 'email', url: 'mailto:hello@cbassuarez.com' }
];

const FEED_FALLBACK = [
  'boot complete',
  'waiting for live feeds',
  'type refresh in your brain'
];

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

function shortText(value, max = 92) {
  if (!value) {
    return '';
  }

  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 3)}...`;
}

function formatGitHubEvent(event) {
  const repo = event?.repo?.name || 'repo';

  switch (event.type) {
    case 'PushEvent': {
      const commits = event.payload?.commits || [];
      const count = commits.length;

      if (count > 0) {
        const first = commits[0]?.message || 'commit';
        return `pushed ${count} commit${count > 1 ? 's' : ''} to ${repo} :: ${shortText(first, 64)}`;
      }

      return `pushed to ${repo}`;
    }

    case 'CreateEvent':
      return `created ${event.payload?.ref_type || 'ref'} in ${repo}`;

    case 'WatchEvent':
      return `starred ${repo}`;

    case 'ForkEvent':
      return `forked ${repo}`;

    case 'PullRequestEvent': {
      const action = event.payload?.action || 'updated';
      const number = event.payload?.number;
      return `${action} pull request${number ? ` #${number}` : ''} in ${repo}`;
    }

    case 'IssuesEvent': {
      const action = event.payload?.action || 'updated';
      const number = event.payload?.issue?.number;
      const title = event.payload?.issue?.title;
      return `${action} issue${number ? ` #${number}` : ''} in ${repo}${title ? ` :: ${shortText(title, 52)}` : ''}`;
    }

    case 'IssueCommentEvent':
      return `commented on issue in ${repo}`;

    case 'ReleaseEvent': {
      const tag = event.payload?.release?.tag_name || event.payload?.release?.name || 'release';
      return `published ${tag} in ${repo}`;
    }

    default:
      return `${event.type.replace(/Event$/, '').toLowerCase()} activity in ${repo}`;
  }
}

async function fetchGitHubActivity(username) {
  const response = await fetch(`https://api.github.com/users/${username}/events/public?per_page=8`, {
    headers: {
      Accept: 'application/vnd.github+json'
    }
  });

  if (!response.ok) {
    throw new Error(`github feed failed for ${username}`);
  }

  const events = await response.json();

  if (!Array.isArray(events)) {
    return [];
  }

  return events.slice(0, 6).map((event) => ({
    source: `github:${username}`,
    text: formatGitHubEvent(event),
    at: parseDateOrNow(event.created_at),
    url: event?.repo?.name ? `https://github.com/${event.repo.name}` : `https://github.com/${username}`
  }));
}

async function fetchRssActivity(source) {
  const proxiedUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(source.url)}`;
  const response = await fetch(proxiedUrl);

  if (!response.ok) {
    throw new Error(`rss feed failed for ${source.label}`);
  }

  const xmlText = await response.text();
  const documentNode = new window.DOMParser().parseFromString(xmlText, 'text/xml');
  const parserError = documentNode.querySelector('parsererror');

  if (parserError) {
    throw new Error(`rss parse failed for ${source.label}`);
  }

  const items = Array.from(documentNode.querySelectorAll('item')).slice(0, 6);

  return items.map((item) => {
    const title = item.querySelector('title')?.textContent || 'new post';
    const pubDate = item.querySelector('pubDate')?.textContent;
    const link = item.querySelector('link')?.textContent || source.url;

    return {
      source: source.label,
      text: shortText(title, 88),
      at: parseDateOrNow(pubDate),
      url: link
    };
  });
}

function mergeAndSortFeed(items) {
  return [...items]
    .filter((item) => item && item.text)
    .sort((a, b) => b.at - a.at)
    .slice(0, 16);
}

async function fetchCombinedSebFeed() {
  const allTasks = [
    ...GITHUB_USERS.map((user) => fetchGitHubActivity(user)),
    ...SOCIAL_RSS_SOURCES.map((source) => fetchRssActivity(source))
  ];

  const settled = await Promise.allSettled(allTasks);

  const successful = settled
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value);

  const failedCount = settled.filter((result) => result.status === 'rejected').length;

  return {
    items: mergeAndSortFeed(successful),
    failedCount
  };
}

function useTruthfulHitCounter() {
  const [hits, setHits] = useState('loading...');

  useEffect(() => {
    const localKey = 'cbassuarez-local-hit-counter-fallback';

    const applyLocalFallback = () => {
      const current = Number(window.localStorage.getItem(localKey));
      const next = Number.isFinite(current) && current > 0 ? current + 1 : 1;
      window.localStorage.setItem(localKey, String(next));
      setHits(`${next} (local fallback)`);
    };

    const updateGlobalHits = async () => {
      try {
        const response = await fetch('https://api.countapi.xyz/hit/cbassuarez.com/landing-v1');

        if (!response.ok) {
          throw new Error('countapi request failed');
        }

        const data = await response.json();

        if (!Number.isFinite(data.value)) {
          throw new Error('invalid countapi payload');
        }

        setHits(String(data.value));
      } catch (error) {
        applyLocalFallback();
      }
    };

    updateGlobalHits();
  }, []);

  return hits;
}

function useSebFeed() {
  const [feedItems, setFeedItems] = useState(() =>
    FEED_FALLBACK.map((line) => ({
      source: 'boot',
      text: line,
      at: Date.now(),
      url: ''
    }))
  );
  const [feedMeta, setFeedMeta] = useState('syncing');

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
          return;
        }

        setFeedItems(result.items);

        if (result.failedCount > 0) {
          setFeedMeta(`partial sync (${result.failedCount} source${result.failedCount > 1 ? 's' : ''} failed)`);
        } else {
          setFeedMeta('live');
        }
      } catch (error) {
        if (active) {
          setFeedMeta('feed sync failed');
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
    feedMeta
  };
}

const ABOUT_MAN_OUTPUT = `whoami
  cbassuarez
  host:        Los Angeles, CA
  roles:       composer-performer · visual artist
  focus:       prepared-piano resonances; light as instrument
  upcoming:    Rings/Resonators; 25HUNDRED
  availability: commissions · installations · performances · talks

Commands: [ man about ] [ show picture ] [ get picture ]  [ works -t ]  [ press ]  [ cv ]  [ contact ]  [ now ]  [ random ]

type [show picture] to render portrait, or [get picture] to download
type [man about] for more   (or: about --long)

CBASSUAREZ(1)                     USER COMMANDS                     CBASSUAREZ(1)

NAME
    cbassuarez — composer-performer + visual artist

SYNOPSIS
    works -t | press | cv | contact | now | random

DESCRIPTION
    Composer-performer focused on prepared-piano resonances and
    spatial/industrial light as instrument. Projects span albums,
    installation, and research. Console site; type help for cmds.

LINKS
    Press kit : under construction
    CV        : (set DATA.meta.cv)
    Email     : contact@cbassuarez.com

HIGHLIGHTS
    2023–2025  CalArts HASOM Dean’s Discretionary Fund — 3× $2,000
    2024       Donors (Zeffy): $3,000 for 33 Strings; ~$500 in-kind
    2024       Google Ad Grants (in-kind): $120,000/yr (Dex DSL)
    2023       Peabody LAUNCH Grant: $5,000 (Dex DSL)
    2023       Alba Commission Competition — Award ($300)
    2022       Common Tone New Music Festival — Fellowship ($750)

GOVERNANCE
    2024–2025  Ethical Investment Committee, CalArts — drafted and
               ratified ESG policy with leadership and partners.

TEACHING
    2023       CalArts AiR Week — host: Pamela Z, Attah Poku,
               Ela Orleans, Cory Smythe, Yosvanny Terry; hosted finale.
    2025       HASOM Project Week — guest lecture (large-format works).

PROCESSES
    PID      TASK                     %CPU   STATE
    0001     rings/resonators mix     38.5   running
    0002     25HUNDRED                21.0   running
    0003     thesis edits             16.2   running
    0004     SyncTimer beta v0.7       9.4   sleeping

TREE
    .
    ├── music/          albums, scores
    ├── installations/  light, spatial works
    ├── research/       thesis, papers
    └── software/       SyncTimer

SEE ALSO
    Commands: [ man about ] [ show picture ] [ get picture ]  [ works -t ]  [ press ]  [ cv ]  [ contact ]  [ now ]  [ random ]`;

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

      <pre>{ABOUT_MAN_OUTPUT}</pre>
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
  const { feedItems, feedMeta } = useSebFeed();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [guestbook, setGuestbook] = useState(() => [
    { name: 'anonymous', message: 'cybernetic vibes' },
    { name: 'operator', message: 'connected rituals online' }
  ]);

  const marqueeText = useMemo(() => {
    const pieces = feedItems.slice(0, 6).map((item) => `${item.source}: ${item.text}`);

    if (pieces.length === 0) {
      return 'waiting for seb feed...';
    }

    return pieces.join(' /// ');
  }, [feedItems]);

  const submitGuestbook = (event) => {
    event.preventDefault();

    const cleanName = name.trim() || 'anonymous';
    const cleanMessage = message.trim();

    if (!cleanMessage) {
      return;
    }

    setGuestbook((current) => [{ name: cleanName, message: cleanMessage }, ...current].slice(0, 8));
    setName('');
    setMessage('');
  };

  return (
    <>
      <center>
        <h1>{SITE_DOMAIN}</h1>
        <p>
          <i>cybernetic artist homepage</i>
        </p>
        <p>
          <small>best viewed with no style sheet at 800x600</small>
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
                  <a href="#about">about</a>
                </li>
                <li>
                  <a href="/about">about (full page)</a>
                </li>
                <li>
                  <a href="#seb-feed">seb feed</a>
                </li>
                <li>
                  <a href="#guestbook">guestbook</a>
                </li>
                <li>
                  <a href="/works">works</a>
                </li>
              </ul>

              <h3>operator</h3>
              <p>{OPERATOR_NAME}</p>
              <p>hits: {hits}</p>

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

              <a id="seb-feed" />
              <h2>what is seb doing // live feed</h2>
              <pre>
                {feedItems
                  .slice(0, 12)
                  .map((item) => `[${stamp(item.at)}] ${item.source} -> ${item.text}`)
                  .join('\n')}
              </pre>
              <p>
                <small>feed sync: {feedMeta}</small>
              </p>
              <h3>latest links</h3>
              <ul>
                {feedItems.slice(0, 8).map((item, index) => (
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
              <p>
                <small>
                  sources: github public events + social rss ({GITHUB_USERS.join(', ')} /{' '}
                  {SOCIAL_RSS_SOURCES.map((source) => source.label).join(', ')})
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
          [ <a href="/works">works</a> ] [ <a href="/about">about</a> ] [ under construction ]
        </small>
      </center>
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

export default function App() {
  const pathname = window.location.pathname;
  const isWorksPage = window.location.pathname.startsWith('/works');
  const isAboutPage = window.location.pathname.startsWith('/about');
  const isLegacyWorksPage = /^\/labs\/works-list\/?$/i.test(pathname);

  if (isLegacyWorksPage) {
    return <LegacyWorksRedirect />;
  }

  if (isAboutPage) {
    return <AboutPage />;
  }

  if (isWorksPage) {
    return <WorksPage />;
  }

  return <HomePage />;
}
