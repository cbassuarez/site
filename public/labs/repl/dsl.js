// DSL — score-grid notation parser. Each top-level "slot" can be a leaf
// token (note / rest / sustain / sample id) or a parenthesized group of
// slot tokens, which subdivides the slot's time evenly among its children.
// Groups can nest. Polyrhythms come for free: different voice blocks can
// declare different slot counts per bar; they all play in parallel.
//
// Public API:
//   ReplDSL.parse(text) → { ok: true, program } | { ok: false, errors }

(function (root) {
  'use strict';

    const VOICE_NAMES = new Set(['string', 'sample']);
    const PARAM_NAMES = new Set(['force', 'decay', 'crush', 'pan', 'gain', 'tone', 'harm', 'octave', 'every', 'rate', 'start', 'speed']);
    const EFFECT_NAMES = new Set(['compress', 'space', 'resonance', 'comb', 'grain', 'chorus', 'excite', 'blur', 'scar', 'body']);
    const BLOCK_DIRECTIVES = new Set(['attractor', 'source']);
    const FILE_DIRECTIVES = new Set(['tempo', 'meter']);

    const EFFECT_MODE_NAMES = {
      compress: new Set(['feedback', 'glue', 'clamp']),
      space: new Set(['memory', 'weather', 'room', 'horizon']),
      resonance: new Set(['pitch', 'memory', 'body']),
      comb: new Set(['pitch', 'body', 'rupture']),
      grain: new Set(['memory', 'scatter', 'freeze']),
      chorus: new Set(['drift', 'swarm', 'shimmer']),
      excite: new Set(['solar', 'rupture', 'electric']),
      blur: new Set(['weather', 'smoke', 'haze']),
      scar: new Set(['memory', 'rupture', 'ghost']),
      body: new Set(['wood', 'metal', 'glass', 'room', 'tub', 'paper', 'stone']),
    };

  const FORCE_NAMED = { pp: 0.18, p: 0.32, mp: 0.50, mf: 0.70, f: 0.88, ff: 1.05, fff: 1.20 };
  const PAN_NAMED = { left: -0.7, center: 0, right: 0.7 };
  const GAIN_NAMED = { quiet: 0.35, half: 0.55, full: 1.0, loud: 1.3 };
  const TONE_NAMED = { dark: 0.2, bright: 0.85 };
  const HARM_NAMED = { simple: 1, pair: 2, triad: 3, rich: 4 };

    const NOTE_RE = /^([A-Ga-g])([#b])?(-?\d{1,2})$/;
    const RANDOM_PITCH_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const RANDOM_PITCH_OCTAVES = [2, 3, 4, 5];

  function stripComment(line) {
    // `//` is a comment only at the start of a line or after whitespace.
    // Otherwise it can appear inside sample selector tokens like
    // `snm-*//tub-*` and must be left alone.
    let i = line.indexOf('//');
    while (i >= 0) {
      if (i === 0 || /\s/.test(line[i - 1])) {
        return line.slice(0, i);
      }
      i = line.indexOf('//', i + 1);
    }
    return line;
  }

    function isNoteToken(tok) { return NOTE_RE.test(tok); }
    function isPitchWildcardToken(tok) { return parsePitchWildcard(tok) !== null; }

    
    
    // *      → note-random, pitchClass null, octave null
   // *!     → note-random, frozen
    //*3     → note-random, fixed octave 3
    //*3!    → note-random, fixed octave 3, frozen
    //A*     → note-random, fixed pitch class A
   // A*!    → note-random, fixed pitch class A, frozen
   // C#*    → note-random, fixed pitch class C#, random octave
   // Bb*!   → note-random, fixed pitch class Bb, random octave, frozen
   // **     → rejected
    
    function pitchWildcardError(tok) {
      const raw = String(tok || '');

      if (raw === '**') {
        return `invalid pitch wildcard "**". Use "*" for one random pitch, or write "* *" for two random pitch events.`;
      }

      if (/^\*[0-8]!$/.test(raw)) {
        const octave = raw[1];
        return `invalid pitch wildcard "${raw}". Use "*!${octave}" to freeze a random pitch in octave ${octave}, or "*${octave}" for a new random pitch in octave ${octave} each event.`;
      }

      if (/^[A-Ga-g](?:#|b)?\*\*$/.test(raw)) {
        const pc = raw.slice(0, -2);
        return `invalid pitch wildcard "${raw}". Use "${pc}*" for random ${pc.toUpperCase()} octave or "${pc}*!" for frozen random ${pc.toUpperCase()} octave.`;
      }

      if (/^\*[A-Ga-g]/.test(raw)) {
        return `invalid pitch wildcard "${raw}". Use "*" for any pitch, "*4" for any pitch in octave 4, "*!4" for a frozen random pitch in octave 4, or "A*" for A in any octave.`;
      }

      if (/^\*!?\d{2,}/.test(raw)) {
        return `invalid pitch wildcard "${raw}". Octave wildcards use one digit, e.g. "*4" or "*!4".`;
      }

      return null;
    }

    function parsePitchWildcard(tok) {
      const raw = String(tok || '');

      // Explicit ambiguity guards. `**` is not a stronger wildcard and must not
      // be interpreted as two events with missing whitespace.
      if (raw === '**') return null;
      if (/^\*[0-8]!$/.test(raw)) return null;
      if (/^[A-Ga-g](?:#|b)?\*\*$/.test(raw)) return null;
      if (/^\*[A-Ga-g]/.test(raw)) return null;
      if (/^\*!?\d{2,}/.test(raw)) return null;

      if (raw === '*') {
        return {
          kind: 'note-random',
          value: {
            pitchClass: null,
            accidental: '',
            octave: null,
            frozen: false,
            raw,
          },
        };
      }

      if (raw === '*!') {
        return {
          kind: 'note-random',
          value: {
            pitchClass: null,
            accidental: '',
            octave: null,
            frozen: true,
            raw,
          },
        };
      }

      // *4 = random pitch class, fixed octave 4, rerolled every event.
      const fixedOctave = raw.match(/^\*([0-8])$/);
      if (fixedOctave) {
        return {
          kind: 'note-random',
          value: {
            pitchClass: null,
            accidental: '',
            octave: Number(fixedOctave[1]),
            frozen: false,
            raw,
          },
        };
      }

      // *!4 = frozen random pitch class, fixed octave 4.
      // `!` freezes the randomized axis, so `*4!` is intentionally invalid.
      const frozenFixedOctave = raw.match(/^\*!([0-8])$/);
      if (frozenFixedOctave) {
        return {
          kind: 'note-random',
          value: {
            pitchClass: null,
            accidental: '',
            octave: Number(frozenFixedOctave[1]),
            frozen: true,
            raw,
          },
        };
      }

      // A* / C#* / Bb* = fixed pitch class, random octave, rerolled every event.
      // A*! / C#*! / Bb*! = fixed pitch class, frozen random octave.
      const fixedPitchClass = raw.match(/^([A-Ga-g])([#b])?\*(!)?$/);
      if (fixedPitchClass) {
        return {
          kind: 'note-random',
          value: {
            pitchClass: fixedPitchClass[1].toUpperCase(),
            accidental: fixedPitchClass[2] || '',
            octave: null,
            frozen: fixedPitchClass[3] === '!',
            raw,
          },
        };
      }

      return null;
    }
    function isRestToken(tok) { return tok === '.' || tok === '-'; }
    function isSustainToken(tok) { return tok === '~'; }

    // Voice-leaf articulation:
    //   TOKEN; = gate this sound-producing leaf to the end of its rhythmic unit.
    //
    // This is intentionally handled at the voice-leaf level, not as a
    // sample-only feature. Params do not use ';'.
    function splitVoiceGateToken(tok) {
      const raw = String(tok || '');

      if (!raw.endsWith(';')) {
        return { raw, body: raw, gated: false, invalid: false };
      }

      const body = raw.slice(0, -1);

      // Do not allow meaningless gates on non-sounding leaves.
      if (!body || body === '.' || body === '-' || body === '~' || body === '|' || body === '(' || body === ')') {
        return { raw, body, gated: true, invalid: true };
      }

      return { raw, body, gated: true, invalid: false };
    }

    function voiceGateError(tok) {
      const split = splitVoiceGateToken(tok);
      if (!split.gated || !split.invalid) return null;
      return `';' can only gate sound-producing note or sample leaves — '${tok}' is not gateable`;
    }

    function isSampleToken(tok) {
      return /^[a-z][a-z0-9_-]*$/.test(tok)
        && !VOICE_NAMES.has(tok)
        && !PARAM_NAMES.has(tok)
        && !EFFECT_NAMES.has(tok)
        && !BLOCK_DIRECTIVES.has(tok);
    }

  // Parse a sample selector string: a single concrete name, a wildcard
  // prefix, or any number of those joined by `/`, optionally followed by
  // `&N` (gradient over N seconds) and/or `!` (freeze the random pick).
  // Returns the selector descriptor or null if the string isn't a valid
  // selector.
  //
  // Examples:
  //   'snm-014'                  → 1 concrete piece, no gradient, not frozen
  //   'snm-*'                    → 1 wildcard piece (prefix 'snm-')
  //   '*'                        → 1 wildcard piece (prefix '')
  //   'snm-*/tub-*'              → 2 wildcard pieces (union pool)
  //   'snm-*&30'                 → wildcard + 30s gradient
  //   'snm-*!'                   → frozen random pick
  //   'snm-*&30!'                → frozen pair, oscillating over 30s
  //   'snm-001/tub-*&30'         → concrete + wildcard, 30s gradient
    function parseSampleSelector(tok) {
      let frozen = false;
      let gated = false;
      let body = String(tok || '');

      // `;` is a sample articulation marker:
      //   *;                  gated one-shot
      //   snm-001;            gated concrete sample
      //   snm-001;/snm-002    gated union
      //   snm-*;&20           gated gradient
      //   snm-*&20!;          gated frozen gradient
      //
      // Accept `;` only at token/operator boundaries. Do not treat it as a
      // comment character and do not silently erase arbitrary internal semicolons.
      if (body.endsWith(';')) {
        gated = true;
        body = body.slice(0, -1);
      }
      if (body.includes(';')) {
        const normalized = body.replace(/;(?=[/&!])/g, '');
        if (normalized !== body) {
          gated = true;
          body = normalized;
        }
      }
      if (body.includes(';')) return null;

      if (body.endsWith('!')) {
        frozen = true;
        body = body.slice(0, -1);
      }

      let gradientSec = null;
      const gradMatch = body.match(/^(.+?)&(\d+(?:\.\d+)?)$/);
      if (gradMatch) {
        body = gradMatch[1];
        gradientSec = parseFloat(gradMatch[2]);
        if (!Number.isFinite(gradientSec) || gradientSec <= 0) return null;
      }

      if (body.length === 0) return null;

      const parts = body.split('/');
      if (parts.length === 0 || parts.some((p) => p.length === 0)) return null;

      const pieces = [];
      let hasWildcard = false;

      for (const part of parts) {
        if (part === '*') {
          pieces.push({ kind: 'wildcard', prefix: '' });
          hasWildcard = true;
          continue;
        }

        if (part.endsWith('*')) {
          const prefix = part.slice(0, -1);
          if (!/^[a-z][a-z0-9_-]*$/.test(prefix)) return null;
          pieces.push({ kind: 'wildcard', prefix });
          hasWildcard = true;
          continue;
        }

          if (
            /^[a-z][a-z0-9_-]*$/.test(part)
            && !VOICE_NAMES.has(part)
            && !PARAM_NAMES.has(part)
            && !EFFECT_NAMES.has(part)
            && !BLOCK_DIRECTIVES.has(part)
          ) {
            pieces.push({ kind: 'concrete', name: part });
            continue;
          }

        return null;
      }

      // A "selector" means anything that isn't just one bare concrete name.
      // `gated` also makes the token semantically non-plain, but we still allow
      // classifyLeaf() to preserve the old `{ kind: 'sample' }` shape for a
      // single concrete sample.
      const isAdvanced = hasWildcard || pieces.length > 1 || gradientSec != null || frozen;

      return {
        pieces,
        gradientSec,
        frozen,
        gated,
        isAdvanced,
        raw: tok,
      };
    }

  function noteToFreq(tok) {
    const m = tok.match(NOTE_RE);
    if (!m) return null;
    const name = m[1].toUpperCase();
    const accidental = m[2] || '';
    const octave = parseInt(m[3], 10);
    const semitoneOffsets = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    let semis = semitoneOffsets[name];
    if (semis == null) return null;
    if (accidental === '#') semis += 1;
    if (accidental === 'b') semis -= 1;
    const midi = (octave + 1) * 12 + semis;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // -------------------- slot tokenizer (paren-aware) --------------------

  // Tokenizes a string into a flat array of tokens where each token is
  // either:
  //   - a string (a leaf token like "A3", ".", "tub-xemf-mass", "|", "~")
  //   - the special markers "(" and ")"
  // Whitespace is the primary separator; parens always tokenize as their
  // own characters even when adjacent to text.
  function tokenizeSlotLine(text) {
    const out = [];
    let buf = '';
    function flush() {
      if (buf.length) { out.push(buf); buf = ''; }
    }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '(' || ch === ')') {
        flush();
        out.push(ch);
        continue;
      }
      if (/\s/.test(ch)) { flush(); continue; }
      buf += ch;
    }
    flush();
    return out;
  }

  // Build the slot AST from a flat token stream. Returns:
  //   { ok: true, slots: [SlotNode], bars: number }
  // SlotNode:
  //   { kind: 'leaf', token: { kind: 'note'|'rest'|'sustain'|'sample', value } }
  //   { kind: 'group', children: [SlotNode] }
  function parseSlotStream(tokens, voice, lineNumber) {
    const errors = [];

      function classifyLeaf(tok) {
        const gate = splitVoiceGateToken(tok);
        if (gate.invalid) return null;

        const body = gate.body;

        if (isRestToken(body)) return { kind: 'rest', value: null };
        if (isSustainToken(body)) return { kind: 'sustain', value: null };

        if (voice === 'string') {
          if (isNoteToken(body)) {
            const freq = noteToFreq(body);
            if (freq) {
              return {
                kind: 'note',
                value: { name: body, freq },
                gated: gate.gated === true,
              };
            }
          }

          const randomNote = parsePitchWildcard(body);
          if (randomNote) {
            randomNote.gated = gate.gated === true;
            return randomNote;
          }

          return null;
        }

        if (voice === 'sample') {
          const selector = parseSampleSelector(body);

          if (selector) {
            // A trailing ';' was stripped by splitVoiceGateToken(). Preserve
            // older selector-internal gate handling too, then normalize.
            selector.gated = selector.gated === true || gate.gated === true;

            if (!selector.isAdvanced && selector.pieces.length === 1 && selector.pieces[0].kind === 'concrete') {
              return {
                kind: 'sample',
                value: selector.pieces[0].name,
                gated: selector.gated === true,
              };
            }

            return {
              kind: 'sample-selector',
              value: selector,
              gated: selector.gated === true,
            };
          }

          return null;
        }

        return null;
      }

    let pos = 0;
    let bars = 1;
    const slots = [];

    function parseGroup() {
      const children = [];
      while (pos < tokens.length) {
        const t = tokens[pos];
        if (t === ')') {
          pos++;
          return { kind: 'group', children };
        }
        if (t === '(') {
          pos++;
          children.push(parseGroup());
          continue;
        }
        if (t === '|') {
          // Bar lines aren't allowed inside a group; treat as separator
          // ignored at top level only.
          pos++;
          errors.push({ line: lineNumber, message: `unexpected '|' inside (...) group — bar lines belong only between top-level slots` });
          continue;
        }
        const leaf = classifyLeaf(t);
          if (!leaf) {
            const gateError = voiceGateError(t);
            const stripped = splitVoiceGateToken(t);
            const wildcardError = voice === 'string'
              ? pitchWildcardError(stripped.body || t)
              : null;

            if (gateError) {
              errors.push({ line: lineNumber, message: gateError });
            } else if (wildcardError) {
              errors.push({ line: lineNumber, message: wildcardError });
            } else {
              const hint = voice === 'string'
                ? ` — voice 'string' takes notes like A3, C#4, Bb2, *, *!, *4, *!4, A*, A*!, and may gate them with ';'`
                : ` — voice 'sample' takes bank ids/selectors like tub-xither-forge, snm-*, snm-*&20, and may gate them with ';'`;
              errors.push({ line: lineNumber, message: `'${t}' isn't valid here${hint}` });
            }
            children.push({ kind: 'leaf', token: { kind: 'rest', value: null } });
            pos++;
            continue;
          }
        children.push({ kind: 'leaf', token: leaf });
        pos++;
      }
      // Unterminated group.
      errors.push({ line: lineNumber, message: `'(' wasn't closed by ')'` });
      return { kind: 'group', children };
    }

    while (pos < tokens.length) {
      const t = tokens[pos];
      if (t === '|') {
        bars++;
        pos++;
        continue;
      }
      if (t === '(') {
        pos++;
        slots.push(parseGroup());
        continue;
      }
      if (t === ')') {
        errors.push({ line: lineNumber, message: `extra ')' with no matching '('` });
        pos++;
        continue;
      }
      const leaf = classifyLeaf(t);
        if (!leaf) {
          const gateError = voiceGateError(t);
          const stripped = splitVoiceGateToken(t);
          const wildcardError = voice === 'string'
            ? pitchWildcardError(stripped.body || t)
            : null;

          if (gateError) {
            errors.push({ line: lineNumber, message: gateError });
          } else if (wildcardError) {
            errors.push({ line: lineNumber, message: wildcardError });
          } else {
            const hint = voice === 'string'
              ? ` — voice 'string' takes notes like A3, C#4, Bb2, *, *!, *4, *!4, A*, A*!, and may gate them with ';'`
              : ` — voice 'sample' takes bank ids/selectors like tub-xither-forge, snm-*, snm-*&20, and may gate them with ';'`;
            errors.push({ line: lineNumber, message: `'${t}' isn't valid here${hint}` });
          }
          slots.push({ kind: 'leaf', token: { kind: 'rest', value: null } });
          pos++;
          continue;
        }
      slots.push({ kind: 'leaf', token: leaf });
      pos++;
    }

    return { slots, bars, errors };
  }

    // -------------------- parameter resolution --------------------

    function parseParamOperator(raw) {
      const tok = String(raw || '').trim();
        
        if (tok === '*~') {
          return {
            ok: true,
            value: {
              kind: 'param-op',
              op: 'gesture-random',
              raw: tok,
            },
          };
        }

      if (tok === '*') {
        return { ok: true, value: { kind: 'param-op', op: 'random', raw: tok } };
      }

      if (tok === '~') {
        return { ok: true, value: { kind: 'param-op', op: 'hold', raw: tok } };
      }

      if (tok === '_') {
        return { ok: true, value: { kind: 'param-op', op: 'reset', raw: tok } };
      }

      if (tok === '*!') {
        return { ok: true, value: { kind: 'param-op', op: 'frozen-random', raw: tok } };
      }

      const driftMatch = tok.match(/^\*&(\d+(?:\.\d+)?)$/);
      if (driftMatch) {
        const seconds = Number(driftMatch[1]);
        if (Number.isFinite(seconds) && seconds > 0) {
          return {
            ok: true,
            value: {
              kind: 'param-op',
              op: 'drift',
              seconds,
              raw: tok,
            },
          };
        }
      }

      return null;
    }

    function parseNumericExpression(raw) {
      let s = String(raw || '').trim().toLowerCase();
      if (!s) return NaN;

      // Supported:
      //   pi
      //   2pi
      //   2*pi
      //   pi/4
      //   3/2
      //   2*3
      //   -1/2
      //
      // No eval / Function. No expression parentheses; parens already mean
      // stream grouping in this DSL.
      s = s.replace(/\s+/g, '');
      s = s.replace(/π/g, 'pi');
      s = s.replace(/(\d(?:\.\d+)?)pi/g, '$1*pi');

      if (!/^-?(?:\d+(?:\.\d+)?|pi)(?:[*/]-?(?:\d+(?:\.\d+)?|pi))*$/.test(s)) {
        return NaN;
      }

      const factors = s.split('*');
      let product = 1;

      for (const factor of factors) {
        if (factor === '') return NaN;

        const parts = factor.split('/');
        if (parts.length === 0) return NaN;

        let value = tokenToNumber(parts[0]);
        if (!Number.isFinite(value)) return NaN;

        for (let i = 1; i < parts.length; i++) {
          const denom = tokenToNumber(parts[i]);
          if (!Number.isFinite(denom) || denom === 0) return NaN;
          value /= denom;
        }

        product *= value;
      }

      return product;

      function tokenToNumber(tok) {
        if (tok === 'pi') return Math.PI;
        if (tok === '-pi') return -Math.PI;
        return Number(tok);
      }
    }

    function resolveParam(name, raw) {
      const paramOperator = parseParamOperator(raw);
      if (paramOperator) return paramOperator;

      const lower = String(raw).toLowerCase();
      const num = parseNumericExpression(raw);

    switch (name) {
      case 'force':
        if (lower in FORCE_NAMED) return { ok: true, value: FORCE_NAMED[lower] };
        if (Number.isFinite(num)) return { ok: true, value: clamp(num, 0, 1) };
        return { ok: false, message: `force '${raw}' isn't a dynamic — use pp p mp mf f ff fff or 0–1` };

      case 'decay':
        if (Number.isFinite(num)) return { ok: true, value: clamp(num, 0.4, 8) };
        return { ok: false, message: `decay must be a number of seconds (0.4–8)` };

      case 'crush':
        if (lower === 'off' || raw === '0') return { ok: true, value: 0 };
        if (Number.isFinite(num)) return { ok: true, value: clamp(Math.round(num), 4, 16) };
        return { ok: false, message: `crush must be 0/off or 4–16` };

      case 'pan':
        if (lower in PAN_NAMED) return { ok: true, value: PAN_NAMED[lower] };
        if (Number.isFinite(num)) return { ok: true, value: clamp(num, -1, 1) };
        return { ok: false, message: `pan '${raw}' — use left/center/right or -1..1` };

      case 'gain':
        if (lower in GAIN_NAMED) return { ok: true, value: GAIN_NAMED[lower] };
        if (Number.isFinite(num)) return { ok: true, value: clamp(num, 0, 1.5) };
        return { ok: false, message: `gain '${raw}' — use quiet/half/full/loud or 0–1.5` };

      case 'tone':
        if (lower in TONE_NAMED) return { ok: true, value: TONE_NAMED[lower] };
        if (Number.isFinite(num)) return { ok: true, value: clamp(num, 0, 1) };
        return { ok: false, message: `tone '${raw}' — use dark/bright or 0–1` };

      case 'harm':
        if (lower in HARM_NAMED) return { ok: true, value: HARM_NAMED[lower] };
        if (Number.isFinite(num)) return { ok: true, value: clamp(Math.round(num), 0, 4) };
        return { ok: false, message: `harm '${raw}' — use simple/pair/triad/rich or 0–4` };

      case 'octave':
        if (Number.isFinite(num)) return { ok: true, value: clamp(Math.round(num), -2, 2) };
        return { ok: false, message: `octave must be an integer ±2` };

      case 'rate':
        if (Number.isFinite(num)) return { ok: true, value: clamp(num, 0.25, 4) };
        return { ok: false, message: `rate must be a number 0.25–4` };

        case 'start':
          if (Number.isFinite(num)) return { ok: true, value: Math.max(0, num) };
          return { ok: false, message: `start must be a non-negative number of seconds` };

        case 'speed':
          if (Number.isFinite(num)) return { ok: true, value: clamp(num, 0.0625, 16) };
          return { ok: false, message: `speed '${raw}' — use a factor like 2, 1/2, pi/4, *, *!, or *&8` };

        default:
          return { ok: false, message: `unknown parameter '${name}'` };
      }
    }
    
    function resolveEffect(name, raw) {
      const paramOperator = parseParamOperator(raw);
      if (paramOperator) return paramOperator;

      const lower = String(raw || '').toLowerCase();
      const num = parseNumericExpression(raw);

      if (Number.isFinite(num)) {
        return { ok: true, value: clamp(num, 0, 1) };
      }

      const modes = EFFECT_MODE_NAMES[name];
      if (modes && modes.has(lower)) {
        return {
          ok: true,
          value: {
            kind: 'effect-mode',
            effect: name,
            mode: lower,
            raw,
          },
        };
      }

      return {
        ok: false,
        message: `${name} '${raw}' — use 0..1, *, ~, _, *!, *&N, *~, or a supported named mode`,
      };
    }
    // Build a parameter/control stream from the same paren-aware token stream
    // used by voice rows. Groups do not create time by themselves; they only
    // make control rhythms readable. The result is flattened before storage so
    // the scheduler can keep using scalar/vector param rows.
    //
    // Examples:
    //   decay (* 1 1 1) (* 1 1 1)
    //   pan   (left right) (center *)
    //   gain  (0.8 ~) (_ *!)
    //
    // ParamNode:
    //   { kind: 'leaf', value }
    //   { kind: 'group', children: [ParamNode] }
    function parseParamStream(tokens, paramName, lineNumber, resolver) {
      const errors = [];
      const nodes = [];
      let pos = 0;
        const resolveValue = typeof resolver === 'function' ? resolver : resolveParam;

      function parseValue(tok) {
          const r = resolveValue(paramName, tok);
        if (!r.ok) {
          errors.push({ line: lineNumber, message: r.message });
          return { kind: 'leaf', value: null, invalid: true };
        }
        return { kind: 'leaf', value: r.value };
      }

      function parseGroup() {
        const children = [];

        while (pos < tokens.length) {
          const t = tokens[pos];

          if (t === ')') {
            pos++;
            if (children.length === 0) {
              errors.push({ line: lineNumber, message: `empty parameter group in ${paramName}` });
            }
            return { kind: 'group', children };
          }

          if (t === '(') {
            pos++;
            children.push(parseGroup());
            continue;
          }

          if (t === '|') {
            pos++;
            errors.push({ line: lineNumber, message: `unexpected '|' inside (...) group — bar lines belong only between top-level values` });
            continue;
          }

          children.push(parseValue(t));
          pos++;
        }

        errors.push({ line: lineNumber, message: `'(' wasn't closed by ')' in ${paramName}` });
        if (children.length === 0) {
          errors.push({ line: lineNumber, message: `empty parameter group in ${paramName}` });
        }
        return { kind: 'group', children };
      }

      while (pos < tokens.length) {
        const t = tokens[pos];

        if (t === '|') {
          pos++;
          continue;
        }

        if (t === '(') {
          pos++;
          nodes.push(parseGroup());
          continue;
        }

        if (t === ')') {
          errors.push({ line: lineNumber, message: `extra ')' with no matching '(' in ${paramName}` });
          pos++;
          continue;
        }

        nodes.push(parseValue(t));
        pos++;
      }

      return { nodes, errors };
    }

    function flattenParamNodes(nodes) {
      const out = [];

      function visit(node) {
        if (!node) return;

        if (node.kind === 'leaf') {
          if (!node.invalid) out.push(node.value);
          return;
        }

        if (node.kind === 'group') {
          for (const child of node.children) visit(child);
        }
      }

      for (const node of nodes) visit(node);
      return out;
    }
    
    function parseAttractorLine(tail, lineNumber) {
      const args = tail.trim().split(/\s+/).filter(Boolean);
      if (!args.length) {
        return {
          ok: false,
          error: { line: lineNumber, message: `attractor needs a name, e.g. attractor weather, quake, tide, solar, archive, or tub` },
        };
      }

      const raw = args[0].toLowerCase();
      if (!/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/.test(raw)) {
        return {
          ok: false,
          error: { line: lineNumber, message: `attractor '${args[0]}' must look like weather, weather.dew, quake.local, tide, solar.flare, archive, or tub` },
        };
      }

      return {
        ok: true,
        value: {
          raw,
          source: {},
        },
      };
    }

    function parseSourceLine(tail, lineNumber) {
      const args = tail.trim().split(/\s+/).filter(Boolean);
      if (args.length < 2) {
        return {
          ok: false,
          error: { line: lineNumber, message: `source must read like 'source station KLAX', 'source coords 34.05,-118.25', 'source feed all_day', or 'source radius 500km'` },
        };
      }

      const key = args[0].toLowerCase();
      if (!/^[a-z][a-z0-9_-]*$/.test(key)) {
        return {
          ok: false,
          error: { line: lineNumber, message: `source key '${args[0]}' must be a simple word like station, coords, feed, radius, city, or region` },
        };
      }

      return {
        ok: true,
        key,
        value: args.slice(1).join(' '),
      };
    }

    // -------------------- main parse --------------------

  function parse(text) {
    const errors = [];
    const blocks = [];
    let tempo = 110;
    let meter = { num: 4, den: 4 };

    const rawLines = String(text).replace(/\r\n?/g, '\n').split('\n');

    let currentBlock = null;

    function endBlock() {
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
    }

    for (let i = 0; i < rawLines.length; i++) {
      const lineNumber = i + 1;
      const stripped = stripComment(rawLines[i]).trimEnd();
      const trimmedForCheck = stripped.trim();

      if (!trimmedForCheck) {
        endBlock();
        continue;
      }

      // Tokenize the line. For voice/param classification we only need the
      // first whitespace-delimited word.
      const firstSpace = trimmedForCheck.search(/\s/);
      const head = (firstSpace < 0 ? trimmedForCheck : trimmedForCheck.slice(0, firstSpace)).toLowerCase();
      const tail = firstSpace < 0 ? '' : trimmedForCheck.slice(firstSpace + 1);

      // ---- file-level directives ----
      if (FILE_DIRECTIVES.has(head)) {
        if (currentBlock) endBlock();
        const args = tail.trim().split(/\s+/).filter(Boolean);
        if (head === 'tempo') {
          const t = Number(args[0]);
          if (!Number.isFinite(t) || t <= 0) {
            errors.push({ line: lineNumber, message: `tempo needs a positive bpm number` });
          } else {
            tempo = t;
          }
        } else if (head === 'meter') {
          const m = String(args[0] || '').match(/^(\d+)\/(\d+)$/);
          if (!m) {
            errors.push({ line: lineNumber, message: `meter must be like 4/4 or 6/8` });
          } else {
            meter = { num: parseInt(m[1], 10), den: parseInt(m[2], 10) };
          }
        }
        continue;
      }

      // ---- voice line ----
      if (VOICE_NAMES.has(head)) {
        endBlock();
        const slotTokens = tokenizeSlotLine(tail);
        if (slotTokens.length === 0) {
          errors.push({ line: lineNumber, message: `voice '${head}' has no slots — add some notes or rests after it` });
          continue;
        }
        const result = parseSlotStream(slotTokens, head, lineNumber);
        if (result.errors.length) {
          for (const e of result.errors) errors.push(e);
        }
        const slots = result.slots;
        const bars = result.bars;
        if (slots.length === 0) {
          errors.push({ line: lineNumber, message: `no slots parsed from '${tail}'` });
          continue;
        }
        if (slots.length % bars !== 0) {
          errors.push({ line: lineNumber, message: `bar count (${bars}) doesn't divide slot count (${slots.length}) evenly` });
        }
          currentBlock = {
            voice: head,
            slots,
            slotsPerBar: Math.max(1, Math.floor(slots.length / bars)),
            bars,
            params: {},
            effects: {},
            speed: { kind: 'scalar', value: 1 },
            attractor: null,
            source: {},
            paramLines: {},
            every: null,
            line: lineNumber,
          };
        continue;
      }
        
        // ---- block directives ----
        if (BLOCK_DIRECTIVES.has(head)) {
          if (!currentBlock) {
            errors.push({ line: lineNumber, message: `directive '${head}' has no voice above it — start a voice block first (string ... or sample ...)` });
            continue;
          }

          if (head === 'attractor') {
            const parsed = parseAttractorLine(tail, lineNumber);
            if (!parsed.ok) {
              errors.push(parsed.error);
              continue;
            }
            currentBlock.attractor = parsed.value;
            currentBlock.attractor.source = { ...(currentBlock.source || {}) };
            currentBlock.paramLines.attractor = lineNumber;
            continue;
          }

          if (head === 'source') {
            const parsed = parseSourceLine(tail, lineNumber);
            if (!parsed.ok) {
              errors.push(parsed.error);
              continue;
            }

            currentBlock.source = currentBlock.source || {};
            currentBlock.source[parsed.key] = parsed.value;

            if (currentBlock.attractor) {
              currentBlock.attractor.source = { ...currentBlock.source };
            }

            currentBlock.paramLines[`source.${parsed.key}`] = lineNumber;
            continue;
          }
        }
        
        // ---- effect surface line ----
        if (EFFECT_NAMES.has(head)) {
          if (!currentBlock) {
            errors.push({ line: lineNumber, message: `effect '${head}' has no voice above it — start a voice block first (string ... or sample ...)` });
            continue;
          }

          const valueTokens = tokenizeSlotLine(tail);
          if (valueTokens.length === 0) {
            errors.push({ line: lineNumber, message: `${head} needs at least one value` });
            continue;
          }

          const parsedEffects = parseParamStream(valueTokens, head, lineNumber, resolveEffect);
          if (parsedEffects.errors.length) {
            for (const e of parsedEffects.errors) errors.push(e);
            continue;
          }

          const resolved = flattenParamNodes(parsedEffects.nodes);
          if (resolved.length === 0) {
            errors.push({ line: lineNumber, message: `${head} needs at least one value` });
            continue;
          }

          currentBlock.effects[head] = resolved.length === 1
            ? { kind: 'scalar', value: resolved[0] }
            : { kind: 'vector', values: resolved };

          currentBlock.paramLines[head] = lineNumber;
          continue;
        }

      // ---- parameter line ----
      if (PARAM_NAMES.has(head)) {
        if (!currentBlock) {
          errors.push({ line: lineNumber, message: `parameter '${head}' has no voice above it — start a voice block first (string ... or sample ...)` });
          continue;
        }

        if (head === 'every') {
          const args = tail.trim().split(/\s+/).filter(Boolean);
          const count = Number(args[0]);
          const unit = String(args[1] || '').toLowerCase();
          if (!Number.isFinite(count) || count <= 0 || (unit !== 'bars' && unit !== 'beats')) {
            errors.push({ line: lineNumber, message: `every must read like 'every 4 bars' or 'every 8 beats'` });
            continue;
          }
          currentBlock.every = { count: Math.round(count), unit };
          currentBlock.paramLines.every = lineNumber;
          continue;
        }

          // Parameter rows are control streams. They use the same
          // parenthesized grammar as voice rows, then flatten left-to-right
          // for event-leaf indexing in the scheduler. Bar dividers are allowed
          // only between top-level values and are ignored for flattening.
          //
          // Values may be literal resolved numbers or event-time control atoms:
          //   *   random legal value
          //   ~   hold previous resolved value
          //   _   reset/default
          //   *!  frozen random value for this param position
          //   *&N drifting random window over N seconds
          //
          // These are equivalent:
          //   decay (* 1 1 1) (* 1 1 1)
          //   decay * 1 1 1 * 1 1 1
        const valueTokens = tokenizeSlotLine(tail);
        if (valueTokens.length === 0) {
          errors.push({ line: lineNumber, message: `${head} needs at least one value` });
          continue;
        }

        const parsedParams = parseParamStream(valueTokens, head, lineNumber);
        if (parsedParams.errors.length) {
          for (const e of parsedParams.errors) errors.push(e);
          continue;
        }

        const resolved = flattenParamNodes(parsedParams.nodes);
        if (resolved.length === 0) {
          errors.push({ line: lineNumber, message: `${head} needs at least one value` });
          continue;
        }

          const stream = resolved.length === 1
            ? { kind: 'scalar', value: resolved[0] }
            : { kind: 'vector', values: resolved };

          if (head === 'speed') {
            currentBlock.speed = stream;
          } else {
            currentBlock.params[head] = stream;
          }

          currentBlock.paramLines[head] = lineNumber;
          continue;
      }

      // ---- unknown ----
      errors.push({
        line: lineNumber,
          message: `don't recognize '${head}' — start a voice line (string ..., sample ...), set a parameter/effect row, or set an attractor/source`,
      });
    }

    endBlock();

    if (errors.length > 0) {
      return { ok: false, errors };
    }

    // Pre-resolve sustain leaves (~) to the immediately-preceding note in
    // DFS order. Loop-around is handled at runtime; the very first leaf
    // before any note is converted to a rest.
    for (const block of blocks) resolveSustains(block.slots);

    return {
      ok: true,
      program: { tempo, meter, blocks },
    };
  }

  function resolveSustains(slots) {
    let lastNoteValue = null;
    function visit(node) {
      if (node.kind === 'leaf') {
        const tok = node.token;
        if (tok.kind === 'note') {
          lastNoteValue = tok.value;
          return;
        }
        if (tok.kind === 'sustain') {
          if (lastNoteValue) {
            node.token = { kind: 'note', value: { ...lastNoteValue, sustained: true } };
          } else {
            node.token = { kind: 'rest', value: null };
          }
          return;
        }
        return;
      }
      if (node.kind === 'group') {
        for (const child of node.children) visit(child);
      }
    }
    for (const s of slots) visit(s);
  }

  root.ReplDSL = { parse };
})(window);
