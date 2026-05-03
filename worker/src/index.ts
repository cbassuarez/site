type FeedItem = {
  source: string;
  text: string;
  at: string;
  url?: string;
  media?: string;
  progressMs?: number;
  durationMs?: number;
  isPlaying?: boolean;
};

type CurrentActivity = {
  source: string;
  text: string;
  at: string;
  url?: string;
  isLive: boolean;
  ageLabel: string;
};

type SourceStatus = {
  status: "ok" | "missing_config" | "error";
  count: number;
  message?: string;
};

type GuestbookEntry = {
  name: string;
  message: string;
  at: string;
};

type SpotifyPlaybackState = {
  trackKey: string;
  trackName: string;
  trackUrl?: string;
  trackUri?: string;
  isPlaying: boolean;
  progressMs: number;
  durationMs: number;
  sessionStartedAt?: string;
  observedAt: string;
};

type RateLimitBinding = {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
};

type Env = {
  FEED_ALLOW_ORIGIN?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_ALLOWED_HOSTNAMES?: string;
  CONTACT_FORMSPREE_ENDPOINT?: string;
  HITS_KV?: KVNamespace;
  HITS_BASELINE?: string;
  GITHUB_USERNAME?: string;
  GITHUB_TOKEN?: string;
  BANDCAMP_DOMAIN?: string;
  IG_USER_ID?: string;
  IG_ACCESS_TOKEN?: string;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  SPOTIFY_REFRESH_TOKEN?: string;
  X_USERNAME?: string;
  X_BEARER_TOKEN?: string;
  YT_CHANNEL_ID?: string;
  YT_API_KEY?: string;
  CF_ZONE_ID?: string;
  CF_API_TOKEN?: string;
  CF_ANALYTICS_SINCE?: string;
  SITE_VERSION_URL?: string;
  SITE_REPO_URL?: string;
  RATE_LIMIT_FEED?: RateLimitBinding;
  RATE_LIMIT_HIT?: RateLimitBinding;
  RATE_LIMIT_GUESTBOOK_POST?: RateLimitBinding;
  RATE_LIMIT_CONTACT_POST?: RateLimitBinding;
  RATE_LIMIT_STRING_SOCKET?: RateLimitBinding;
  RATE_LIMIT_COROOM_SOCKET?: RateLimitBinding;
  STRING_ROOM: DurableObjectNamespace;
  CO_ROOM: DurableObjectNamespace;
};

type FeedSnapshot = {
  items: FeedItem[];
  sources: Record<string, SourceStatus>;
  generatedAt: string;
};

const FEED_SNAPSHOT_KEY = "feed:snapshot-v1";
const FEED_MAX_ITEMS = 500;
const FEED_EDGE_CACHE_SECONDS = 60;

// Surfaces the same site is reachable from. Emitted as a Link header on every
// worker response so anyone watching the network tab (or running `curl -i`)
// discovers them. Browsers silently ignore the non-HTTP rel/scheme values.
const DISCOVERY_LINK_HEADER = [
  '<https://cbassuarez.com/.well-known/cli-letter.txt>; rel="alternate"; type="text/plain"',
  '<ssh://ssh.cbassuarez.com>; rel="alternate"',
  '<gemini://gemini.cbassuarez.com>; rel="alternate"',
  '<https://cbassuarez.com/humans.txt>; rel="author"',
].join(", ");

const jsonHeaders = (origin: string) => ({
  "access-control-allow-origin": origin,
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  link: DISCOVERY_LINK_HEADER,
});

const clean = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const stripTags = (value: string) => value.replace(/<[^>]+>/g, "");
const toNonNegativeInt = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.floor(parsed);
  return rounded >= 0 ? rounded : null;
};

const short = (value: unknown, max = 120) => {
  const text = clean(value);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

const sourceBase = (source: unknown) => clean(source).toLowerCase().split(":")[0] || "feed";
const parseFeedTimeMs = (value: unknown) => {
  const ms = new Date(clean(value)).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const normalizeIsoAt = (value: unknown): string | null => {
  const ms = parseFeedTimeMs(value);
  return ms > 0 ? new Date(ms).toISOString() : null;
};

const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
const CONTACT_TURNSTILE_ACTION = "contact_form_v1";
const CONTACT_EMAIL_REGEX = /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])$/i;
const CONTACT_ALLOWED_TOPICS = new Set(["commission", "performance", "collab", "press", "other"]);
const CONTACT_BLOCKED_LOCAL_PARTS = new Set([
  "a",
  "aa",
  "test",
  "testing",
  "asdf",
  "qwerty",
  "user",
  "admin",
  "none",
  "na",
  "n/a",
]);
const CONTACT_BLOCKED_DOMAINS = new Set([
  "example.com",
  "test.com",
  "localhost",
  "mailinator.com",
  "tempmail.com",
  "fake.com",
]);

type ContactSubmission = {
  name: string;
  email: string;
  subject: string;
  topic: string;
  timeSensitive: boolean;
  message: string;
  turnstileToken: string;
};

function parseSpotifyEvent(text: string): { action: string; label: string } {
  const cleaned = clean(text);
  const match = cleaned.match(/^(now playing|played|last played|resumed|paused):\s*(.+)$/i);
  if (!match) {
    return { action: "other", label: cleaned.toLowerCase() };
  }
  return { action: clean(match[1]).toLowerCase(), label: clean(match[2]).toLowerCase() };
}

function spotifyLabelRaw(text: string): string {
  const cleaned = clean(text);
  const match = cleaned.match(/^(?:now playing|played|last played|resumed|paused):\s*(.+)$/i);
  return clean(match?.[1] || cleaned);
}

function withSpotifyAction(item: FeedItem, action: "now playing" | "paused" | "played"): FeedItem {
  const label = spotifyLabelRaw(item.text);
  return {
    ...item,
    text: `${action}: ${label}`,
    isPlaying: action === "now playing",
  };
}

function sanitizeSpotifyTimeline(items: FeedItem[]): FeedItem[] {
  const newestFirst = [...items].sort((a, b) => parseFeedTimeMs(b.at) - parseFeedTimeMs(a.at));
  const kept: FeedItem[] = [];

  const seenSessionKeys = new Set<string>();
  const seenBurstKeys = new Set<string>();
  let seenNewestSpotifyState = false;

  for (const item of newestFirst) {
    if (sourceBase(item.source) !== "spotify") {
      kept.push(item);
      continue;
    }

    const atMs = parseFeedTimeMs(item.at);
    const { action, label } = parseSpotifyEvent(item.text);
    const trackKey = clean(item.media || item.url || label);

    if (!trackKey) {
      kept.push(item);
      continue;
    }

    if (action === "last played" || action === "played") {
      continue;
    }

    if (action === "now playing" || action === "resumed" || action === "paused") {
      if (action === "now playing" && item.isPlaying === false) continue;
      const progressBucket = Math.round((toNonNegativeInt(item.progressMs) || 0) / 3000);
      const timeBucket = Math.round(atMs / 90000);
      const burstKey = `burst:${trackKey}:${action}:${progressBucket}:${timeBucket}`;
      if (seenBurstKeys.has(burstKey)) continue;
      seenBurstKeys.add(burstKey);

      const sessionKey = `play:${trackKey}:${clean(item.at)}`;
      if (seenSessionKeys.has(sessionKey)) continue;
      seenSessionKeys.add(sessionKey);

      if (action === "paused") {
        seenNewestSpotifyState = true;
        kept.push(withSpotifyAction(item, "paused"));
        continue;
      }

      if (!seenNewestSpotifyState && item.isPlaying !== false) {
        kept.push(withSpotifyAction(item, "now playing"));
        seenNewestSpotifyState = true;
      } else {
        seenNewestSpotifyState = true;
        kept.push(withSpotifyAction(item, "played"));
      }
      continue;
    }

    kept.push(item);
  }

  return kept.sort((a, b) => parseFeedTimeMs(b.at) - parseFeedTimeMs(a.at));
}

function timelineIdentity(item: FeedItem): string {
  if (sourceBase(item.source) !== "spotify") {
    return `${item.source}|${item.at}|${item.url || ""}|${item.text}`;
  }

  const { label } = parseSpotifyEvent(item.text);
  const trackKey = clean(item.media || item.url || label);
  const atKey = clean(item.at);
  return `spotify|${trackKey}|${atKey}`;
}

function formatAgeLabel(msAgo: number): string {
  if (!Number.isFinite(msAgo) || msAgo < 0) return "just now";
  const minutes = Math.floor(msAgo / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function selectCurrentActivity(items: FeedItem[], nowMs = Date.now()): CurrentActivity | null {
  if (!Array.isArray(items) || items.length === 0) return null;

  const ordered = items
    .filter((item) => clean(item?.text).length > 0)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  if (ordered.length === 0) return null;

  const isRecent = (item: FeedItem, windowMs = 10 * 60 * 1000) => {
    const atMs = new Date(item.at).getTime();
    return Number.isFinite(atMs) && nowMs - atMs <= windowMs;
  };

  const build = (item: FeedItem, isLive: boolean): CurrentActivity => {
    const atMs = new Date(item.at).getTime();
    const ageLabel = isLive ? "live now" : formatAgeLabel(nowMs - atMs);
    return {
      source: clean(item.source || "feed"),
      text: clean(item.text),
      at: clean(item.at || new Date(nowMs).toISOString()),
      url: clean(item.url || "") || undefined,
      isLive,
      ageLabel,
    };
  };

  const latestSpotify = ordered.find((item) => sourceBase(item.source) === "spotify");
  if (latestSpotify && Boolean(latestSpotify.isPlaying)) return build(latestSpotify, true);

  const instagramLive = ordered.find((item) => sourceBase(item.source) === "instagram" && isRecent(item));
  if (instagramLive) return build(instagramLive, true);

  const githubLive = ordered.find((item) => sourceBase(item.source) === "github" && isRecent(item));
  if (githubLive) return build(githubLive, true);

  const bandcampLive = ordered.find((item) => sourceBase(item.source) === "bandcamp" && isRecent(item));
  if (bandcampLive) return build(bandcampLive, true);

  return build(ordered[0], false);
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText} :: ${body.slice(0, 240)}`);
  }
  return response.json();
}

async function fetchGitHub(env: Env, limit: number): Promise<FeedItem[]> {
  const username = clean(env.GITHUB_USERNAME || "cbassuarez");
  if (!username) return [];

  const response = await fetch(`https://github.com/${encodeURIComponent(username)}.atom`);
  if (!response.ok) {
    throw new Error(`github atom ${response.status}`);
  }
  const xml = await response.text();
  const items: FeedItem[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(xml)) && items.length < limit) {
    const block = match[1];
    const title = short(decodeHtml(clean((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")), 108);
    const link = clean((block.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || "");
    const updated = clean((block.match(/<updated>([\s\S]*?)<\/updated>/i) || [])[1] || "");
    if (!title) continue;
    items.push({
      source: `github:${username}`,
      text: title,
      at: updated || new Date().toISOString(),
      url: link || `https://github.com/${username}`,
    });
  }
  return items;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function fetchBandcamp(env: Env, limit: number): Promise<FeedItem[]> {
  const domain = clean(env.BANDCAMP_DOMAIN || "cbassuarez.bandcamp.com");
  if (!domain) return [];

  const response = await fetch(`https://${domain}/music`, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`bandcamp ${response.status}`);
  }

  const html = await response.text();
  const items: FeedItem[] = [];

  const itemRegex =
    /<li[^>]*class="[^"]*music-grid-item[^"]*"[\s\S]*?<a href="([^"]+)"[\s\S]*?<p class="title">\s*([\s\S]*?)\s*<\/p>/gi;

  let match: RegExpExecArray | null;
  const releases: Array<{ title: string; url: string }> = [];
  while ((match = itemRegex.exec(html)) && releases.length < limit) {
    const href = clean(match[1]);
    const title = short(stripTags(decodeHtml(clean(match[2]))), 96);
    if (!href || !title) continue;
    releases.push({
      title,
      url: href.startsWith("http") ? href : `https://${domain}${href}`,
    });
  }

  async function fetchBandcampPublishedAt(url: string): Promise<string | null> {
    const parseDateFromHtml = (releaseHtml: string): string | null => {
      const datePublishedRaw = clean((releaseHtml.match(/"datePublished"\s*:\s*"([^"]+)"/i) || [])[1] || "");
      if (datePublishedRaw) {
        const ts = Date.parse(datePublishedRaw);
        if (Number.isFinite(ts)) return new Date(ts).toISOString();
      }

      const pubDateMeta = clean(
        (releaseHtml.match(/<meta[^>]+property="og:pubdate"[^>]+content="([^"]+)"/i) || [])[1] || ""
      );
      if (pubDateMeta) {
        const ts = Date.parse(pubDateMeta);
        if (Number.isFinite(ts)) return new Date(ts).toISOString();
      }

      const descriptionMeta = clean((releaseHtml.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i) || [])[1] || "");
      const releasedInDescription = clean((descriptionMeta.match(/\breleased\s+(\d{1,2}\s+\w+\s+\d{4})/i) || [])[1] || "");
      if (releasedInDescription) {
        const ts = Date.parse(releasedInDescription);
        if (Number.isFinite(ts)) return new Date(ts).toISOString();
      }

      return null;
    };

    const candidates = [`${url}?output=1`, url];
    for (const target of candidates) {
      const releaseResponse = await fetch(target, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
        },
      });
      if (!releaseResponse.ok) continue;
      const parsed = parseDateFromHtml(await releaseResponse.text());
      if (parsed) return parsed;
    }

    return null;
  }

  const detailed = await Promise.all(
    releases.map(async (release) => {
      const at = await fetchBandcampPublishedAt(release.url);
      if (!at) return null;
      return {
        source: "bandcamp",
        text: `release: ${release.title}`,
        at,
        url: release.url,
      } as FeedItem;
    })
  );

  for (const row of detailed) {
    if (row) items.push(row);
  }

  return items;
}

async function fetchInstagram(env: Env, limit: number): Promise<FeedItem[]> {
  const userId = clean(env.IG_USER_ID);
  const token = clean(env.IG_ACCESS_TOKEN);
  if (!userId || !token) return [];

  const query = `fields=id,caption,media_type,permalink,timestamp,media_url&limit=${Math.min(limit, 100)}&access_token=${encodeURIComponent(
    token
  )}`;

  let data: any;
  try {
    data = await fetchJson(`https://graph.facebook.com/v23.0/${encodeURIComponent(userId)}/media?${query}`);
  } catch {
    data = await fetchJson(`https://graph.instagram.com/${encodeURIComponent(userId)}/media?${query}`);
  }

  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows.slice(0, limit).map((post: any) => ({
    source: "instagram",
    text: short(post?.caption || `new ${clean(post?.media_type || "post").toLowerCase()}`, 110),
    at: post?.timestamp || new Date().toISOString(),
    url: clean(post?.permalink),
    media: clean(post?.media_url),
  }));
}

async function readSpotifyPlaybackState(env: Env): Promise<SpotifyPlaybackState | null> {
  const kv = env.HITS_KV;
  if (!kv) return null;

  const raw = await kv.get("feed:spotify-state-v1");
  if (!raw) return null;

  try {
    const parsed: any = JSON.parse(raw);
    const observedAt = clean(parsed?.observedAt);
    const trackKey = clean(parsed?.trackKey);
    if (!observedAt && !trackKey) return null;

    return {
      trackKey,
      trackName: clean(parsed?.trackName),
      trackUrl: clean(parsed?.trackUrl) || undefined,
      trackUri: clean(parsed?.trackUri) || undefined,
      isPlaying: Boolean(parsed?.isPlaying),
      progressMs: Number.isFinite(parsed?.progressMs) ? parsed.progressMs : 0,
      durationMs: Number.isFinite(parsed?.durationMs) ? parsed.durationMs : 0,
      sessionStartedAt: clean(parsed?.sessionStartedAt) || undefined,
      observedAt: observedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function writeSpotifyPlaybackState(env: Env, state: SpotifyPlaybackState): Promise<void> {
  const kv = env.HITS_KV;
  if (!kv) return;
  await kv.put("feed:spotify-state-v1", JSON.stringify(state));
}

async function fetchSpotify(env: Env): Promise<FeedItem[]> {
  const clientId = clean(env.SPOTIFY_CLIENT_ID);
  const clientSecret = clean(env.SPOTIFY_CLIENT_SECRET);
  const refreshToken = clean(env.SPOTIFY_REFRESH_TOKEN);
  if (!clientId || !clientSecret || !refreshToken) return [];

  const auth = btoa(`${clientId}:${clientSecret}`);
  const tokenBody = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: tokenBody.toString(),
  });

  if (!tokenResponse.ok) {
    throw new Error(`spotify token ${tokenResponse.status}`);
  }

  const tokenData = (await tokenResponse.json()) as { access_token?: string };
  const accessToken = clean(tokenData.access_token);
  if (!accessToken) return [];

  const headers = { authorization: `Bearer ${accessToken}` };
  const current = await fetch("https://api.spotify.com/v1/me/player/currently-playing", { headers });
  const previousState = await readSpotifyPlaybackState(env);

  const items: FeedItem[] = [];
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (current.status === 200) {
    const payload: any = await current.json();
    const track = payload?.item;
    if (track) {
      const artists = Array.isArray(track?.artists)
        ? track.artists.map((artist: any) => clean(artist?.name)).filter(Boolean).join(", ")
        : "";
      const name = clean(track?.name);
      const url = clean(track?.external_urls?.spotify || "");
      const uri = clean(track?.uri || "");
      const trackLabel = `${artists}${artists && name ? " — " : ""}${name}`;
      const trackKey = clean(uri || url || trackLabel);
      const isPlaying = Boolean(payload?.is_playing);
      const progressMs = Number.isFinite(payload?.progress_ms) ? payload.progress_ms : 0;
      const durationMs = Number.isFinite(track?.duration_ms) ? track.duration_ms : 0;
      const startedAtMs = Math.max(0, nowMs - Math.max(0, progressMs));
      const startedAtIso = new Date(startedAtMs).toISOString();
      const sameTrack = previousState?.trackKey === trackKey && trackKey.length > 0;
      const sessionStartedAt = sameTrack
        ? clean(previousState?.sessionStartedAt) || startedAtIso
        : startedAtIso;
      const statusPrefix = isPlaying ? "now playing" : "paused";

      items.push({
        source: "spotify",
        text: `${statusPrefix}: ${trackLabel}`,
        at: sessionStartedAt,
        url: url || undefined,
        media: uri || undefined,
        progressMs,
        durationMs,
        isPlaying,
      });

      await writeSpotifyPlaybackState(env, {
        trackKey,
        trackName: trackLabel,
        trackUrl: url || undefined,
        trackUri: uri || undefined,
        isPlaying,
        progressMs,
        durationMs,
        sessionStartedAt,
        observedAt: nowIso,
      });
    }
  } else if (current.status === 204) {
    if (previousState?.trackName && previousState?.sessionStartedAt) {
      items.push({
        source: "spotify",
        text: `paused: ${previousState.trackName}`,
        at: previousState.sessionStartedAt,
        url: previousState.trackUrl,
        media: previousState.trackUri,
        progressMs: previousState.progressMs || 0,
        durationMs: previousState.durationMs || 0,
        isPlaying: false,
      });
      await writeSpotifyPlaybackState(env, {
        ...previousState,
        isPlaying: false,
        observedAt: nowIso,
      });
    }
  }

  return items;
}

async function fetchX(env: Env, limit: number): Promise<FeedItem[]> {
  const username = clean(env.X_USERNAME);
  const bearer = clean(env.X_BEARER_TOKEN);
  if (!username || !bearer) return [];

  const headers = { authorization: `Bearer ${bearer}` };
  const userData: any = await fetchJson(
    `https://api.twitter.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=id`,
    { headers }
  );

  const userId = clean(userData?.data?.id);
  if (!userId) return [];

  const tweetsData: any = await fetchJson(
    `https://api.twitter.com/2/users/${encodeURIComponent(
      userId
    )}/tweets?exclude=retweets,replies&max_results=${Math.min(limit, 100)}&tweet.fields=created_at`,
    { headers }
  );

  const rows = Array.isArray(tweetsData?.data) ? tweetsData.data : [];
  return rows.slice(0, limit).map((tweet: any) => ({
    source: `x:${username}`,
    text: short(tweet?.text, 120),
    at: tweet?.created_at || new Date().toISOString(),
    url: `https://x.com/${username}/status/${clean(tweet?.id)}`,
  }));
}

async function fetchYouTube(env: Env, limit: number): Promise<FeedItem[]> {
  const apiKey = clean(env.YT_API_KEY);
  const channelId = clean(env.YT_CHANNEL_ID);
  if (!apiKey || !channelId) return [];

  const data: any = await fetchJson(
    `https://www.googleapis.com/youtube/v3/search?key=${encodeURIComponent(apiKey)}&channelId=${encodeURIComponent(
      channelId
    )}&part=snippet,id&order=date&maxResults=${Math.min(limit, 50)}`
  );

  const rows = Array.isArray(data?.items) ? data.items : [];
  return rows
    .filter((row: any) => row?.id?.videoId)
    .slice(0, limit)
    .map((video: any) => ({
      source: "youtube",
      text: short(video?.snippet?.title || "new upload", 120),
      at: video?.snippet?.publishedAt || new Date().toISOString(),
      url: `https://www.youtube.com/watch?v=${video.id.videoId}`,
    }));
}

async function incrementHitCount(env: Env): Promise<number> {
  const kv = env.HITS_KV;
  if (!kv) {
    throw new Error("hits kv missing");
  }

  const deltaKey = "hits:delta-v2";

  const resolveCloudflareBaseline = async () => {
    const zoneId = clean(env.CF_ZONE_ID);
    const token = clean(env.CF_API_TOKEN);
    if (!zoneId || !token) return null;

    const sinceDay = clean(env.CF_ANALYTICS_SINCE || "");
    const defaultSince = "2020-01-01";
    const startDay = /^\d{4}-\d{2}-\d{2}$/.test(sinceDay) ? sinceDay : defaultSince;
    const toIsoDay = (date: Date) => date.toISOString().slice(0, 10);
    const addDaysUtc = (date: Date, days: number) => {
      const next = new Date(date);
      next.setUTCDate(next.getUTCDate() + days);
      return next;
    };

    const today = new Date();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const earliestAvailable = addDaysUtc(todayUtc, -364);
    let cursor = new Date(`${startDay}T00:00:00Z`);
    if (Number.isNaN(cursor.getTime())) {
      cursor = new Date(`${defaultSince}T00:00:00Z`);
    }
    if (cursor.getTime() < earliestAvailable.getTime()) {
      cursor = earliestAvailable;
    }

    const query =
      "query($zoneTag: string, $since: Date, $until: Date){ viewer { zones(filter: { zoneTag: $zoneTag }) { httpRequests1dGroups(filter: { date_geq: $since, date_leq: $until }, limit: 400) { sum { pageViews } } } } }";

    let totalPageViews = 0;
    while (cursor.getTime() <= todayUtc.getTime()) {
      const chunkEnd = addDaysUtc(cursor, 363);
      const until = chunkEnd.getTime() > todayUtc.getTime() ? todayUtc : chunkEnd;
      const body = JSON.stringify({
        query,
        variables: {
          zoneTag: zoneId,
          since: toIsoDay(cursor),
          until: toIsoDay(until),
        },
      });

      const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body,
      });

      if (!response.ok) {
        throw new Error(`cloudflare graphql ${response.status}`);
      }

      const payload: any = await response.json();
      if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
        const firstError = clean(payload.errors[0]?.message || "cloudflare graphql error");
        throw new Error(firstError);
      }

      const groups = payload?.data?.viewer?.zones?.[0]?.httpRequests1dGroups;
      if (Array.isArray(groups)) {
        for (const group of groups) {
          const pageViews = toNonNegativeInt(group?.sum?.pageViews) ?? 0;
          totalPageViews += pageViews;
        }
      }

      cursor = addDaysUtc(until, 1);
    }

    return totalPageViews;
  };

  let baseline = toNonNegativeInt(env.HITS_BASELINE);
  if (baseline === null) {
    try {
      baseline = await resolveCloudflareBaseline();
    } catch {
      baseline = 0;
    }
  }

  const deltaRaw = await kv.get(deltaKey);
  const delta = toNonNegativeInt(deltaRaw) ?? 0;
  const nextDelta = delta + 1;
  await kv.put(deltaKey, String(nextDelta));
  return baseline + nextDelta;
}

async function readGuestbookEntries(env: Env): Promise<GuestbookEntry[]> {
  const kv = env.HITS_KV;
  if (!kv) {
    throw new Error("guestbook kv missing");
  }

  const raw = await kv.get("guestbook:entries-v1");
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];
  const rows = parsed
    .map((item: any) => ({
      name: clean(item?.name).slice(0, 48),
      message: clean(item?.message).slice(0, 280),
      at: clean(item?.at) || new Date().toISOString(),
    }))
    .filter((item: GuestbookEntry) => item.message.length > 0);

  return rows;
}

async function writeGuestbookEntries(env: Env, entries: GuestbookEntry[]): Promise<void> {
  const kv = env.HITS_KV;
  if (!kv) {
    throw new Error("guestbook kv missing");
  }
  await kv.put("guestbook:entries-v1", JSON.stringify(entries));
}

async function hashGuestbookSigner(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`gb-signer-v1:${ip}`);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hasGuestbookSignature(env: Env, ip: string): Promise<boolean> {
  const kv = env.HITS_KV;
  if (!kv) return false;
  const hash = await hashGuestbookSigner(ip);
  return (await kv.get(`guestbook:signer:${hash}`)) !== null;
}

async function recordGuestbookSignature(env: Env, ip: string): Promise<void> {
  const kv = env.HITS_KV;
  if (!kv) return;
  const hash = await hashGuestbookSigner(ip);
  await kv.put(`guestbook:signer:${hash}`, new Date().toISOString());
}

type StringPluck = {
  x: number;
  y: number;
  t: number;
  who: string;
  force: number;
  pull: number;
  speed: number;
  width: number;
  sign: 1 | -1;
};
type StringCursor = { x: number; t: number; who: string };

const STRING_PLUCK_WINDOW_MS = 90_000;
const STRING_CURSOR_WINDOW_MS = 5_000;
const STRING_PLUCK_MAX = 200;
const STRING_CURSOR_MAX = 64;
const STRING_INCOMING_MAX_BYTES = 1024;
const STRING_PLUCK_RATE_CAPACITY = 6;
const STRING_PLUCK_RATE_REFILL_PER_SEC = 4;
const STRING_CURSOR_RATE_CAPACITY = 30;
const STRING_CURSOR_RATE_REFILL_PER_SEC = 30;
const STRING_PERSIST_DEBOUNCE_MS = 5_000;
const STRING_ALARM_INTERVAL_MS = 30_000;
const STRING_ROOM_NAME = "string:room-v1";
const STRING_PERSISTED_PLUCKS_KEY = "plucks-v1";

const clamp01 = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
};

async function hashStringWho(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`string-who-v1:${ip}`);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer))
    .slice(0, 6)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

interface SocketAttachment {
  who: string;
  joinedAt: number;
  lastSeenAt: number;
  pluckTokens: number;
  pluckLast: number;
  cursorTokens: number;
  cursorLast: number;
}

function consumeToken(
  attachment: SocketAttachment,
  kind: "pluck" | "cursor",
  now: number,
  capacity: number,
  refillPerSec: number
): boolean {
  const tokensField = kind === "pluck" ? "pluckTokens" : "cursorTokens";
  const lastField = kind === "pluck" ? "pluckLast" : "cursorLast";
  const elapsedSec = Math.max(0, (now - attachment[lastField]) / 1000);
  const refilled = Math.min(capacity, attachment[tokensField] + elapsedSec * refillPerSec);
  attachment[lastField] = now;
  if (refilled < 1) {
    attachment[tokensField] = refilled;
    return false;
  }
  attachment[tokensField] = refilled - 1;
  return true;
}

function readAttachment(ws: WebSocket): SocketAttachment | null {
  try {
    const value = ws.deserializeAttachment();
    if (!value || typeof value !== "object") return null;
    const att = value as SocketAttachment;
    if (typeof att.who !== "string" || att.who.length === 0) return null;
    return att;
  } catch {
    return null;
  }
}

export class StringRoom {
  private readonly state: DurableObjectState;
  private readonly env: Env;
  private plucks: StringPluck[] = [];
  private cursors: Map<string, StringCursor> = new Map();
  private persistDirty = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    void this.state.blockConcurrencyWhile(async () => {
      try {
        const persisted = await this.state.storage.get<StringPluck[]>(STRING_PERSISTED_PLUCKS_KEY);
        if (Array.isArray(persisted)) {
          const cutoff = Date.now() - STRING_PLUCK_WINDOW_MS;
          this.plucks = persisted
            .filter((p) => p && Number.isFinite(p.t) && p.t >= cutoff)
            .slice(-STRING_PLUCK_MAX);
        }
      } catch {
        this.plucks = [];
      }
      // Reattach to any sockets that survived hibernation by topping up their
      // token buckets so reactivated clients aren't immediately throttled.
      const now = Date.now();
      for (const ws of this.state.getWebSockets()) {
        const att = readAttachment(ws);
        if (!att) continue;
        att.pluckTokens = STRING_PLUCK_RATE_CAPACITY;
        att.pluckLast = now;
        att.cursorTokens = STRING_CURSOR_RATE_CAPACITY;
        att.cursorLast = now;
        try {
          ws.serializeAttachment(att);
        } catch {
          // ignore: closed sockets get cleaned up by the runtime
        }
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.endsWith("/socket")) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    const upgrade = request.headers.get("upgrade") || "";
    if (upgrade.toLowerCase() !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }

    const claimed = clean(url.searchParams.get("who")).toLowerCase();
    const seed =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "anon";
    const who = /^[0-9a-f]{6,16}$/i.test(claimed) ? claimed : await hashStringWho(seed);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const now = Date.now();
    const attachment: SocketAttachment = {
      who,
      joinedAt: now,
      lastSeenAt: now,
      pluckTokens: STRING_PLUCK_RATE_CAPACITY,
      pluckLast: now,
      cursorTokens: STRING_CURSOR_RATE_CAPACITY,
      cursorLast: now,
    };
    server.serializeAttachment(attachment);
    this.state.acceptWebSocket(server);

    this.pruneExpired(now);
    const recentCursors = [...this.cursors.values()].filter((c) => c.t >= now - STRING_CURSOR_WINDOW_MS);
    try {
      server.send(
        JSON.stringify({
          type: "hello",
          who,
          serverNow: now,
          plucks: this.plucks,
          cursors: recentCursors,
        })
      );
    } catch {
      // already disconnected; runtime cleans up
    }

    this.broadcast(JSON.stringify({ type: "join", who, t: now }), server);
    void this.scheduleMaintenanceAlarm();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    if (raw.length === 0 || raw.length > STRING_INCOMING_MAX_BYTES) return;
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const att = readAttachment(ws);
    if (!att) return;

    const now = Date.now();
    att.lastSeenAt = now;
    const type = String(parsed.type || "");

    if (type === "pluck") {
      if (!consumeToken(att, "pluck", now, STRING_PLUCK_RATE_CAPACITY, STRING_PLUCK_RATE_REFILL_PER_SEC)) {
        ws.serializeAttachment(att);
        return;
      }
      const pluck: StringPluck = {
        who: att.who,
        t: now,
        x: clamp01(parsed.x),
        y: clamp01(parsed.y),
        force: clamp01(parsed.force),
        pull: clamp01(parsed.pull),
        speed: clamp01(parsed.speed),
        width: clamp01(parsed.width),
        sign: Number(parsed.sign) < 0 ? -1 : 1,
      };
      this.plucks.push(pluck);
      const cutoff = now - STRING_PLUCK_WINDOW_MS;
      if (this.plucks.length > STRING_PLUCK_MAX || (this.plucks[0] && this.plucks[0].t < cutoff)) {
        this.plucks = this.plucks.filter((p) => p.t >= cutoff).slice(-STRING_PLUCK_MAX);
      }
      this.persistDirty = true;
      void this.scheduleMaintenanceAlarm();
      this.broadcast(JSON.stringify({ type: "pluck", ...pluck }), ws);
      ws.serializeAttachment(att);
      return;
    }

    if (type === "cursor") {
      if (!consumeToken(att, "cursor", now, STRING_CURSOR_RATE_CAPACITY, STRING_CURSOR_RATE_REFILL_PER_SEC)) {
        ws.serializeAttachment(att);
        return;
      }
      const cursor: StringCursor = {
        who: att.who,
        t: now,
        x: clamp01(parsed.x),
      };
      this.cursors.set(att.who, cursor);
      if (this.cursors.size > STRING_CURSOR_MAX) {
        // drop the oldest tracked cursor to bound memory
        let oldestWho: string | null = null;
        let oldestT = Infinity;
        for (const [w, c] of this.cursors) {
          if (c.t < oldestT) {
            oldestT = c.t;
            oldestWho = w;
          }
        }
        if (oldestWho && oldestWho !== att.who) this.cursors.delete(oldestWho);
      }
      this.broadcast(JSON.stringify({ type: "cursor", ...cursor }), ws);
      ws.serializeAttachment(att);
      return;
    }

    if (type === "ping") {
      try {
        ws.send(JSON.stringify({ type: "pong", t: now }));
      } catch {
        // ignore
      }
      ws.serializeAttachment(att);
      return;
    }
  }

  webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    this.handleDeparture(ws);
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    this.handleDeparture(ws);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    this.pruneExpired(now);
    if (this.persistDirty) {
      try {
        await this.state.storage.put(STRING_PERSISTED_PLUCKS_KEY, this.plucks);
        this.persistDirty = false;
      } catch {
        // observability surfaces the failure; retry on next alarm
      }
    } else if (this.plucks.length === 0) {
      try {
        await this.state.storage.delete(STRING_PERSISTED_PLUCKS_KEY);
      } catch {
        // ignore
      }
    }
    if (this.state.getWebSockets().length > 0 || this.persistDirty || this.cursors.size > 0) {
      try {
        await this.state.storage.setAlarm(Date.now() + STRING_ALARM_INTERVAL_MS);
      } catch {
        // ignore alarm scheduling failure
      }
    }
  }

  private handleDeparture(ws: WebSocket): void {
    const att = readAttachment(ws);
    if (!att) return;
    const stillPresent = this.state.getWebSockets().some((other) => {
      if (other === ws) return false;
      const otherAtt = readAttachment(other);
      return Boolean(otherAtt && otherAtt.who === att.who);
    });
    if (stillPresent) return;
    this.cursors.delete(att.who);
    this.broadcast(JSON.stringify({ type: "leave", who: att.who, t: Date.now() }), ws);
  }

  private broadcast(message: string, exclude?: WebSocket): void {
    for (const ws of this.state.getWebSockets()) {
      if (ws === exclude) continue;
      try {
        ws.send(message);
      } catch {
        // socket dead; runtime will reap
      }
    }
  }

  private pruneExpired(now: number): void {
    const pluckCutoff = now - STRING_PLUCK_WINDOW_MS;
    if (this.plucks.length > 0 && this.plucks[0].t < pluckCutoff) {
      const before = this.plucks.length;
      this.plucks = this.plucks.filter((p) => p.t >= pluckCutoff).slice(-STRING_PLUCK_MAX);
      if (this.plucks.length !== before) this.persistDirty = true;
    }
    const cursorCutoff = now - STRING_CURSOR_WINDOW_MS;
    for (const [who, cursor] of this.cursors) {
      if (cursor.t < cursorCutoff) this.cursors.delete(who);
    }
  }

  private async scheduleMaintenanceAlarm(): Promise<void> {
    try {
      const existing = await this.state.storage.getAlarm();
      if (existing != null) return;
      const target = Date.now() + STRING_PERSIST_DEBOUNCE_MS;
      await this.state.storage.setAlarm(target);
    } catch {
      // ignore: best-effort scheduling
    }
  }
}

// ---------- co-presence room (the back of /404) ----------

type CoRoomMember = { who: string; joinedAt: number; location: string };
type CoRoomLogEntry = {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  peak: number;
  // Distinct participants who passed through this instance, with last-known location.
  members: Array<{ who: string; location: string }>;
};

const COROOM_NAME = "coroom:room-v1";
const COROOM_LOG_KEY = "log-v1";
const COROOM_LOG_MAX = 200;
const COROOM_LEAVE_GRACE_MS = 4_000;
const COROOM_INCOMING_MAX_BYTES = 256;
// Accept legacy 12-hex IDs *and* UUID v4 with or without dashes.
const COROOM_WHO_REGEX = /^[0-9a-f]{8,12}$|^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CoRoomAttachment {
  who: string;
  joinedAt: number;
  lastSeenAt: number;
  location: string;
}

function deriveCfLocation(request: Request): string {
  const cf = (request as any).cf || {};
  const city = clean(cf.city || "");
  const region = clean(cf.region || cf.regionCode || "");
  const country = clean(cf.country || "");
  const head = city || region || "";
  if (head && country) return `${head}, ${country}`;
  return head || country || "";
}

function readCoRoomAttachment(ws: WebSocket): CoRoomAttachment | null {
  try {
    const value = ws.deserializeAttachment();
    if (!value || typeof value !== "object") return null;
    const att = value as CoRoomAttachment;
    if (typeof att.who !== "string" || att.who.length === 0) return null;
    return att;
  } catch {
    return null;
  }
}

export class CoRoom {
  private readonly state: DurableObjectState;
  private readonly env: Env;
  private log: CoRoomLogEntry[] = [];
  // seenWhos maps each who that has been part of this instance to their last-known location.
  private currentInstance: { startedAt: number; peak: number; seenWhos: Map<string, string> } | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    void this.state.blockConcurrencyWhile(async () => {
      try {
        const persisted = await this.state.storage.get<CoRoomLogEntry[]>(COROOM_LOG_KEY);
        if (Array.isArray(persisted)) {
          this.log = persisted
            .filter(
              (e): e is CoRoomLogEntry =>
                !!e &&
                Number.isFinite(e.startedAt) &&
                Number.isFinite(e.endedAt) &&
                Number.isFinite(e.peak)
            )
            .slice(0, COROOM_LOG_MAX);
        }
      } catch {
        this.log = [];
      }
      // After hibernation wake, reconstruct in-memory instance from any sockets
      // that survived. If no sockets remain, the instance state is correctly null.
      const whos = this.distinctWhos();
      if (whos.size >= 2) {
        // We don't know the original startedAt; best-effort: use the earliest
        // joinedAt across surviving sockets.
        let startedAt = Date.now();
        const seen = new Map<string, string>();
        for (const ws of this.state.getWebSockets()) {
          const att = readCoRoomAttachment(ws);
          if (!att) continue;
          if (att.joinedAt < startedAt) startedAt = att.joinedAt;
          seen.set(att.who, att.location || "");
        }
        this.currentInstance = { startedAt, peak: seen.size, seenWhos: seen };
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/snapshot")) {
      const now = Date.now();
      const whos = this.distinctWhos();
      const members = this.membersList();
      return new Response(
        JSON.stringify({
          count: whos.size,
          currentInstance: this.currentInstance
            ? {
                startedAt: this.currentInstance.startedAt,
                peak: this.currentInstance.peak,
                members,
              }
            : null,
          log: this.log,
          serverNow: now,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        }
      );
    }
    if (!url.pathname.endsWith("/socket")) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    const upgrade = request.headers.get("upgrade") || "";
    if (upgrade.toLowerCase() !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }

    const claimed = clean(url.searchParams.get("who")).toLowerCase();
    const seed =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "anon";
    const who = COROOM_WHO_REGEX.test(claimed) ? claimed : await hashStringWho(seed);
    const location = deriveCfLocation(request);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const now = Date.now();
    const att: CoRoomAttachment = { who, joinedAt: now, lastSeenAt: now, location };
    server.serializeAttachment(att);
    this.state.acceptWebSocket(server);

    // Determine instance lifecycle effects of this connection.
    const whos = this.distinctWhos();
    const wasOpen = this.currentInstance !== null;
    let openedNow = false;
    if (whos.size >= 2 && !this.currentInstance) {
      const seen = new Map<string, string>();
      for (const m of this.membersList()) seen.set(m.who, m.location);
      this.currentInstance = { startedAt: now, peak: whos.size, seenWhos: seen };
      openedNow = true;
    } else if (this.currentInstance) {
      for (const m of this.membersList()) {
        // Always update with the most recent location for each who.
        this.currentInstance.seenWhos.set(m.who, m.location);
      }
      if (whos.size > this.currentInstance.peak) this.currentInstance.peak = whos.size;
    }

    // Send hello to the new socket with full state.
    const helloPayload = {
      type: "hello",
      who,
      count: whos.size,
      currentInstance: this.currentInstance
        ? {
            startedAt: this.currentInstance.startedAt,
            peak: this.currentInstance.peak,
            members: this.membersList(),
          }
        : null,
      log: this.log,
      serverNow: now,
    };
    try {
      server.send(JSON.stringify(helloPayload));
    } catch {
      // ignore: socket may have closed pre-send
    }

    // Broadcast lifecycle to other sockets.
    if (openedNow) {
      this.broadcast(
        JSON.stringify({
          type: "open",
          startedAt: this.currentInstance!.startedAt,
          peak: this.currentInstance!.peak,
          members: this.membersList(),
          serverNow: now,
        }),
        server
      );
    } else if (wasOpen) {
      this.broadcast(
        JSON.stringify({
          type: "presence",
          count: whos.size,
          peak: this.currentInstance!.peak,
          members: this.membersList(),
          serverNow: now,
        }),
        server
      );
    }
    // If !wasOpen && !openedNow: count stayed at 1, no broadcast needed (no listeners).

    // Cancel any pending grace alarm now that we have ≥1 connections.
    if (whos.size >= 2) {
      try {
        await this.state.storage.deleteAlarm();
      } catch {
        // ignore
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    if (raw.length === 0 || raw.length > COROOM_INCOMING_MAX_BYTES) return;
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const att = readCoRoomAttachment(ws);
    if (!att) return;
    att.lastSeenAt = Date.now();
    if (String(parsed.type) === "ping") {
      try {
        ws.send(JSON.stringify({ type: "pong", t: att.lastSeenAt }));
      } catch {
        // ignore
      }
      ws.serializeAttachment(att);
    }
    // No other client messages accepted; door is opened by being there.
  }

  webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    void this.handleDisconnect(ws);
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    void this.handleDisconnect(ws);
  }

  async alarm(): Promise<void> {
    const whos = this.distinctWhos();
    if (this.currentInstance && whos.size < 2) {
      const now = Date.now();
      const entry: CoRoomLogEntry = {
        startedAt: this.currentInstance.startedAt,
        endedAt: now,
        durationMs: Math.max(0, now - this.currentInstance.startedAt),
        peak: this.currentInstance.peak,
        members: [...this.currentInstance.seenWhos.entries()]
          .map(([who, location]) => ({ who, location }))
          .sort((a, b) => a.who.localeCompare(b.who)),
      };
      this.log.unshift(entry);
      this.log = this.log.slice(0, COROOM_LOG_MAX);
      try {
        await this.state.storage.put(COROOM_LOG_KEY, this.log);
      } catch {
        // best-effort persist; will retry on next close
      }
      this.currentInstance = null;
      this.broadcast(
        JSON.stringify({ type: "close", entry, serverNow: now })
      );
    }
    // If size >= 2, instance still alive; nothing to do.
  }

  private async handleDisconnect(ws: WebSocket): Promise<void> {
    const att = readCoRoomAttachment(ws);
    if (!att) return;
    // Cloudflare leaves the closing socket in state.getWebSockets() until this
    // handler returns. Compute counts/members excluding it so the presence
    // event we broadcast reflects post-disconnect state, not the transient
    // pre-close state. Otherwise remaining clients keep seeing count=2 until
    // the grace alarm fires (and the user perceives "stuck").
    const whos = this.distinctWhos(ws);
    const members = this.membersList(ws);
    const now = Date.now();
    if (this.currentInstance) {
      this.broadcast(
        JSON.stringify({
          type: "presence",
          count: whos.size,
          peak: this.currentInstance.peak,
          members,
          serverNow: now,
        }),
        ws
      );
      if (whos.size < 2) {
        try {
          const existing = await this.state.storage.getAlarm();
          if (existing == null) {
            await this.state.storage.setAlarm(now + COROOM_LEAVE_GRACE_MS);
          }
        } catch {
          // ignore alarm scheduling failure
        }
      }
    }
  }

  private distinctWhos(exclude?: WebSocket): Set<string> {
    const whos = new Set<string>();
    for (const ws of this.state.getWebSockets()) {
      if (exclude && ws === exclude) continue;
      const att = readCoRoomAttachment(ws);
      if (att) whos.add(att.who);
    }
    return whos;
  }

  private membersList(exclude?: WebSocket): CoRoomMember[] {
    const aggregated = new Map<string, { joinedAt: number; location: string }>();
    for (const ws of this.state.getWebSockets()) {
      if (exclude && ws === exclude) continue;
      const att = readCoRoomAttachment(ws);
      if (!att) continue;
      const prev = aggregated.get(att.who);
      if (!prev || att.joinedAt < prev.joinedAt) {
        aggregated.set(att.who, { joinedAt: att.joinedAt, location: att.location || prev?.location || "" });
      } else if (att.location && !prev.location) {
        // Backfill location if a sibling socket has it.
        aggregated.set(att.who, { ...prev, location: att.location });
      }
    }
    return [...aggregated.entries()]
      .map(([who, v]) => ({ who, joinedAt: v.joinedAt, location: v.location }))
      .sort((a, b) => a.joinedAt - b.joinedAt);
  }

  private broadcast(message: string, exclude?: WebSocket): void {
    for (const ws of this.state.getWebSockets()) {
      if (ws === exclude) continue;
      try {
        ws.send(message);
      } catch {
        // socket dead; runtime will reap
      }
    }
  }
}

type SiteDeployRecord = {
  sha: string;
  shortSha: string;
  at: string;
  text: string;
  url?: string;
};

const SITE_DEPLOYS_KEY = "feed:site-deploys-v1";
const SITE_DEPLOYS_MAX = 30;
const SITE_DEPLOY_TEXT_MAX = 240;
const SITE_DEPLOY_SUBJECTS_MAX = 220;

async function fetchSite(env: Env): Promise<FeedItem[]> {
  const url = clean(env.SITE_VERSION_URL);
  const kv = env.HITS_KV;
  if (!url || !kv) return [];

  let stored: SiteDeployRecord[] = [];
  try {
    const raw = await kv.get(SITE_DEPLOYS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        stored = parsed
          .filter((d): d is SiteDeployRecord => !!d && typeof d.sha === "string" && typeof d.at === "string")
          .slice(0, SITE_DEPLOYS_MAX);
      }
    }
  } catch {
    stored = [];
  }

  let manifest: any = null;
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      cf: { cacheTtl: 30, cacheEverything: false },
    } as RequestInit);
    if (response.ok) {
      manifest = await response.json().catch(() => null);
    }
  } catch {
    manifest = null;
  }

  const sha = clean(manifest?.sha);
  if (sha && sha !== "dev" && !stored.some((d) => d.sha === sha)) {
    const shortSha = clean(manifest?.shortSha) || sha.slice(0, 7);
    const at = normalizeIsoAt(manifest?.at) || new Date().toISOString();
    const subjects = Array.isArray(manifest?.subjects)
      ? manifest.subjects.map((s: unknown) => clean(s)).filter((s: string) => s.length > 0)
      : [];
    const subjectsBody = subjects.length > 0 ? short(subjects.join("; "), SITE_DEPLOY_SUBJECTS_MAX) : "";
    const text = subjectsBody
      ? short(`site deployed · ${shortSha} · ${subjectsBody}`, SITE_DEPLOY_TEXT_MAX)
      : `site deployed · ${shortSha}`;
    const repoUrl = clean(env.SITE_REPO_URL).replace(/\/+$/, "");
    const commitUrl = repoUrl ? `${repoUrl}/commit/${sha}` : undefined;
    const record: SiteDeployRecord = {
      sha,
      shortSha,
      at,
      text,
      ...(commitUrl ? { url: commitUrl } : {}),
    };
    stored = [record, ...stored].slice(0, SITE_DEPLOYS_MAX);
    try {
      await kv.put(SITE_DEPLOYS_KEY, JSON.stringify(stored));
    } catch {
      // best-effort persist; observability surfaces failure
    }
  }

  return stored.map((d) => ({
    source: "site",
    text: d.text,
    at: d.at,
    ...(d.url ? { url: d.url } : {}),
  }));
}

async function buildFeedSnapshot(env: Env): Promise<FeedSnapshot> {
  const tasks: Array<[string, () => Promise<FeedItem[]>]> = [
    ["github", () => fetchGitHub(env, FEED_MAX_ITEMS)],
    ["bandcamp", () => fetchBandcamp(env, FEED_MAX_ITEMS)],
    ["instagram", () => fetchInstagram(env, FEED_MAX_ITEMS)],
    ["spotify", () => fetchSpotify(env)],
    ["x", () => fetchX(env, FEED_MAX_ITEMS)],
    ["youtube", () => fetchYouTube(env, FEED_MAX_ITEMS)],
    ["site", () => fetchSite(env)],
  ];

  const results = await Promise.allSettled(tasks.map((task) => task[1]()));
  const items: FeedItem[] = [];
  const sources: Record<string, SourceStatus> = {};
  const configured = (name: string) => {
    switch (name) {
      case "github":
        return !!clean(env.GITHUB_USERNAME || "cbassuarez");
      case "bandcamp":
        return !!clean(env.BANDCAMP_DOMAIN || "cbassuarez.bandcamp.com");
      case "instagram":
        return !!clean(env.IG_USER_ID) && !!clean(env.IG_ACCESS_TOKEN);
      case "spotify":
        return (
          !!clean(env.SPOTIFY_CLIENT_ID) &&
          !!clean(env.SPOTIFY_CLIENT_SECRET) &&
          !!clean(env.SPOTIFY_REFRESH_TOKEN)
        );
      case "x":
        return !!clean(env.X_USERNAME) && !!clean(env.X_BEARER_TOKEN);
      case "youtube":
        return !!clean(env.YT_CHANNEL_ID) && !!clean(env.YT_API_KEY);
      case "site":
        return !!clean(env.SITE_VERSION_URL);
      default:
        return false;
    }
  };

  results.forEach((result, index) => {
    const name = tasks[index][0];
    if (result.status === "fulfilled") {
      const value = result.value || [];
      items.push(...value);
      sources[name] = {
        status: value.length > 0 || configured(name) ? "ok" : "missing_config",
        count: value.length,
        message: value.length > 0 ? undefined : configured(name) ? "No recent activity." : "No data returned.",
      };
      return;
    }

    const message = clean(result.reason?.message || result.reason || "unknown error");
    sources[name] = {
      status: message.toLowerCase().includes("missing") ? "missing_config" : "error",
      count: 0,
      message,
    };
  });

  const previous = await readFeedSnapshot(env);
  const historical = previous?.items || [];
  const merged = [...items, ...historical]
    .map((item) => {
      const at = normalizeIsoAt(item?.at);
      return at ? { ...item, at } : null;
    })
    .filter((item): item is FeedItem => !!item && item.text.length > 0)
    .sort((a, b) => parseFeedTimeMs(b.at) - parseFeedTimeMs(a.at))
    .filter((item, index, array) => {
      const key = timelineIdentity(item);
      return array.findIndex((candidate) => timelineIdentity(candidate) === key) === index;
    });

  const persisted = sanitizeSpotifyTimeline(merged).slice(0, FEED_MAX_ITEMS);
  return {
    items: persisted,
    sources,
    generatedAt: new Date().toISOString(),
  };
}

async function persistFeedSnapshot(env: Env, snapshot: FeedSnapshot): Promise<void> {
  const kv = env.HITS_KV;
  if (!kv) return;
  await kv.put(FEED_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

async function readFeedSnapshot(env: Env): Promise<FeedSnapshot | null> {
  const kv = env.HITS_KV;
  if (!kv) return null;

  const raw = await kv.get(FEED_SNAPSHOT_KEY);
  if (!raw) return null;

  try {
    const parsed: any = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items)) {
      return {
        items: parsed.items as FeedItem[],
        sources: (parsed.sources || {}) as Record<string, SourceStatus>,
        generatedAt: clean(parsed.generatedAt) || new Date().toISOString(),
      };
    }
  } catch {
    // ignore parse failure, treat as missing
  }
  return null;
}

async function checkRateLimit(binding: RateLimitBinding | undefined, key: string): Promise<boolean> {
  if (!binding) return true;
  try {
    const result = await binding.limit({ key });
    return result.success;
  } catch {
    return true;
  }
}

function tooManyRequests(allowOrigin: string): Response {
  return new Response(
    JSON.stringify({ error: "rate_limited", at: new Date().toISOString() }),
    { status: 429, headers: { ...jsonHeaders(allowOrigin), "retry-after": "60" } }
  );
}

function clientKey(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function isValidContactEmail(value: unknown): boolean {
  const email = clean(value);
  if (!CONTACT_EMAIL_REGEX.test(email)) return false;
  const lowered = email.toLowerCase();
  const local = lowered.split("@")[0] || "";
  const domain = lowered.split("@")[1] || "";
  if (CONTACT_BLOCKED_LOCAL_PARTS.has(local)) return false;
  if (CONTACT_BLOCKED_DOMAINS.has(domain)) return false;
  if (domain.startsWith("example.") || domain.startsWith("test.")) return false;
  return true;
}

function parseContactSubmission(body: any): { ok: true; data: ContactSubmission } | { ok: false; error: string } {
  const name = clean(body?.name).slice(0, 120);
  const email = clean(body?.email).slice(0, 254);
  const subject = clean(body?.subject).slice(0, 180);
  const message = clean(body?.message).slice(0, 4000);
  const requestedTopic = clean(body?.topic).toLowerCase();
  const topic = CONTACT_ALLOWED_TOPICS.has(requestedTopic) ? requestedTopic : "other";
  const timeSensitive = clean(body?.time_sensitive).toLowerCase() === "yes" || body?.time_sensitive === true;
  const token =
    clean(body?.turnstileToken || body?.["cf-turnstile-response"]).slice(0, 2048);

  if (!name || !email || !subject || !message) {
    return { ok: false, error: "missing_required_fields" };
  }

  if (!isValidContactEmail(email)) {
    return { ok: false, error: "invalid_email" };
  }

  if (!token) {
    return { ok: false, error: "missing_turnstile_token" };
  }

  return {
    ok: true,
    data: {
      name,
      email,
      subject,
      topic,
      timeSensitive,
      message,
      turnstileToken: token,
    },
  };
}

function resolveTurnstileSecret(env: Env, request: Request): string {
  const configured = clean(env.TURNSTILE_SECRET_KEY);
  if (configured) return configured;

  const host = clean(new URL(request.url).hostname).toLowerCase();
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  return isLocalHost ? TURNSTILE_TEST_SECRET_KEY : "";
}

function allowedTurnstileHostnames(env: Env): Set<string> {
  const raw = clean(env.TURNSTILE_ALLOWED_HOSTNAMES || "cbassuarez.com,www.cbassuarez.com");
  const parts = raw
    .split(",")
    .map((host) => clean(host).toLowerCase())
    .filter(Boolean);
  return new Set(parts);
}

async function verifyTurnstileToken(
  token: string,
  secret: string,
  remoteIp: string
): Promise<{ success: boolean; errorCodes: string[]; hostname: string; action: string }> {
  const payload = new URLSearchParams();
  payload.set("secret", secret);
  payload.set("response", token);
  if (remoteIp && remoteIp !== "unknown") {
    payload.set("remoteip", remoteIp);
  }

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: payload.toString(),
    });

    const parsed: any = await response.json().catch(() => ({}));
    const errorCodes = Array.isArray(parsed?.["error-codes"])
      ? parsed["error-codes"].map((code: unknown) => clean(code)).filter(Boolean)
      : [];
    const hostname = clean(parsed?.hostname || "").toLowerCase();
    const action = clean(parsed?.action || "");

    if (!response.ok) {
      return {
        success: false,
        errorCodes: errorCodes.length ? errorCodes : [`siteverify_http_${response.status}`],
        hostname,
        action,
      };
    }

    return { success: Boolean(parsed?.success), errorCodes, hostname, action };
  } catch {
    return { success: false, errorCodes: ["siteverify_network_error"], hostname: "", action: "" };
  }
}

const CONTACT_FORMSPREE_DEFAULT_ENDPOINT = "https://formspree.io/f/mjkepaeo";

async function deliverContactEmail(
  env: Env,
  payload: ContactSubmission,
  receivedAt: string
): Promise<{ ok: boolean; error: string | null; messageId: string | null }> {
  const endpoint = clean(env.CONTACT_FORMSPREE_ENDPOINT || CONTACT_FORMSPREE_DEFAULT_ENDPOINT);
  if (!endpoint) {
    return { ok: false, error: "formspree_endpoint_unconfigured", messageId: null };
  }

  const body = {
    name: payload.name,
    email: payload.email,
    _replyto: payload.email,
    _subject: `[contact] ${payload.subject}`,
    subject: payload.subject,
    topic: payload.topic,
    time_sensitive: payload.timeSensitive ? "yes" : "no",
    received_at: receivedAt,
    message: payload.message,
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    let parsed: any = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }

    if (!response.ok || parsed?.ok === false) {
      const errors = Array.isArray(parsed?.errors)
        ? parsed.errors.map((e: any) => clean(e?.message || e?.code || "")).filter(Boolean).join("; ")
        : "";
      const detail = errors || clean(parsed?.error) || `formspree_status_${response.status}`;
      return { ok: false, error: short(detail, 220), messageId: null };
    }

    const id = clean(parsed?.id || parsed?.next || "");
    return { ok: true, error: null, messageId: id || null };
  } catch (error: any) {
    const message = clean(error?.message || "formspree_network_error");
    return { ok: false, error: short(message, 220), messageId: null };
  }
}

async function handleFeedRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  allowOrigin: string
): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(FEED_MAX_ITEMS, Number(url.searchParams.get("limit")) || 24));

  const cacheUrl = new URL(request.url);
  cacheUrl.search = `?limit=${limit}`;
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("access-control-allow-origin", allowOrigin);
    response.headers.set("cache-control", "no-store");
    return response;
  }

  let snapshot = await readFeedSnapshot(env);
  if (!snapshot) {
    snapshot = { items: [], sources: {}, generatedAt: new Date().toISOString() };
    ctx.waitUntil(
      (async () => {
        try {
          const built = await buildFeedSnapshot(env);
          await persistFeedSnapshot(env, built);
        } catch {
          // surfaces in observability logs
        }
      })()
    );
  }

  const body = JSON.stringify(
    {
      items: snapshot.items.slice(0, limit),
      sources: snapshot.sources,
      currentActivity: selectCurrentActivity(snapshot.items),
      generatedAt: snapshot.generatedAt,
    },
    null,
    2
  );

  if (snapshot.items.length > 0) {
    const cacheable = new Response(body, {
      status: 200,
      headers: {
        ...jsonHeaders(allowOrigin),
        "cache-control": `public, s-maxage=${FEED_EDGE_CACHE_SECONDS}`,
      },
    });
    ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));
  }

  return new Response(body, { status: 200, headers: jsonHeaders(allowOrigin) });
}

// ---------- CLI surface (curl, wget, httpie, ...) ----------

const CLI_USER_AGENT_REGEX = /^(curl|wget|HTTPie|httpie|aria2|powershell|fetch|node-fetch|go-http-client|libwww-perl|python-requests|python-urllib)\b/i;
const CLI_LETTER_FALLBACK = `hello.

this is cbassuarez.com from the command line.
i'm seb. i make cybernetic music systems.

the live surfaces:
  /labs/string    a shared string instrument
  /labs/repl      a live-coding repl in score-grid notation
  /labs/feed      everything i did online today
  /labs/guestbook a place to leave a small mark

the offline ones:
  let go / letting go · THE TUB · String · Praetorius

if you want to talk:  contact@cbassuarez.com
if you want to read:  this came from /humans.txt

curl /feed       see what's happening today
curl /string     /labs/string state
curl /room       /404 anteroom state
curl /works      list of works
curl /version    build label
curl /contact    how to reach me
curl /repl       what /labs/repl is + ssh-render usage

ssh ssh.cbassuarez.com repl < patch.txt | mpv -    actually plays the patch

— seb
`;

type CliPath =
  | "letter"
  | "feed"
  | "string"
  | "room"
  | "works"
  | "contact"
  | "version"
  | "humans"
  | "repl";

const CLI_PATH_MAP: Record<string, CliPath | undefined> = {
  "/": "letter",
  "/cli": "letter",
  "/cli/": "letter",
  "/cli/feed": "feed",
  "/cli/string": "string",
  "/cli/room": "room",
  "/cli/works": "works",
  "/cli/contact": "contact",
  "/cli/version": "version",
  "/cli/humans": "humans",
  "/cli/repl": "repl",
  "/feed": "feed",
  "/string": "string",
  "/room": "room",
  "/works": "works",
  "/contact": "contact",
  "/version": "version",
  "/repl": "repl",
};

function isCliClient(request: Request): boolean {
  const ua = clean(request.headers.get("user-agent") || "");
  if (CLI_USER_AGENT_REGEX.test(ua)) return true;
  const accept = clean(request.headers.get("accept") || "");
  if (accept && accept.includes("text/plain") && !accept.includes("text/html")) {
    return true;
  }
  return false;
}

function classifyCliPath(pathname: string): CliPath | null {
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  return CLI_PATH_MAP[trimmed] ?? null;
}

function cliTextResponse(body: string, status = 200): Response {
  return new Response(body.endsWith("\n") ? body : body + "\n", {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      link: DISCOVERY_LINK_HEADER,
    },
  });
}

function buildCliFooter(): string {
  return [
    "",
    "—",
    "more at https://cbassuarez.com  ·  signed at /humans.txt",
    "",
  ].join("\n");
}

async function fetchCliLetter(request: Request): Promise<string> {
  // Try fetching the canonical letter from the deployed site, fall back to
  // the inline copy when the site is unreachable (e.g. local dev, transient
  // outage). The fetch is best-effort and never blocks the response.
  try {
    const origin = new URL(request.url);
    origin.pathname = "/.well-known/cli-letter.txt";
    origin.search = "";
    // Hit the canonical apex if available; fall back to the worker's own URL.
    const candidates = [
      `https://cbassuarez.com/.well-known/cli-letter.txt`,
      origin.toString(),
    ];
    for (const candidate of candidates) {
      try {
        const r = await fetch(candidate, {
          headers: { accept: "text/plain" },
          cf: { cacheTtl: 60, cacheEverything: true },
        } as RequestInit);
        if (r.ok) {
          const text = await r.text();
          const trimmed = text.trim();
          if (trimmed.length > 0) return text;
        }
      } catch {
        // try next
      }
    }
  } catch {
    // fall through to inline fallback
  }
  return CLI_LETTER_FALLBACK;
}

function formatCliRelative(at: string, nowMs: number): string {
  const t = parseFeedTimeMs(at);
  if (!t) return "";
  const diffMs = Math.max(0, nowMs - t);
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

async function renderCliFeed(env: Env, allowOrigin: string): Promise<string> {
  const snapshot = await readFeedSnapshot(env);
  const items = (snapshot?.items || []).slice(0, 6);
  const now = Date.now();
  const lines = ["the feed says, today:"];
  if (items.length === 0) {
    lines.push("");
    lines.push("  (the feed is quiet right now.)");
  } else {
    for (const item of items) {
      const src = sourceBase(item.source).padEnd(8, " ");
      const when = formatCliRelative(item.at, now).padEnd(8, " ");
      const text = short(item.text, 88);
      lines.push(`  · ${when} ${src} ${text}`);
    }
  }
  lines.push("");
  lines.push("more at https://cbassuarez.com/labs/feed");
  return lines.join("\n");
}

function formatCliDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h${String(rm).padStart(2, "0")}m`;
  }
  return `${String(m).padStart(2, "0")}m${String(r).padStart(2, "0")}s`;
}

async function renderCliRoom(env: Env): Promise<string> {
  if (!env.CO_ROOM) return "the /404 anteroom is not configured here.\n";
  try {
    const id = env.CO_ROOM.idFromName(COROOM_NAME);
    const stub = env.CO_ROOM.get(id);
    const r = await stub.fetch(new Request("https://internal/snapshot", { method: "GET" }));
    if (!r.ok) {
      return "the /404 anteroom is unreachable right now.\n";
    }
    const data: any = await r.json().catch(() => null);
    if (!data) return "the /404 anteroom returned no state.\n";
    const count = Number(data.count) || 0;
    const log = Array.isArray(data.log) ? data.log : [];
    if (data.currentInstance && count >= 2) {
      const startedAt = Number(data.currentInstance.startedAt) || 0;
      const dur = formatCliDuration(Math.max(0, Date.now() - startedAt));
      const peak = Number(data.currentInstance.peak) || count;
      const members = Array.isArray(data.currentInstance.members) ? data.currentInstance.members : [];
      const places = members
        .map((m: any) => clean(m?.location || ""))
        .filter((p: string) => p.length > 0);
      const placeLine = places.length > 0 ? `they are connecting from ${places.join(", ")}.` : "";
      return [
        `the /404 anteroom is open right now.`,
        `${count} people are present (peak ${peak}); the instance has been open ${dur}.`,
        placeLine,
        ``,
        `wander toward https://cbassuarez.com/this-does-not-exist if you want to join.`,
        ``,
      ].filter(Boolean).join("\n") + "\n";
    }
    const last = log[0];
    if (!last) {
      return [
        "the /404 anteroom has never opened. it opens when two strangers are",
        "simultaneously asking the site for a page that doesn't exist.",
        "",
        "wander toward https://cbassuarez.com/this-does-not-exist if you want to try.",
        "",
      ].join("\n");
    }
    const dur = formatCliDuration(Number(last.durationMs) || 0);
    const ago = formatCliRelative(new Date(last.endedAt || 0).toISOString(), Date.now());
    const peak = Number(last.peak) || 0;
    const places = Array.isArray(last.members)
      ? last.members.map((m: any) => clean(m?.location || "")).filter((p: string) => p.length > 0)
      : [];
    const placeLine = places.length > 0 ? `they were from ${places.join(", ")}.` : "";
    return [
      `the /404 anteroom is currently closed.`,
      `it last opened ${ago} for ${dur}, with ${peak} ${peak === 1 ? "person" : "people"}.`,
      placeLine,
      ``,
      `wander toward https://cbassuarez.com/this-does-not-exist if you want to try.`,
      ``,
    ].filter(Boolean).join("\n") + "\n";
  } catch {
    return "the /404 anteroom is unreachable right now.\n";
  }
}

async function renderCliString(env: Env): Promise<string> {
  // The string lab's state lives only inside the StringRoom DO; surface a
  // tiny prose summary by hitting it (or fall back to a static blurb).
  // We don't add a /snapshot path to StringRoom in this pass — keep the
  // CLI text purely descriptive.
  return [
    "the string lab is a shared instrument that lives in your browser.",
    "every visitor plays one string; every pluck travels outward and",
    "returns as sympathetic sound from other strings nearby.",
    "",
    "pluck it yourself at https://cbassuarez.com/labs/string.",
    "",
  ].join("\n");
}

function renderCliWorks(): string {
  return [
    "the offline works:",
    "",
    "  · let go / letting go    cybernetic performance, ongoing.",
    "  · THE TUB                installation + sonic sculpture.",
    "  · String                 cybernetic strings, multi-visitor.",
    "  · Praetorius             prepared instruments + live system.",
    "",
    "the online (live) ones:",
    "",
    "  · /labs/string           shared string instrument.",
    "  · /labs/repl             live-coding repl in score-grid notation.",
    "  · /labs/feed             a feed of what i did online today.",
    "  · /labs/guestbook        a place to leave a small mark.",
    "  · /404 (anteroom)        opens only when two strangers are",
    "                           simultaneously on a page that doesn't exist.",
    "",
    "more at https://cbassuarez.com/works",
    "",
  ].join("\n");
}

function renderCliRepl(): string {
  return [
    "/labs/repl — a live-coding piece in score-grid notation, powered by",
    "             the cbassuarez voices. it runs in two places:",
    "",
    "  in your browser, at https://cbassuarez.com/labs/repl",
    "    — the canonical surface. live transport viz, sample browser,",
    "      hot-reload on Cmd-Enter, share-by-URL.",
    "",
    "  from your shell, over ssh — same patches, same DSL, rendered to a",
    "  WAV stream you pipe into a local audio player:",
    "",
    "    ssh ssh.cbassuarez.com repl < patch.txt | mpv -",
    "    ssh ssh.cbassuarez.com repl < patch.txt | ffplay -nodisp -autoexit -",
    "    ssh ssh.cbassuarez.com repl < patch.txt | sox -t wav - -d",
    "    ssh ssh.cbassuarez.com repl v1.<hash>   | mpv -",
    "    ssh ssh.cbassuarez.com repl --help",
    "",
    "the language at a glance:",
    "",
    "  tempo 110",
    "  meter 4/4",
    "",
    "  string  A3  C4  E4  G4    | A3  C4  E4  ~",
    "  force   f   mf  p   f     | ff  mf  p   p",
    "  decay   4",
    "  crush   8",
    "",
    "  string  .   .   .   D3",
    "  every   4 bars",
    "  pan     left",
    "",
    "  sample  snm-*&30  .  .  .",
    "  every   2 bars",
    "",
    "slot tokens:  notes (A3, C#4, Bb2), '.' (rest), '~' (sustain), or a",
    "              sample id from the bank.",
    "groups:       (a b c) subdivides one slot's time.",
    "selectors:    bank-* (random per fire), bank-*! (frozen),",
    "              bank-*&N (gradient), a/b (union of pools).",
    "",
    "sample bank — 300 one-shots, mirrored from /labs/chunk-surfer:",
    "  main_b3        b3-01 .. b3-64       (64)",
    "  THE TUB        tub-xither-forge ..  (44)",
    "  amplifications amp-001 .. amp-064   (64)",
    "  soundnoisemusic snm-001 .. snm-064  (64)",
    "  lux_nova       lux-001 .. lux-064   (64)",
    "",
    "more at https://cbassuarez.com/labs/repl",
    "",
  ].join("\n");
}

function renderCliContact(): string {
  return [
    "to reach me:",
    "",
    "  email      contact@cbassuarez.com",
    "  form       https://cbassuarez.com/contact",
    "  github     https://github.com/cbassuarez",
    "  bandcamp   https://cbassuarez.bandcamp.com",
    "",
    "i read every email. i answer most of them.",
    "",
    "— seb",
    "",
  ].join("\n");
}

async function renderCliVersion(env: Env): Promise<string> {
  if (!env.HITS_KV) return "build label is not available right now.\n";
  let manifest: any = null;
  try {
    const r = await fetch("https://cbassuarez.com/version.json", {
      headers: { accept: "application/json" },
      cf: { cacheTtl: 60 } as any,
    });
    if (r.ok) manifest = await r.json().catch(() => null);
  } catch {
    manifest = null;
  }
  if (!manifest || !manifest.sha) {
    return "the live build manifest is unreachable right now.\n";
  }
  const shortSha = clean(manifest.shortSha || String(manifest.sha).slice(0, 7));
  const at = clean(manifest.at).slice(0, 19).replace("T", " ");
  const subjects = Array.isArray(manifest.subjects) ? manifest.subjects : [];
  const lines = [
    `build · ${shortSha} · ${at} UTC`,
    "",
  ];
  if (subjects.length > 0) {
    lines.push("recent work:");
    for (const s of subjects.slice(0, 8)) {
      const trimmed = clean(s);
      if (trimmed) lines.push(`  · ${trimmed}`);
    }
    lines.push("");
  }
  lines.push("more at https://cbassuarez.com/colophon");
  lines.push("");
  return lines.join("\n");
}

async function renderCliHumans(request: Request): Promise<string> {
  try {
    const r = await fetch("https://cbassuarez.com/humans.txt", {
      headers: { accept: "text/plain" },
      cf: { cacheTtl: 60 } as any,
    });
    if (r.ok) return await r.text();
  } catch {
    // ignore
  }
  return "humans.txt is unavailable right now.\n";
}

async function handleCliRequest(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const kind = classifyCliPath(url.pathname);
  if (!kind) {
    const lines = [
      `cbassuarez.com · cli`,
      ``,
      `no such path: ${url.pathname}`,
      ``,
      `try: /, /feed, /string, /room, /works, /contact, /version`,
      ``,
    ];
    return cliTextResponse(lines.join("\n"), 404);
  }
  switch (kind) {
    case "letter": {
      const letter = await fetchCliLetter(request);
      return cliTextResponse(letter);
    }
    case "feed": {
      const body = await renderCliFeed(env, "*");
      return cliTextResponse(body + buildCliFooter());
    }
    case "string": {
      const body = await renderCliString(env);
      return cliTextResponse(body + buildCliFooter());
    }
    case "room": {
      const body = await renderCliRoom(env);
      return cliTextResponse(body + buildCliFooter());
    }
    case "works": {
      return cliTextResponse(renderCliWorks() + buildCliFooter());
    }
    case "contact": {
      return cliTextResponse(renderCliContact() + buildCliFooter());
    }
    case "version": {
      const body = await renderCliVersion(env);
      return cliTextResponse(body + buildCliFooter());
    }
    case "humans": {
      const body = await renderCliHumans(request);
      return cliTextResponse(body);
    }
    case "repl": {
      return cliTextResponse(renderCliRepl() + buildCliFooter());
    }
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const allowOrigin = env.FEED_ALLOW_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: jsonHeaders(allowOrigin) });
    }

    // CLI surface: catch curl/wget/httpie at the top, before any API routes,
    // so `curl <worker>/feed` and `curl <worker>/cli/feed` both serve text.
    // Two ways to opt in:
    //   1. The path is under /cli (explicit namespace) — always serve text.
    //   2. The User-Agent looks CLI-shaped — serve text on the short paths.
    // /api/* paths are explicitly NOT considered CLI paths so existing JSON
    // contracts are preserved.
    if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
      const cliKind = classifyCliPath(url.pathname);
      const explicitCliPath = url.pathname === "/cli" || url.pathname.startsWith("/cli/");
      if (cliKind && (explicitCliPath || isCliClient(request))) {
        return handleCliRequest(request, env, url);
      }
    }

    if (url.pathname === "/api/feed") {
      if (!(await checkRateLimit(env.RATE_LIMIT_FEED, clientKey(request)))) {
        return tooManyRequests(allowOrigin);
      }
      return handleFeedRequest(request, env, ctx, allowOrigin);
    }

    if (url.pathname === "/api/hit") {
      if (!(await checkRateLimit(env.RATE_LIMIT_HIT, clientKey(request)))) {
        return tooManyRequests(allowOrigin);
      }
      try {
        const value = await incrementHitCount(env);
        return new Response(JSON.stringify({ value, at: new Date().toISOString() }), {
          status: 200,
          headers: jsonHeaders(allowOrigin),
        });
      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: clean(error?.message || "hit_count_failed"), at: new Date().toISOString() }),
          {
            status: 502,
            headers: jsonHeaders(allowOrigin),
          }
        );
      }
    }

    if (url.pathname === "/api/guestbook") {
      if (request.method === "GET") {
        try {
          const rawLimit = Number(url.searchParams.get("limit"));
          const hasLimit = Number.isFinite(rawLimit) && rawLimit > 0;
          const limit = hasLimit ? Math.max(1, Math.min(5000, Math.floor(rawLimit))) : null;
          const entries = await readGuestbookEntries(env);
          const selected = limit ? entries.slice(0, limit) : entries;
          return new Response(JSON.stringify({ entries: selected, at: new Date().toISOString() }), {
            status: 200,
            headers: jsonHeaders(allowOrigin),
          });
        } catch (error: any) {
          return new Response(
            JSON.stringify({ error: clean(error?.message || "guestbook_read_failed"), at: new Date().toISOString() }),
            {
              status: 502,
              headers: jsonHeaders(allowOrigin),
            }
          );
        }
      }

      if (request.method === "POST") {
        if (!(await checkRateLimit(env.RATE_LIMIT_GUESTBOOK_POST, clientKey(request)))) {
          return tooManyRequests(allowOrigin);
        }
        try {
          const signerIp = clientKey(request);
          if (await hasGuestbookSignature(env, signerIp)) {
            return new Response(
              JSON.stringify({ error: "already_signed", at: new Date().toISOString() }),
              { status: 409, headers: jsonHeaders(allowOrigin) }
            );
          }

          const body: any = await request.json();
          const name = clean(body?.name || "anonymous").slice(0, 48) || "anonymous";
          const message = clean(body?.message || "").slice(0, 280);

          if (!message) {
            return new Response(JSON.stringify({ error: "message_required", at: new Date().toISOString() }), {
              status: 400,
              headers: jsonHeaders(allowOrigin),
            });
          }

          const entries = await readGuestbookEntries(env);
          const next: GuestbookEntry[] = [{ name, message, at: new Date().toISOString() }, ...entries];
          await writeGuestbookEntries(env, next);
          await recordGuestbookSignature(env, signerIp);

          return new Response(JSON.stringify({ ok: true, entries: next, at: new Date().toISOString() }), {
            status: 200,
            headers: jsonHeaders(allowOrigin),
          });
        } catch (error: any) {
          return new Response(
            JSON.stringify({ error: clean(error?.message || "guestbook_write_failed"), at: new Date().toISOString() }),
            {
              status: 502,
              headers: jsonHeaders(allowOrigin),
            }
          );
        }
      }

      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: jsonHeaders(allowOrigin),
      });
    }

    if (url.pathname === "/api/contact") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "method_not_allowed" }), {
          status: 405,
          headers: jsonHeaders(allowOrigin),
        });
      }
      if (!(await checkRateLimit(env.RATE_LIMIT_CONTACT_POST, clientKey(request)))) {
        return tooManyRequests(allowOrigin);
      }

      try {
        const body: any = await request.json().catch(() => ({}));
        if (clean(body?._gotcha || body?.gotcha)) {
          return new Response(JSON.stringify({ ok: true, at: new Date().toISOString() }), {
            status: 200,
            headers: jsonHeaders(allowOrigin),
          });
        }

        const parsed = parseContactSubmission(body);
        if (!parsed.ok) {
          return new Response(JSON.stringify({ error: parsed.error, at: new Date().toISOString() }), {
            status: 400,
            headers: jsonHeaders(allowOrigin),
          });
        }

        const turnstileSecret = resolveTurnstileSecret(env, request);
        if (!turnstileSecret) {
          return new Response(JSON.stringify({ error: "turnstile_unconfigured", at: new Date().toISOString() }), {
            status: 503,
            headers: jsonHeaders(allowOrigin),
          });
        }

        const verification = await verifyTurnstileToken(
          parsed.data.turnstileToken,
          turnstileSecret,
          clientKey(request)
        );
        if (!verification.success) {
          return new Response(
            JSON.stringify({
              error: "turnstile_failed",
              details: verification.errorCodes,
              at: new Date().toISOString(),
            }),
            { status: 403, headers: jsonHeaders(allowOrigin) }
          );
        }

        const allowedHosts = allowedTurnstileHostnames(env);
        if (allowedHosts.size > 0 && !allowedHosts.has(verification.hostname)) {
          return new Response(
            JSON.stringify({
              error: "turnstile_bad_hostname",
              hostname: verification.hostname || null,
              at: new Date().toISOString(),
            }),
            { status: 403, headers: jsonHeaders(allowOrigin) }
          );
        }

        if (verification.action && verification.action !== CONTACT_TURNSTILE_ACTION) {
          return new Response(
            JSON.stringify({
              error: "turnstile_bad_action",
              action: verification.action,
              at: new Date().toISOString(),
            }),
            { status: 403, headers: jsonHeaders(allowOrigin) }
          );
        }

        const at = new Date().toISOString();
        const delivered = await deliverContactEmail(env, parsed.data, at);
        if (!delivered.ok) {
          return new Response(
            JSON.stringify({
              error: "contact_delivery_failed",
              detail: delivered.error,
              at,
            }),
            { status: 502, headers: jsonHeaders(allowOrigin) }
          );
        }

        return new Response(JSON.stringify({
          ok: true,
          relayed: true,
          messageId: delivered.messageId,
          at,
        }), {
          status: 200,
          headers: jsonHeaders(allowOrigin),
        });
      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: clean(error?.message || "contact_submit_failed"), at: new Date().toISOString() }),
          { status: 502, headers: jsonHeaders(allowOrigin) }
        );
      }
    }

    if (url.pathname === "/api/contact-config") {
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "method_not_allowed" }), {
          status: 405,
          headers: jsonHeaders(allowOrigin),
        });
      }

      const siteKey = clean(env.TURNSTILE_SITE_KEY || "");
      return new Response(
        JSON.stringify({
          turnstileSiteKey: siteKey || null,
          at: new Date().toISOString(),
        }),
        { status: 200, headers: jsonHeaders(allowOrigin) }
      );
    }

    if (url.pathname === "/api/string/socket") {
      const upgrade = request.headers.get("upgrade") || "";
      if (upgrade.toLowerCase() !== "websocket") {
        return new Response(JSON.stringify({ error: "expected_websocket_upgrade" }), {
          status: 426,
          headers: jsonHeaders(allowOrigin),
        });
      }
      if (!env.STRING_ROOM) {
        return new Response(JSON.stringify({ error: "string_room_unconfigured" }), {
          status: 503,
          headers: jsonHeaders(allowOrigin),
        });
      }
      if (!(await checkRateLimit(env.RATE_LIMIT_STRING_SOCKET, clientKey(request)))) {
        return tooManyRequests(allowOrigin);
      }
      const id = env.STRING_ROOM.idFromName(STRING_ROOM_NAME);
      const stub = env.STRING_ROOM.get(id);
      return stub.fetch(request);
    }

    if (url.pathname === "/api/coroom/socket") {
      const upgrade = request.headers.get("upgrade") || "";
      if (upgrade.toLowerCase() !== "websocket") {
        return new Response(JSON.stringify({ error: "expected_websocket_upgrade" }), {
          status: 426,
          headers: jsonHeaders(allowOrigin),
        });
      }
      if (!env.CO_ROOM) {
        return new Response(JSON.stringify({ error: "coroom_unconfigured" }), {
          status: 503,
          headers: jsonHeaders(allowOrigin),
        });
      }
      if (!(await checkRateLimit(env.RATE_LIMIT_COROOM_SOCKET, clientKey(request)))) {
        return tooManyRequests(allowOrigin);
      }
      const id = env.CO_ROOM.idFromName(COROOM_NAME);
      const stub = env.CO_ROOM.get(id);
      return stub.fetch(request);
    }

    if (url.pathname === "/api/coroom/snapshot") {
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "method_not_allowed" }), {
          status: 405,
          headers: jsonHeaders(allowOrigin),
        });
      }
      if (!env.CO_ROOM) {
        return new Response(JSON.stringify({ error: "coroom_unconfigured" }), {
          status: 503,
          headers: jsonHeaders(allowOrigin),
        });
      }
      const id = env.CO_ROOM.idFromName(COROOM_NAME);
      const stub = env.CO_ROOM.get(id);
      const snapshotUrl = new URL(request.url);
      snapshotUrl.pathname = "/snapshot";
      const doRequest = new Request(snapshotUrl.toString(), { method: "GET" });
      const response = await stub.fetch(doRequest);
      const body = await response.text();
      return new Response(body, {
        status: response.status,
        headers: jsonHeaders(allowOrigin),
      });
    }

    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({ ok: true, at: new Date().toISOString() }), {
        status: 200,
        headers: jsonHeaders(allowOrigin),
      });
    }

    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: jsonHeaders(allowOrigin),
    });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const snapshot = await buildFeedSnapshot(env);
        await persistFeedSnapshot(env, snapshot);
      })()
    );
  },
};
