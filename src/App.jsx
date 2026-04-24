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

const WORKS_ARCHIVE = [
  {
    id: 1,
    title: 'WORK 1 — String Quartet No. 2 “SOUNDNOISEMUSIC”',
    oneliner:
      'A through-composed/indeterminate quartet that alternates fixed score, structured mischief, and noise permissions.',
    description:
      'A large-scale quartet that toggles between rigor and chaos. Structured movements, improvisatory noise passages, and deliberate performer subversions are interleaved to question how fixed notation and indeterminate practice can coexist in chamber music.',
    audio: 'https://cdn.jsdelivr.net/gh/cbassuarez/website-blog/audio/SSS_soundnoisemusic_audio.mp3',
    score:
      'https://cdn.jsdelivr.net/gh/cbassuarez/website-blog/STRING%20QUARTET%20NO.%202%20_soundnoisemusic_%20-%20Score-min.pdf'
  },
  {
    id: 2,
    title: 'WORK 2 — Organum Quadruplum “Lux Nova”',
    oneliner:
      'A stained-glass acoustics study: bowed dalle-de-verre slab transduced into a ring of pianos—polyphony by distance rather than shared air.',
    description:
      'Organum Quadruplum reframed for glass and transducers. Light-conditioned harmonics from a dalle-de-verre slab are bowed, captured, and redistributed across a circle of pianos so the counterpoint arises from distance rather than shared resonance.',
    audio: 'https://cdn.jsdelivr.net/gh/cbassuarez/website-blog/audio/luxnova.mp3',
    score: ''
  },
  {
    id: 3,
    title: 'WORK 3 — AMPLIFICATIONS I · MARIMBAideefixe',
    oneliner:
      'Two prepared pianos as resonators for a 5.0-octave marimba: sympathetic “ghost ensemble” via transduction.',
    description:
      'Marimbaideefixe extends the marimba through dual prepared pianos acting as resonant bodies. Transduced sustain, bell resonances, and baroque-inflected improvisations blur solo and ensemble roles into a ghostly amplification ritual.',
    audio: 'https://cdn.jsdelivr.net/gh/cbassuarez/website-blog/audio/amplifications.mp3',
    score: 'https://cdn.jsdelivr.net/gh/cbassuarez/website-blog/AMPLIFICATIONS%201.%20MARIMBAideefixe.pdf'
  }
];

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

      <h1>ABOUT ME: SEB SUAREZ</h1>
      <p>
        <strong>Today’s first half (45 min)</strong> introduces who I am, what I make, and the values that
        shape this class. If you’re skimming, start with the <strong>Agenda</strong> and{' '}
        <strong>Three Works</strong>.
      </p>

      <hr />

      <h2>Agenda (45:00)</h2>
      <ol>
        <li>Welcome &amp; what to expect (2)</li>
        <li>Origin story &amp; positioning (6)</li>
        <li>Three works (12)</li>
        <li>Method: materials · systems · people (8)</li>
        <li>Live peek: /sounds (8)</li>
        <li>Why this class: culture &amp; expectations (9)</li>
      </ol>
      <p>
        Links we’ll reference: <a href="https://cbassuarez.com/#about">/about</a> ·{' '}
        <a href="https://cbassuarez.com/#ls/works">/works</a> ·{' '}
        <a href="https://cbassuarez.com/#ls/sounds">/sounds</a>
      </p>

      <hr />

      <h2>Welcome &amp; what to expect</h2>
      <p>
        Hi, I’m <strong>Sebastian Suárez-Solís</strong> — composer-performer and doctoral candidate at
        CalArts. My practice lives at the intersection of <strong>sound, light, and space</strong>. This
        course runs most weeks in <strong>two halves</strong>:
      </p>
      <ul>
        <li>Presentation: practice, process, critique</li>
        <li>Lecture: concepts, live demos, small exercises</li>
      </ul>
      <p>
        Today mirrors that structure: this page (About &amp; Practice) → then a Creative Coding
        Micro-Lecture.
      </p>

      <hr />

      <h2>Origin story &amp; positioning</h2>
      <ul>
        <li>
          I came to music through percussion and site-responsive sound, then expanded into lighting as
          instrument, browser-based tools, and public-facing libraries.
        </li>
        <li>
          I’m interested in monochromatic light for how it collapses color into shadows and textures,
          and in systems that audiences can read while they’re happening.
        </li>
        <li>
          I value clarity, generosity, specificity: we make the interaction legible, the stakes visible,
          and the critique useful.
        </li>
      </ul>
      <p>
        Thought to keep in mind: <em>How does light change how you hear a space?</em>
      </p>

      <hr />

      <h2>Three works (maps to course themes)</h2>
      <h3>1) CONSTRUCTIONS — light-and-sound as instrument</h3>
      <p>
        <strong>What:</strong> Oversized light sculptures (e.g., low-pressure sodium, ST64 incandescent),
        custom bases, and live manipulation.
      </p>
      <p>
        <strong>Why it matters here:</strong> Treats lighting as a time-based performance object; asks
        how city infrastructure can become chamber music.
      </p>
      <p>
        <strong>See:</strong> <a href="https://cbassuarez.com/#w/constructions">/works → Constructions</a>
      </p>
      <p>
        <strong>Themes:</strong> performance systems · audience agency · choreographing attention
      </p>

      <h3>2) Dex Digital Sample Library (DexDSL) — open access, CC-BY</h3>
      <p>
        <strong>What:</strong> A nonprofit sample library of beds, textures, instruments, plus residencies
        and education outreach.
      </p>
      <p>
        <strong>Why it matters here:</strong> Models public tooling, clean licensing, and sustainable open
        culture.
      </p>
      <p>
        <strong>See:</strong> <a href="https://dexdsl.com">/works → DexDSL</a>
      </p>
      <p>
        <strong>Themes:</strong> authorship · distribution · community infrastructure
      </p>

      <h3>3) Optics &amp; Photonics Music System — mapping sound ↔ light</h3>
      <p>
        <strong>What:</strong> A three-part system: (1) pitches mapped to visible wavelengths, (2)
        actuators controlling mirrors/filters, (3) a physical optics track.
      </p>
      <p>
        <strong>Why it matters here:</strong> Reframes orchestration as beam routing and spatial
        composition.
      </p>
      <p>
        <strong>Themes:</strong> mapping · embodiment · readable complexity
      </p>

      <hr />

      <h2>Method: materials · systems · people</h2>
      <p>
        <strong>Materials:</strong> streetlights, mirrors, acrylic prisms, carbon fiber, wood;
        microphones &amp; room acoustics; and the browser as instrument.
      </p>
      <p>
        <strong>Systems:</strong> minimal, audience-legible pipelines (signal flow you can point to);
        small, repeatable gestures; constraints that generate form.
      </p>
      <p>
        <strong>People:</strong> collaborators, guest artists, and you — students as co-designers.
      </p>
      <p>
        <strong>Anti-patterns we’ll avoid:</strong> invisible interactions, over-engineering, unclear
        goals.
      </p>

      <hr />

      <h2>Live peek: /sounds (what you’ll see/hear)</h2>
      <ul>
        <li>One short gesture: start → a single parameter sweep → stop (≈60–90 seconds).</li>
        <li>Point out what changes (e.g., filter cutoff) and where in the chain it lives.</li>
        <li>Goal: show how a web page can be a performance surface and a lab notebook.</li>
      </ul>
      <p>
        You’ll do your own small “gesture studies” later — not about being flashy, about being clear.
      </p>

      <hr />

      <h2>Why this class: culture &amp; expectations</h2>
      <ul>
        <li>Two halves, every week. Present (show process, invite critique) → Learn (concepts, demos).</li>
        <li>
          What I expect: show small, evolving work; give &amp; receive concrete feedback; write down what
          changed because of critique.
        </li>
        <li>
          How we talk: we name what is working, what is confusing, and one specific next step.
        </li>
        <li>
          What you can expect of me: direct feedback, practical tools, and time for your questions.
        </li>
      </ul>
      <p>
        <strong>
          You belong here if you’re curious about sound, light, systems, or simply like building things
          that others can feel in space.
        </strong>
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

      <h2>Praetorius Shell // Works Archive</h2>
      <p>
        This is a styleless static mirror of the `website-blog` works list, presented inside the new
        shell.
      </p>

      {WORKS_ARCHIVE.map((work) => (
        <article key={work.id}>
          <h3>{work.title}</h3>
          <p>{work.oneliner}</p>
          <p>{work.description}</p>
          <ul>
            <li>
              <a href={work.audio} target="_blank" rel="noreferrer">
                Audio
              </a>
            </li>
            {work.score ? (
              <li>
                <a href={work.score} target="_blank" rel="noreferrer">
                  Score (PDF)
                </a>
              </li>
            ) : null}
          </ul>
        </article>
      ))}
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
