# AGENTS.md

Operating notes for AI collaborators working in this repo.

## Labs front-end: no decorative CSS

We optimize for **connection** — literal (working APIs, real-time data flow,
multi-user state, low latency where it matters and embraced latency where it
doesn't) and colloquial (the viewer's relationship to the work). And for
**function**: it works, it works well, it doesn't break.

We don't add: decorative typography, color palettes, atmospheric HUDs,
animation that doesn't carry information, framework chrome, brand overlays,
loading skeletons, ornamental transitions.

We allow only the bare CSS required to make the canvas / audio / data layer
mechanically correct — `margin: 0`, `overflow: hidden`, `touch-action: none`,
full-bleed sizing, `display: block` on canvas. Inline it in a `<style>` block
in `index.html`. No separate stylesheet, no fonts loaded, no Praetorius
brand assets pulled in.

Visual character lives inside the work itself — the canvas drawing, the
Web Audio output, the live network state — not in a layer applied on top.
Beauty is a byproduct of the thing working, not a finish.

If a lab needs to show text (title, hint, instruction), draw it into the
canvas with `ctx.fillText` or render it as a single unstyled DOM node.
Browser defaults handle the rest.

**Scope: labs only** (`/labs/*`, served from `public/labs/`). The main site
(`/`, `/works`, `/contact`, `/about`) and the Praetorius-skinned outputs
(`/labs/works-list/`, `/labs/work-list/`) keep their branded design system —
those are different work.

## What "connection" means in practice

When proposing a new lab or extending an existing one, the test is:

- **Literal connection.** Does it talk to the seb-feed worker, TMAYD, or
  another live API? Does it share state across visitors? Does an action by
  one viewer change what another viewer experiences? If none of these, it
  isn't a lab — it's a static page.
- **Colloquial connection.** Does the work hold the viewer's attention?
  Does it invite return? Does the viewer leave with a relationship to it,
  not just a screenshot of it?

Labs that fail both tests don't ship. Labs that pass one test should be
honest about which one — a meditative solo piece (colloquial only) is
fine, but call it that and don't fake a multi-user surface.

## Existing live API surfaces

- **seb-feed worker** (`worker/src/index.ts`, deployed at
  `https://seb-feed.cbassuarez.workers.dev`):
  - `GET /api/feed` — aggregated platform timeline
  - `GET /api/hit` — visitor counter
  - `GET|POST /api/guestbook` — signed entries
  - `POST /api/string/pluck`, `GET /api/string/recent` — shared string
    instrument
  - `GET /api/health`
  - KV: `HITS_KV` (single namespace, multiple keys)
  - Adding a new lab route: mirror the existing pattern (rate-limit binding
    in `wrangler.toml`, `Env` field, route in `default.fetch`, KV ring
    buffer or counter helpers near the existing ones).
- **TMAYD external API** (separate backend, consumed by `/labs/tell-me-about-your-day`):
  - `GET /api/tmayd/{status,live/latest,reels/today,reels/:date}`
  - `POST /api/tmayd/submissions`
  - Configured via `VITE_TMYD_API_BASE`; degrades to offline mock.

## Things to avoid

- Pulling React or any framework into a lab page. Labs are vanilla
  HTML/JS/Canvas/WebAudio.
- Loading webfonts in labs. System fonts only, and only when text is
  necessary for the work.
- Adding a new KV namespace when `HITS_KV` will do.
- Adding Durable Objects, WebSockets, or any infra step beyond a new route
  + rate limit on the existing worker — unless the piece literally cannot
  exist without it.
- Persisting user input beyond what the piece needs. Labs are durational
  and ephemeral by default; a 60–90s ring buffer beats permanent storage.
- Identifying visitors. Hashed per-IP `who` tokens, scoped to the current
  lab, are the maximum identity surface.
