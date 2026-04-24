type FeedItem = {
  source: string;
  text: string;
  at: string;
  url?: string;
  media?: string;
};

type SourceStatus = {
  status: "ok" | "missing_config" | "error";
  count: number;
  message?: string;
};

type Env = {
  FEED_ALLOW_ORIGIN?: string;
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
};

const jsonHeaders = (origin: string) => ({
  "access-control-allow-origin": origin,
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
});

const clean = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const stripTags = (value: string) => value.replace(/<[^>]+>/g, "");

const short = (value: unknown, max = 120) => {
  const text = clean(value);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

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
    const title = short(decodeHtml(clean((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "")), 108);
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
  let index = 0;
  while ((match = itemRegex.exec(html)) && items.length < limit) {
    const href = clean(match[1]);
    const title = short(stripTags(decodeHtml(clean(match[2]))), 96);
    if (!href || !title) continue;

    // Bandcamp /music listing does not expose reliable timestamps per item.
    // Preserve list ordering with stable synthetic times.
    const at = new Date(Date.now() - index * 60_000).toISOString();
    index += 1;

    items.push({
      source: "bandcamp",
      text: `release: ${title}`,
      at,
      url: href.startsWith("http") ? href : `https://${domain}${href}`,
    });
  }

  return items;
}

async function fetchInstagram(env: Env, limit: number): Promise<FeedItem[]> {
  const userId = clean(env.IG_USER_ID);
  const token = clean(env.IG_ACCESS_TOKEN);
  if (!userId || !token) return [];

  const query = `fields=id,caption,media_type,permalink,timestamp,media_url&limit=${Math.min(limit, 12)}&access_token=${encodeURIComponent(
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

  if (current.status === 200) {
    const payload: any = await current.json();
    const track = payload?.item;
    const artists = Array.isArray(track?.artists)
      ? track.artists.map((artist: any) => clean(artist?.name)).filter(Boolean).join(", ")
      : "";
    const name = clean(track?.name);
    const url = clean(track?.external_urls?.spotify || "");
    const uri = clean(track?.uri || "");
    return [
      {
        source: "spotify",
        text: `now playing: ${artists}${artists && name ? " — " : ""}${name}`,
        at: new Date().toISOString(),
        url: url || undefined,
        media: uri || undefined,
      },
    ];
  }

  const recentData: any = await fetchJson("https://api.spotify.com/v1/me/player/recently-played?limit=1", { headers });
  const recent = recentData?.items?.[0];
  const track = recent?.track;
  if (!track) return [];
  const artists = Array.isArray(track?.artists)
    ? track.artists.map((artist: any) => clean(artist?.name)).filter(Boolean).join(", ")
    : "";
  return [
    {
      source: "spotify",
      text: `last played: ${artists}${artists && track?.name ? " — " : ""}${clean(track?.name)}`,
      at: recent?.played_at || new Date().toISOString(),
      url: clean(track?.external_urls?.spotify || ""),
      media: clean(track?.uri || ""),
    },
  ];
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
    )}/tweets?exclude=retweets,replies&max_results=${Math.min(limit, 10)}&tweet.fields=created_at`,
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
    )}&part=snippet,id&order=date&maxResults=${Math.min(limit, 10)}`
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const allowOrigin = env.FEED_ALLOW_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: jsonHeaders(allowOrigin) });
    }

    if (url.pathname === "/api/feed") {
      const limit = Math.max(1, Math.min(40, Number(url.searchParams.get("limit")) || 24));

      const tasks: Array<[string, () => Promise<FeedItem[]>]> = [
        ["github", () => fetchGitHub(env, Math.min(limit, 8))],
        ["bandcamp", () => fetchBandcamp(env, Math.min(limit, 8))],
        ["instagram", () => fetchInstagram(env, Math.min(limit, 6))],
        ["spotify", () => fetchSpotify(env)],
        ["x", () => fetchX(env, Math.min(limit, 6))],
        ["youtube", () => fetchYouTube(env, Math.min(limit, 6))],
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

      const merged = items
        .filter((item) => item && item.text)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, limit);

      return new Response(
        JSON.stringify(
          {
            items: merged,
            sources,
            generatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        { status: 200, headers: jsonHeaders(allowOrigin) }
      );
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
