# /labs/repl sample bank

Each entry in `manifest.json` is a one-shot audio file fetched on demand by
`voices/sample.js` and triggered from the DSL by its `name`.

## Adding a sample

1. Drop the audio file in this directory. Recommended format: **mp3** or **ogg**,
   **22050 Hz mono**, **≤300 KB** per file. Trim leading silence — playback
   starts the instant the slot fires.
2. Add an entry to `manifest.json`:

   ```json
   {
     "version": 1,
     "samples": [
       { "name": "tub",      "file": "tub.mp3",      "source": "THE TUB · 2024 · field 03" },
       { "name": "praet-1",  "file": "praet-1.mp3",  "source": "Praetorius · sketch 2026-04" },
       { "name": "letgo-2",  "file": "letgo-2.mp3",  "source": "let go / letting go · stem" }
     ]
   }
   ```

   - `name` (required): a short lowercase id used in the DSL (e.g.
     `sample tub . . tub`). Letters, digits, hyphens, underscores.
   - `file` (optional): filename in this directory; defaults to `<name>.mp3`.
   - `source` (optional, free text): for the operator's records; not shown in
     the UI yet but reserved for a future "credits" surface.

3. Commit and deploy. The next visit to `/labs/repl` will fetch
   `manifest.json` fresh, so the new name is available without a code change.

## Bank caps (social, not enforced)

- Total bank under **5 MB**. The full bank is fetched lazily — only samples
  *referenced* in a running patch get downloaded — but a runaway bank turns
  the page into a slow first-paint for nobody's benefit.
- Per-file cap **500 KB**. Anything bigger is begging to be a Bandcamp link
  rather than a REPL voice.

## Why mono / 22 kHz?

These are one-shots played through the same compressor + master bus as the
string voice. Stereo and high sample rates buy almost nothing audibly through
that chain and double the bandwidth cost.
