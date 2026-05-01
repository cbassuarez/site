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
  RATE_LIMIT_FEED?: RateLimitBinding;
  RATE_LIMIT_HIT?: RateLimitBinding;
  RATE_LIMIT_GUESTBOOK_POST?: RateLimitBinding;
  RATE_LIMIT_STRING_PLUCK?: RateLimitBinding;
  RATE_LIMIT_STRING_GET?: RateLimitBinding;
  RATE_LIMIT_STRING_CURSOR?: RateLimitBinding;
};

type FeedSnapshot = {
  items: FeedItem[];
  sources: Record<string, SourceStatus>;
  generatedAt: string;
};

const FEED_SNAPSHOT_KEY = "feed:snapshot-v1";
const FEED_MAX_ITEMS = 500;
const FEED_EDGE_CACHE_SECONDS = 60;

const jsonHeaders = (origin: string) => ({
  "access-control-allow-origin": origin,
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
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

type StringPluck = { x: number; y: number; t: number; who: string };
type StringCursor = { x: number; t: number; who: string };

const STRING_PLUCKS_KEY = "string:plucks-v1";
const STRING_CURSORS_KEY = "string:cursors-v1";
const STRING_PLUCK_WINDOW_MS = 90_000;
const STRING_CURSOR_WINDOW_MS = 5_000;
const STRING_PLUCK_MAX = 200;
const STRING_CURSOR_MAX = 64;

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

async function readStringPlucks(env: Env): Promise<StringPluck[]> {
  const kv = env.HITS_KV;
  if (!kv) return [];
  const raw = await kv.get(STRING_PLUCKS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((p: any): StringPluck | null => {
        const t = Number(p?.t);
        if (!Number.isFinite(t) || t <= 0) return null;
        return {
          x: clamp01(p?.x),
          y: clamp01(p?.y),
          t,
          who: clean(p?.who).slice(0, 16),
        };
      })
      .filter((p): p is StringPluck => p !== null);
  } catch {
    return [];
  }
}

async function writeStringPlucks(env: Env, plucks: StringPluck[]): Promise<void> {
  const kv = env.HITS_KV;
  if (!kv) return;
  await kv.put(STRING_PLUCKS_KEY, JSON.stringify(plucks));
}

async function readStringCursors(env: Env): Promise<StringCursor[]> {
  const kv = env.HITS_KV;
  if (!kv) return [];
  const raw = await kv.get(STRING_CURSORS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c: any): StringCursor | null => {
        const t = Number(c?.t);
        if (!Number.isFinite(t) || t <= 0) return null;
        return { x: clamp01(c?.x), t, who: clean(c?.who).slice(0, 16) };
      })
      .filter((c): c is StringCursor => c !== null);
  } catch {
    return [];
  }
}

async function writeStringCursors(env: Env, cursors: StringCursor[]): Promise<void> {
  const kv = env.HITS_KV;
  if (!kv) return;
  await kv.put(STRING_CURSORS_KEY, JSON.stringify(cursors));
}

async function buildFeedSnapshot(env: Env): Promise<FeedSnapshot> {
  const tasks: Array<[string, () => Promise<FeedItem[]>]> = [
    ["github", () => fetchGitHub(env, FEED_MAX_ITEMS)],
    ["bandcamp", () => fetchBandcamp(env, FEED_MAX_ITEMS)],
    ["instagram", () => fetchInstagram(env, FEED_MAX_ITEMS)],
    ["spotify", () => fetchSpotify(env)],
    ["x", () => fetchX(env, FEED_MAX_ITEMS)],
    ["youtube", () => fetchYouTube(env, FEED_MAX_ITEMS)],
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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const allowOrigin = env.FEED_ALLOW_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: jsonHeaders(allowOrigin) });
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

    if (url.pathname === "/api/string/pluck") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "method_not_allowed" }), {
          status: 405,
          headers: jsonHeaders(allowOrigin),
        });
      }
      if (!(await checkRateLimit(env.RATE_LIMIT_STRING_PLUCK, clientKey(request)))) {
        return tooManyRequests(allowOrigin);
      }
      try {
        const body: any = await request.json().catch(() => ({}));
        const x = clamp01(body?.x);
        const y = clamp01(body?.y);
        const claimed = clean(body?.who).slice(0, 16);
        const who = /^[0-9a-f]{6,16}$/i.test(claimed) ? claimed.toLowerCase() : await hashStringWho(clientKey(request));
        const t = Date.now();
        const cutoff = t - STRING_PLUCK_WINDOW_MS;
        const existing = await readStringPlucks(env);
        const next: StringPluck[] = [...existing, { x, y, t, who }]
          .filter((p) => p.t >= cutoff)
          .slice(-STRING_PLUCK_MAX);
        await writeStringPlucks(env, next);
        return new Response(JSON.stringify({ ok: true, t, who }), {
          status: 200,
          headers: jsonHeaders(allowOrigin),
        });
      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: clean(error?.message || "string_pluck_failed"), at: new Date().toISOString() }),
          { status: 502, headers: jsonHeaders(allowOrigin) }
        );
      }
    }

    if (url.pathname === "/api/string/recent") {
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "method_not_allowed" }), {
          status: 405,
          headers: jsonHeaders(allowOrigin),
        });
      }
      if (!(await checkRateLimit(env.RATE_LIMIT_STRING_GET, clientKey(request)))) {
        return tooManyRequests(allowOrigin);
      }
      try {
        const since = Number(url.searchParams.get("since")) || 0;
        const serverNow = Date.now();
        const cutoff = Math.max(since, serverNow - STRING_PLUCK_WINDOW_MS);
        const cursorCutoff = serverNow - STRING_CURSOR_WINDOW_MS;
        const [allPlucks, allCursors] = await Promise.all([
          readStringPlucks(env),
          readStringCursors(env),
        ]);
        const plucks = allPlucks.filter((p) => p.t > cutoff).slice(-STRING_PLUCK_MAX);
        const cursors = allCursors.filter((c) => c.t > cursorCutoff).slice(-STRING_CURSOR_MAX);
        return new Response(JSON.stringify({ plucks, cursors, serverNow }), {
          status: 200,
          headers: {
            ...jsonHeaders(allowOrigin),
            "cache-control": "public, max-age=1",
          },
        });
      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: clean(error?.message || "string_recent_failed"), at: new Date().toISOString() }),
          { status: 502, headers: jsonHeaders(allowOrigin) }
        );
      }
    }

    if (url.pathname === "/api/string/cursor") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "method_not_allowed" }), {
          status: 405,
          headers: jsonHeaders(allowOrigin),
        });
      }
      if (!(await checkRateLimit(env.RATE_LIMIT_STRING_CURSOR, clientKey(request)))) {
        return tooManyRequests(allowOrigin);
      }
      try {
        const body: any = await request.json().catch(() => ({}));
        const x = clamp01(body?.x);
        const claimed = clean(body?.who).slice(0, 16);
        const who = /^[0-9a-f]{6,16}$/i.test(claimed) ? claimed.toLowerCase() : await hashStringWho(clientKey(request));
        const t = Date.now();
        const cutoff = t - STRING_CURSOR_WINDOW_MS;
        const existing = await readStringCursors(env);
        const filtered = existing.filter((c) => c.who !== who && c.t >= cutoff);
        const next: StringCursor[] = [...filtered, { x, t, who }].slice(-STRING_CURSOR_MAX);
        await writeStringCursors(env, next);
        return new Response(JSON.stringify({ ok: true, t, who }), {
          status: 200,
          headers: jsonHeaders(allowOrigin),
        });
      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: clean(error?.message || "string_cursor_failed"), at: new Date().toISOString() }),
          { status: 502, headers: jsonHeaders(allowOrigin) }
        );
      }
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
