# Feed Worker Setup

This project now expects a feed API endpoint at:

- `GET /api/feed`

Frontend config:

- set `VITE_FEED_API_BASE` in `.env` to your Worker origin (for example `https://seb-feed.<account>.workers.dev`)

## 1) Deploy Worker

From `/Users/seb/Documents/site/worker`:

```bash
npx wrangler login
npx wrangler deploy
```

## 2) Set Secrets

Set allow origin (recommended: your main site origin):

```bash
echo "https://cbassuarez.com" | npx wrangler secret put FEED_ALLOW_ORIGIN
```

Hit counter baseline (recommended):

```bash
# Option A: Automatic baseline from Cloudflare Analytics API
echo "<CLOUDFLARE_ZONE_ID>" | npx wrangler secret put CF_ZONE_ID
echo "<CLOUDFLARE_API_TOKEN_WITH_ZONE_ANALYTICS_READ>" | npx wrangler secret put CF_API_TOKEN
echo "2026-04-24" | npx wrangler secret put CF_ANALYTICS_SINCE

# Option B: Manual baseline (copy total hits from Cloudflare dashboard once)
echo "<BASELINE_NUMBER>" | npx wrangler secret put HITS_BASELINE
```

Note: Cloudflare GraphQL zone analytics only exposes about the most recent 52 weeks. If you need all-time history older than that, set `HITS_BASELINE` manually.

GitHub:

```bash
echo "cbassuarez" | npx wrangler secret put GITHUB_USERNAME
```

Bandcamp:

```bash
echo "cbassuarez.bandcamp.com" | npx wrangler secret put BANDCAMP_DOMAIN
```

Instagram:

```bash
echo "<IG_USER_ID>" | npx wrangler secret put IG_USER_ID
echo "<IG_ACCESS_TOKEN>" | npx wrangler secret put IG_ACCESS_TOKEN
```

Spotify:

```bash
echo "<SPOTIFY_CLIENT_ID>" | npx wrangler secret put SPOTIFY_CLIENT_ID
echo "<SPOTIFY_CLIENT_SECRET>" | npx wrangler secret put SPOTIFY_CLIENT_SECRET
echo "<SPOTIFY_REFRESH_TOKEN>" | npx wrangler secret put SPOTIFY_REFRESH_TOKEN
```

X / Twitter (optional):

```bash
echo "<X_USERNAME>" | npx wrangler secret put X_USERNAME
echo "<X_BEARER_TOKEN>" | npx wrangler secret put X_BEARER_TOKEN
```

YouTube (optional):

```bash
echo "<YT_CHANNEL_ID>" | npx wrangler secret put YT_CHANNEL_ID
echo "<YT_API_KEY>" | npx wrangler secret put YT_API_KEY
```

## 3) Point Frontend to Worker

In `/Users/seb/Documents/site/.env`:

```bash
VITE_FEED_API_BASE=https://seb-feed.<account>.workers.dev
```

Then run:

```bash
npm run dev
```

## 4) Spotify Refresh Token

Scopes needed:

- `user-read-currently-playing`
- `user-read-playback-state`
- `user-read-recently-played`

Use Spotify's OAuth Authorization Code flow once, then store the refresh token in Worker secrets.

Quick helper included in this repo:

```bash
cd /Users/seb/Documents/site/worker
SPOTIFY_CLIENT_ID="<id>" SPOTIFY_CLIENT_SECRET="<secret>" node tools/spotify-refresh-helper.mjs
```

Open the URL it prints, approve, then copy the printed `refresh_token` into Worker secrets.
