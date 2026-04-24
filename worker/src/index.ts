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
};

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

  const spotifyLive = ordered.find((item) => sourceBase(item.source) === "spotify" && Boolean(item.isPlaying));
  if (spotifyLive) return build(spotifyLive, true);

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

  const items: FeedItem[] = [];

  if (current.status === 200) {
    const payload: any = await current.json();
    const track = payload?.item;
    const artists = Array.isArray(track?.artists)
      ? track.artists.map((artist: any) => clean(artist?.name)).filter(Boolean).join(", ")
      : "";
    const name = clean(track?.name);
    const url = clean(track?.external_urls?.spotify || "");
    const uri = clean(track?.uri || "");
    items.push({
      source: "spotify",
      text: `now playing: ${artists}${artists && name ? " — " : ""}${name}`,
      at: new Date().toISOString(),
      url: url || undefined,
      media: uri || undefined,
      progressMs: Number.isFinite(payload?.progress_ms) ? payload.progress_ms : 0,
      durationMs: Number.isFinite(track?.duration_ms) ? track.duration_ms : 0,
      isPlaying: Boolean(payload?.is_playing),
    });
  }

  const recentData: any = await fetchJson("https://api.spotify.com/v1/me/player/recently-played?limit=50", { headers });
  const recents = Array.isArray(recentData?.items) ? recentData.items : [];
  for (const recent of recents) {
    const track = recent?.track;
    if (!track) continue;
    const artists = Array.isArray(track?.artists)
      ? track.artists.map((artist: any) => clean(artist?.name)).filter(Boolean).join(", ")
      : "";
    items.push({
      source: "spotify",
      text: `last played: ${artists}${artists && track?.name ? " — " : ""}${clean(track?.name)}`,
      at: recent?.played_at || new Date().toISOString(),
      url: clean(track?.external_urls?.spotify || ""),
      media: clean(track?.uri || ""),
      progressMs: 0,
      durationMs: Number.isFinite(track?.duration_ms) ? track.duration_ms : 0,
      isPlaying: false,
    });
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
  const legacyKey = "hits:landing-v1";

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
  await kv.delete(legacyKey);

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

async function readFeedTimeline(env: Env): Promise<FeedItem[]> {
  const kv = env.HITS_KV;
  if (!kv) return [];

  const raw = await kv.get("feed:timeline-v1");
  if (!raw) return [];

  try {
    const parsed: any = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: any) => ({
        source: clean(item?.source || "feed"),
        text: clean(item?.text || ""),
        at: clean(item?.at || ""),
        url: clean(item?.url || ""),
        media: clean(item?.media || ""),
        progressMs: Number.isFinite(item?.progressMs) ? item.progressMs : 0,
        durationMs: Number.isFinite(item?.durationMs) ? item.durationMs : 0,
        isPlaying: Boolean(item?.isPlaying),
      }))
      .filter((item: FeedItem) => item.text.length > 0 && item.at.length > 0);
  } catch {
    return [];
  }
}

async function writeFeedTimeline(env: Env, items: FeedItem[]): Promise<void> {
  const kv = env.HITS_KV;
  if (!kv) return;
  await kv.put("feed:timeline-v1", JSON.stringify(items));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const allowOrigin = env.FEED_ALLOW_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: jsonHeaders(allowOrigin) });
    }

    if (url.pathname === "/api/feed") {
      const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get("limit")) || 24));
      const sourceWindow = Math.min(limit, 120);

      const tasks: Array<[string, () => Promise<FeedItem[]>]> = [
        ["github", () => fetchGitHub(env, sourceWindow)],
        ["bandcamp", () => fetchBandcamp(env, sourceWindow)],
        ["instagram", () => fetchInstagram(env, sourceWindow)],
        ["spotify", () => fetchSpotify(env)],
        ["x", () => fetchX(env, sourceWindow)],
        ["youtube", () => fetchYouTube(env, sourceWindow)],
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

      const historical = await readFeedTimeline(env);
      const merged = [...items, ...historical]
        .filter((item) => item && item.text)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .filter((item, index, array) => {
          const key = `${item.source}|${item.at}|${item.url || ""}|${item.text}`;
          return array.findIndex((candidate) => {
            const candidateKey = `${candidate.source}|${candidate.at}|${candidate.url || ""}|${candidate.text}`;
            return candidateKey === key;
          }) === index;
        });

      const persisted = merged.slice(0, 5000);
      await writeFeedTimeline(env, persisted);

      return new Response(
        JSON.stringify(
          {
            items: persisted.slice(0, limit),
            sources,
            currentActivity: selectCurrentActivity(persisted),
            generatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        { status: 200, headers: jsonHeaders(allowOrigin) }
      );
    }

    if (url.pathname === "/api/hit") {
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
        try {
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
};
