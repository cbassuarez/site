# TMAYD Labs Route

## Canonical route

- `/labs/tell-me-about-your-day`

### Supported subroutes

- `/labs/tell-me-about-your-day/reel/YYYY-MM-DD`
- `/labs/tell-me-about-your-day/day/DAY-YYYYMMDD-0001`

Subroutes degrade safely to the main TMAYD page if parameters are invalid or not found.

## Environment variables

- `VITE_TMYD_API_BASE`
- `VITE_TMYAD_API_BASE` (legacy typo alias; temporary compatibility)

Resolution order in client:

1. `VITE_TMYD_API_BASE`
2. `VITE_TMYAD_API_BASE`
3. if neither exists, run in mock/offline preview mode

## Expected external API endpoints

The site calls a separate TMAYD backend API. These endpoints are not implemented in this site repo.

- `GET  {API_BASE}/api/tmayd/status`
- `GET  {API_BASE}/api/tmayd/live/latest`
- `GET  {API_BASE}/api/tmayd/reels/today`
- `GET  {API_BASE}/api/tmayd/reels/:date`
- `POST {API_BASE}/api/tmayd/submissions`

## Status response shape

```json
{
  "status": "inactive",
  "intakeOpen": true,
  "printingOpen": true,
  "archiveOpen": true,
  "lastHeartbeatAt": "2026-04-28T08:41:00Z",
  "message": "optional public-safe status"
}
```

Client normalizes this defensively and falls back to mock/offline states when unavailable.

## Live frame response shape

```json
{
  "status": "idle",
  "imageUrl": "https://.../live/latest.jpg",
  "observedAt": "2026-04-28T08:41:00Z",
  "width": 1920,
  "height": 1080,
  "caption": "optional public-safe caption"
}
```

If `imageUrl` is present, the client adds a cache-busting query token per poll refresh.

## Submission response handling

Client supports normalized outcomes:

- `accepted`
- `rejected` (`kind: soft|hard`)
- `rate_limited`
- `unavailable`

Compatibility mappings for `soft_rejected`/`hard_rejected` are included.

The site never logs submitted text to console and never echoes rejected raw text back from local client state.

## Reel manifest shape (manifest-first)

```json
{
  "date": "2026-04-28",
  "reelId": "R20260428-A",
  "status": "open",
  "generatedAt": "2026-04-28T08:41:00Z",
  "frames": [
    {
      "publicCode": "DAY-20260428-0001",
      "capturedAt": "2026-04-28T08:12:44Z",
      "thumbUrl": "/captures/2026-04-28/DAY-20260428-0001.thumb.jpg",
      "cropUrl": "/captures/2026-04-28/DAY-20260428-0001.crop.jpg",
      "rawUrl": "/captures/2026-04-28/DAY-20260428-0001.raw.jpg",
      "width": 1200,
      "height": 1800
    }
  ],
  "derived": {
    "contactSheetUrl": "/reels/2026-04-28/contact-sheet.jpg",
    "stripUrls": ["/reels/2026-04-28/strip-0001.jpg"],
    "timelapseUrl": "/reels/2026-04-28/timelapse.mp4"
  }
}
```

### Why manifest-first

- avoids dependence on giant stitched images
- supports incremental ingest per frame
- keeps viewer resilient to partial generation failures
- supports multiple derived artifacts (contact sheet, strips, timelapse)

## Mock/offline behavior

When no API base is configured or API is offline:

- status, live frame, and reel views render with mock/offline preview data
- submission returns unavailable messaging
- page remains inspectable and navigable

## Separation from seb-feed

TMAYD backend remains separate from the existing seb-feed worker.

Reasons:

- different privacy and moderation requirements
- separate operational cadence and failure modes
- clearer blast-radius boundaries
- cleaner future deployment and permissions model
