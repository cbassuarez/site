// repl-editor.js — CodeMirror 6 editor adapter for /labs/repl.
//
// The CodeMirror runtime is bundled into window.CMRepl by
// scripts/build-repl-cm.mjs (entry: scripts/repl-cm-entry.js). The repl is
// served as static assets under public/, so we can't import from npm at
// runtime; this file consumes the bundle and exposes window.createReplEditor.
//
// Adapter contract is documented at the bottom of the file (createReplEditor).
// repl.js owns transport and only ever reads/writes the document through
// the returned API — never touching the contentDOM directly.

(function (root) {
  'use strict';

  if (!root.CMRepl) {
    // Bundle missing — fail loud so the page still renders something useful.
    // repl.js will detect a missing window.createReplEditor and warn.
    console.warn('[repl] codemirror.bundle.js missing; CodeMirror editor disabled');
    return;
  }

  const CM = root.CMRepl;
  const {
    EditorState, Compartment, Prec, StateEffect,
    EditorView, keymap, drawSelection, highlightActiveLine, placeholder, Decoration, ViewPlugin, RangeSetBuilder,
    defaultKeymap, history, historyKeymap, indentLess,
    HighlightStyle, syntaxHighlighting, StreamLanguage, bracketMatching,
    autocompletion, completionKeymap, acceptCompletion, completionStatus, startCompletion,
    linter, lintKeymap,
    searchKeymap, highlightSelectionMatches,
    toggleLineComment,
    t,
  } = CM;

  // ============================================================================
  // dictionaries — shared between the stream language, completion source, and
  // diagnostics. Keep these in sync with the DSL parser.
  // ============================================================================

  const VOICE_WORDS = ['string', 'sample', 'input'];
  const DIRECTIVES = ['tempo', 'meter'];
  const PARAMS = [
    'force', 'decay', 'crush', 'pan', 'gain',
    'tone', 'harm', 'octave', 'rate', 'start', 'speed',
    'monitor', 'listen',
  ];
  const EFFECTS = [
    'compress', 'space', 'resonance', 'comb', 'grain',
    'chorus', 'excite', 'blur', 'scar', 'body',
  ];
    const COUPLING = ['attractor', 'source', 'every', 'fade', 'time', 'beat', 'leaf', 'choose', 'trigger'];
  const ATTRACTORS = [
    'weather', 'weather.dew', 'weather.frost', 'weather.visibility',
    'quake', 'tide', 'solar', 'air', 'traffic', 'grid', 'orbit',
    'civic', 'archive', 'tub', 'room', 'audience', 'mic', 'body',
    'interface', 'tab', 'input',
    'memory', 'habit', 'error', 'feedback',
  ];
  const SOURCE_KEYS = ['station', 'feed', 'body', 'region', 'city', 'coords'];
  const DYNAMICS = ['pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
  const PAN_VALUES = ['left', 'center', 'right'];
  const GAIN_VALUES = ['quiet', 'half', 'full', 'loud'];
  const TONE_VALUES = ['dark', 'bright'];
  const HARM_VALUES = ['simple', 'pair', 'triad', 'rich'];
  const EFFECT_MODES = [
    'wood', 'metal', 'glass', 'room', 'tub', 'paper', 'stone',
    'memory', 'weather', 'rupture', 'feedback', 'glue', 'clamp',
    'drift', 'swarm', 'shimmer', 'solar', 'electric', 'smoke',
    'haze', 'ghost',
  ];
  const LIVE_SOURCES = ['mic', 'interface', 'tab', 'input'];
  const LIVE_FEATURES = [
    'intensity', 'rms', 'loudness', 'volatility', 'flux', 'pressure',
    'density', 'periodicity', 'rupture', 'onset', 'age', 'silence',
    'confidence', 'brightness', 'centroid', 'noisiness', 'flatness', 'roughness',
  ];
  const LIVE_SOURCE_SET = new Set(LIVE_SOURCES);
  const LIVE_FEATURE_SET = new Set(LIVE_FEATURES);
  const LIVE_REF_RE = /^(mic|interface|tab|input)\.([a-zA-Z][a-zA-Z0-9_-]*)$/i;

  const COMMON_OPERATORS = ['*', '*!', '*~', '*&8', '*&16', '*&30', '~', '_'];

  const HEAD_VOICE = new Set(VOICE_WORDS);
  const HEAD_DIRECTIVE = new Set(DIRECTIVES);
  const HEAD_PARAM = new Set(PARAMS);
  const HEAD_EFFECT = new Set(EFFECTS);
  const HEAD_COUPLING = new Set(COUPLING);
  const ATTRACTOR_SET = new Set(ATTRACTORS.map((a) => a.toLowerCase()));

  const NAMED_VALUE_SET = new Set([
    ...DYNAMICS, ...PAN_VALUES, ...GAIN_VALUES,
    ...TONE_VALUES, ...HARM_VALUES, ...EFFECT_MODES,
  ]);

  // Param → legal named values for completion context.
  const PARAM_NAMED = {
    force: DYNAMICS,
    pan: PAN_VALUES,
    gain: GAIN_VALUES,
    tone: TONE_VALUES,
    harm: HARM_VALUES,
  };

  const EFFECT_NAMED = EFFECT_MODES;

  // ============================================================================
  // stream language — token classification by line head + per-token shape.
  // This is intentionally a stream tokenizer rather than a full Lezer grammar.
  // It can be replaced with a grammar later without touching the rest.
  // ============================================================================

  function classifyHead(word) {
    const lower = word.toLowerCase();
    if (HEAD_VOICE.has(lower)) return 'voice';
    if (HEAD_DIRECTIVE.has(lower)) return 'directive';
    if (HEAD_PARAM.has(lower)) return 'param';
    if (HEAD_EFFECT.has(lower)) return 'effect';
    if (HEAD_COUPLING.has(lower)) return 'coupling';
    return null;
  }

  // Patterns for body tokens — order matters: longer/specific first.
  // Returns a tag string (matched in our HighlightStyle below).
  function tokenBody(stream, state) {
    // Comments (also accepted mid-line)
    if (stream.match(/^\/\/.*$/)) return 'comment';

    // Operators in priority order. Invalid forms emit 'invalid' so they
    // can wear a dotted underline without blocking input.
    if (stream.match(/^\*&\d+!/)) return 'operator';      // *&30!
    if (stream.match(/^\*&\d+/)) return 'operator';       // *&30
    if (stream.match(/^\*!\d+/)) return 'operator';       // *!4
    if (stream.match(/^\*~/)) return 'operator';
    if (stream.match(/^\*!/)) return 'operator';
    if (stream.match(/^\*\*/)) return 'invalid';          // **
    if (stream.match(/^\*\d+!/)) return 'invalid';        // *4! (must be *!4)
    if (stream.match(/^\*\d+/)) return 'operator';        // *4
    if (stream.match(/^\*[A-G]/)) {                        // *A is invalid
      // Back up one so the pitch check can pick A up after we mark *.
      return 'invalid';
    }
    if (stream.match(/^\*/)) return 'operator';

    if (stream.match(/^\|/)) return 'separator';
    if (stream.match(/^[()]/)) return 'bracket';
    if (stream.match(/^[~_]/)) return 'operator';
    if (stream.match(/^;/)) return 'operator';
    if (stream.match(/^\//)) return 'operator';            // sample-pool union
    if (stream.match(/^-(?!\d)/)) return 'operator';       // rest token
    // rest
    if (stream.match(/^\.(?!\d)/)) return 'operator';

    // Coupling-line names (attractor / source-key / every)
    if (state.lineHeadKind === 'coupling') {
      if (state.lineHead === 'attractor') {
        if (stream.match(/^[a-zA-Z][a-zA-Z0-9_.-]*/)) {
          const word = stream.current().toLowerCase();
          if (LIVE_REF_RE.test(word)) return 'liveRef';
          return ATTRACTOR_SET.has(word) ? 'attractor' : 'invalid';
        }
      }
      if (state.lineHead === 'time' || state.lineHead === 'beat' || state.lineHead === 'leaf' || state.lineHead === 'choose' || state.lineHead === 'trigger') {
        if (stream.match(/^[a-zA-Z][a-zA-Z0-9_.-]*/)) {
          const word = stream.current().toLowerCase();
          if (LIVE_REF_RE.test(word)) return 'liveRef';
          return LIVE_SOURCE_SET.has(word) ? 'liveSource' : 'atom';
        }
      }
      if (state.lineHead === 'source') {
        if (stream.match(/^[a-zA-Z][a-zA-Z0-9_.-]*/)) {
          const word = stream.current().toLowerCase();
          if (state.couplingPos === 0) {
            state.couplingPos++;
            return SOURCE_KEYS.includes(word) ? 'definition' : 'string';
          }
          state.couplingPos++;
          return 'string';
        }
      }
      if (state.lineHead === 'every') {
        if (stream.match(/^\d+/)) return 'number';
        if (stream.match(/^[a-zA-Z]+/)) return 'atom';
      }
    }

    // Numbers (fractions, decimals, integers, pi expressions)
    if (stream.match(/^-?\d+\/\d+/)) return 'number';
    if (stream.match(/^-?\d*\.\d+/)) return 'number';
    if (stream.match(/^pi\/\d+\b/)) return 'number';
    if (stream.match(/^\d+\*pi\b/)) return 'number';
    if (stream.match(/^pi\b/)) return 'number';
    if (stream.match(/^-?\d+(?![.\w])/)) return 'number';

    // String voice: pitches and pitch wildcards.
    if (state.voiceLine === 'string' || state.lineHeadKind === 'param' || state.lineHeadKind === 'effect') {
      // Pitch like A3, C#4, Bb-1
      if (stream.match(/^[A-G][b#]?-?\d+(?![A-Za-z0-9])/)) return 'pitch';
      // Pitch wildcard: A*!, C#*, Bb*, A*
      if (stream.match(/^[A-G][b#]?\*!?(?![A-Za-z0-9])/)) return 'operator';
    }

    // Sample selectors
    // Forms: snm-001, tub-xither-forge, snm-*, snm-*!, snm-*&30, snm-*&30!
    if (stream.match(/^[a-zA-Z][a-zA-Z0-9_]*-\*&\d+!?/)) return 'sample';
    if (stream.match(/^[a-zA-Z][a-zA-Z0-9_]*-\*!?/)) return 'sample';
    if (stream.match(/^[a-zA-Z][a-zA-Z0-9_]*-[a-zA-Z0-9_-]+/)) return 'sample';

    // Live input modulation refs: mic.intensity, tab.rupture, interface.silence.
    if (stream.match(/^(?:mic|interface|tab|input)\.[a-zA-Z][a-zA-Z0-9_-]*/i)) {
      const word = stream.current().toLowerCase();
      const m = word.match(LIVE_REF_RE);
      return m && LIVE_FEATURE_SET.has(m[2]) ? 'liveRef' : 'invalid';
    }

    // Bare named values & identifiers
    if (stream.match(/^[a-zA-Z][a-zA-Z0-9_.-]*/)) {
      const word = stream.current().toLowerCase();
      if (LIVE_SOURCE_SET.has(word)) return 'liveSource';
      if (NAMED_VALUE_SET.has(word)) return 'atom';
      // In a sample voice line, bare ids are sample-bank tokens.
      if (state.voiceLine === 'sample') return 'sample';
      // Otherwise treat as identifier-y atom.
      return 'atom';
    }

    // Anything else: skip a single char so the stream can advance.
    stream.next();
    return null;
  }

  // ============================================================================
  // highlight style — austere palette mapped onto the tags we emit above. Tags
  // that aren't one of the canonical @lezer/highlight tags get a className
  // hook via `class:` so we can target them in CSS.
  // ============================================================================

  const replHighlight = HighlightStyle.define([
    // A restrained fallback palette. The Cybernetic Score decoration layer below
    // adds the high-identity token classes; these rules keep the language legible
    // if decoration support is unavailable.
    { tag: t.keyword, color: '#101114', fontWeight: '700' },
    { tag: t.definition(t.propertyName), color: '#20184f', fontWeight: '700' },
    { tag: t.operator, color: '#6a3bc3', fontWeight: '650' },
    { tag: t.number, color: '#101114', fontWeight: '650' },
    { tag: t.variableName, color: '#7a5200', fontWeight: '700' },
    { tag: t.string, color: '#c8231a', fontWeight: '700' },
    { tag: t.atom, color: '#12805c', fontWeight: '650' },
    { tag: t.annotation, color: '#0f6c4b', fontWeight: '700' },
    { tag: t.typeName, color: '#1463ff', fontWeight: '700' },
    { tag: t.comment, color: '#6f655b', fontStyle: 'italic' },
    { tag: t.bracket, color: '#7d4cff', fontWeight: '700' },
    { tag: t.separator, color: '#101114', fontWeight: '700' },
    { tag: t.invalid, color: '#d7263d', textDecoration: 'underline wavy #d7263d' },
  ]);

  // Map our internal tag-name strings (returned by tokenBody) onto Lezer
  // highlight tags. StreamLanguage's `tokenTable` lets us register custom
  // names so HighlightStyle can target them.
  const tokenTable = {
    voiceHead: t.keyword,
    directiveHead: t.keyword,
    paramHead: t.definition(t.propertyName),
    effectHead: t.definition(t.propertyName),
    couplingHead: t.annotation,
    liveSource: t.typeName,
    liveRef: t.typeName,
    attractor: t.typeName,
    pitch: t.variableName,
    sample: t.string,
    operator: t.operator,
    bracket: t.bracket,
    separator: t.separator,
    number: t.number,
    atom: t.atom,
    comment: t.comment,
    invalid: t.invalid,
    definition: t.definition(t.propertyName),
    string: t.string,
  };
  // StreamLanguage matches token strings against tags by name; our names
  // include camelCase entries (voiceHead, etc.) so we register them via
  // tokenTable.
  const replLanguageWithTags = StreamLanguage.define({
    name: 'repl-score',
    startState() {
      return { lineHead: null, lineHeadKind: null, voiceLine: null, couplingPos: 0 };
    },
    copyState(s) { return { ...s }; },
    token: (stream, state) => tokenizerEntry(stream, state),
    tokenTable,
    languageData: {
      commentTokens: { line: '//' },
      indentOnInput: /^\s*$/,
    },
  });

  // Single tokenizer entry for the bound language above. Mirrors token() on
  // replLanguage but is the canonical path actually used by the editor.
  function tokenizerEntry(stream, state) {
    if (stream.sol()) {
      state.lineHead = null;
      state.lineHeadKind = null;
      state.couplingPos = 0;
    }
    if (stream.eatSpace()) return null;
    if (stream.match(/^\/\/.*$/)) return 'comment';

    if (state.lineHead == null) {
      if (stream.match(/^[a-zA-Z][a-zA-Z0-9_.-]*/)) {
        const word = stream.current();
        const kind = classifyHead(word);
        state.lineHead = word.toLowerCase();
        state.lineHeadKind = kind;
        if (kind === 'voice') {
          state.voiceLine = state.lineHead;
          return 'voiceHead';
        }
        if (kind === 'directive') return 'directiveHead';
        if (kind === 'param') return 'paramHead';
        if (kind === 'effect') return 'effectHead';
        if (kind === 'coupling') return 'couplingHead';
        return 'invalid';
      }
      stream.next();
      return null;
    }

    return tokenBody(stream, state);
  }

  // ============================================================================
  // Cybernetic Score decorations — white Memphis/MTA score surface + live pulses.
  //
  // This is deliberately editor-local. The scheduler only emits tiny pulse
  // objects through window.ReplEditorPulse; it never imports CodeMirror and never
  // controls DOM nodes. If the editor is absent, playback stays unaffected.
  // ============================================================================

  const csPulseNudge = StateEffect.define();
  const CS_PULSE_MS = 780;
  const CS_METER_MS = 460;

  function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  function ensurePulseBus() {
    const existing = root.ReplEditorPulse;
    if (existing && typeof existing.emit === 'function' && typeof existing.on === 'function') {
      return existing;
    }

    const listeners = new Set();
    const bus = {
      emit(payload) {
        for (const fn of Array.from(listeners)) {
          try { fn(payload || {}); } catch (err) { console.warn('[repl] editor pulse listener failed', err); }
        }
      },
      on(fn) {
        if (typeof fn !== 'function') return () => {};
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
    root.ReplEditorPulse = bus;
    return bus;
  }

  function lineHeadKind(head) {
    const h = String(head || '').toLowerCase();
    if (h === 'string' || h === 'sample' || h === 'input') return `voice-${h}`;
    if (HEAD_DIRECTIVE.has(h)) return 'directive';
    if (HEAD_PARAM.has(h)) return 'param';
    if (HEAD_EFFECT.has(h)) return 'effect';
    if (h === 'attractor' || h === 'monitor' || h === 'listen') return 'routing';
    if (h === 'time' || h === 'beat' || h === 'leaf' || h === 'choose' || h === 'trigger') return 'live-control';
    if (h === 'source' || h === 'every' || h === 'fade') return 'routing';
    return 'unknown';
  }

  function tokenCssClass(token, isHead) {
    const raw = String(token || '');
    const lower = raw.toLowerCase();
    const headKind = isHead ? lineHeadKind(lower) : '';

    if (isHead) {
      if (headKind === 'voice-string') return 'cs-token cs-head cs-voice cs-voice-string';
      if (headKind === 'voice-sample') return 'cs-token cs-head cs-voice cs-voice-sample';
      if (headKind === 'voice-input') return 'cs-token cs-head cs-voice cs-voice-input';
      if (headKind === 'directive') return 'cs-token cs-head cs-directive';
      if (headKind === 'param') return 'cs-token cs-head cs-param';
      if (headKind === 'effect') return 'cs-token cs-head cs-effect';
      if (headKind === 'routing') return 'cs-token cs-head cs-routing';
      if (headKind === 'live-control') return 'cs-token cs-head cs-live-control';
      return 'cs-token cs-head cs-invalid';
    }

    const live = lower.match(LIVE_REF_RE);
    if (live) {
      return LIVE_FEATURE_SET.has(live[2])
        ? 'cs-token cs-live-ref'
        : 'cs-token cs-invalid';
    }
    if (LIVE_SOURCE_SET.has(lower)) return 'cs-token cs-live-source';
    if (/^\/\//.test(raw)) return 'cs-token cs-comment';
    if (/^[()]/.test(raw)) return 'cs-token cs-bracket';
    if (/^(?:\*|\*!|\*~|\*&\d+!?|\*!\d+|\*\d+|~|_|\||;|\.|-)$/.test(raw)) return 'cs-token cs-operator';
    if (/^-?\d+\/\d+$/.test(raw) || /^-?\d*\.\d+$/.test(raw) || /^-?\d+$/.test(raw) || /^\d+(?:ms|s)$/.test(raw) || /^pi(?:\/\d+)?$/.test(raw)) return 'cs-token cs-number';
    if (/^[A-G][b#]?-?\d+$/.test(raw) || /^[A-G][b#]?\*!?$/.test(raw)) return 'cs-token cs-pitch';
    if (/^[a-zA-Z][a-zA-Z0-9_]*-(?:\*&\d+!?|\*!?|[a-zA-Z0-9_-]+)$/.test(raw)) return 'cs-token cs-sample-token';
    if (ATTRACTOR_SET.has(lower)) return 'cs-token cs-attractor';
    if (NAMED_VALUE_SET.has(lower)) return 'cs-token cs-atom';
    return 'cs-token cs-atom';
  }

  function tokenRanges(lineText) {
    const ranges = [];
    const commentAt = (() => {
      const idx = lineText.search(/(^|\s)\/\//);
      return idx < 0 ? -1 : (lineText[idx] === '/' ? idx : idx + 1);
    })();

    const codePart = commentAt >= 0 ? lineText.slice(0, commentAt) : lineText;
    const tokenRe = /[^\s()|;]+|[()|;]/g;
    let m;
    let first = true;
    while ((m = tokenRe.exec(codePart))) {
      const raw = m[0];
      ranges.push({ from: m.index, to: m.index + raw.length, text: raw, isHead: first });
      first = false;
    }

    if (commentAt >= 0) {
      ranges.push({ from: commentAt, to: lineText.length, text: lineText.slice(commentAt), comment: true, isHead: false });
    }

    return ranges;
  }

  function findCurrentBlockLines(state) {
    const selLine = state.doc.lineAt(state.selection.main.head).number;
    let start = selLine;
    let end = selLine;

    function isBoundary(text) {
      const trimmed = text.trim();
      if (!trimmed) return true;
      if (/^\/\//.test(trimmed)) return false;
      const head = trimmed.split(/\s+/, 1)[0].toLowerCase();
      return head === 'string' || head === 'sample' || head === 'input' || head === 'tempo' || head === 'meter';
    }

    for (let n = selLine; n >= 1; n--) {
      const text = state.doc.line(n).text;
      if (n !== selLine && isBoundary(text)) {
        if (!text.trim() || /^(tempo|meter)\b/i.test(text.trim())) start = n + 1;
        else start = n;
        break;
      }
      start = n;
    }

    for (let n = selLine + 1; n <= state.doc.lines; n++) {
      const text = state.doc.line(n).text;
      if (isBoundary(text)) {
        end = n - 1;
        break;
      }
      end = n;
    }

    return { start, end };
  }

  function buildCyberneticScoreDecorations(view, pulses, meters) {
    const now = Date.now();
    const builder = new RangeSetBuilder();
    const current = findCurrentBlockLines(view.state);

    for (let i = 1; i <= view.state.doc.lines; i++) {
      const line = view.state.doc.line(i);
      const text = line.text;
      const trimmed = text.trim();
      const head = trimmed ? trimmed.split(/\s+/, 1)[0].toLowerCase() : '';
      const kind = lineHeadKind(head);
      const pulse = pulses.get(i);
      const meter = meters.get(i);
      const active = pulse && pulse.expires > now;
      const metered = meter && meter.expires > now;
      const isCurrent = i >= current.start && i <= current.end && trimmed;
      const classes = ['cs-line'];

      if (kind !== 'unknown') classes.push(`cs-line-${kind}`);
      if (isCurrent) classes.push('cs-current-block');
      if (active) {
        classes.push('cs-active-line');
        if (pulse.kind) classes.push(`cs-pulse-${String(pulse.kind).replace(/[^a-z0-9_-]/gi, '').toLowerCase()}`);
        if (pulse.voice) classes.push(`cs-pulse-${String(pulse.voice).replace(/[^a-z0-9_-]/gi, '').toLowerCase()}`);
      }
      if (metered) classes.push('cs-metered-line');

      const attrs = { class: classes.join(' ') };
      if (metered) {
        const v = clamp01(meter.value);
        attrs.style = `--cs-meter:${Math.round(v * 100)}%; --cs-meter-alpha:${(0.18 + v * 0.42).toFixed(3)};`;
      }
      builder.add(line.from, line.from, Decoration.line({ attributes: attrs }));

      for (const r of tokenRanges(text)) {
        const cls = r.comment ? 'cs-token cs-comment' : tokenCssClass(r.text, r.isHead);
        const tokenPulse = active && r.isHead ? ' cs-token-active' : '';
        builder.add(line.from + r.from, line.from + r.to, Decoration.mark({ class: cls + tokenPulse }));
      }
    }

    return builder.finish();
  }

  const cyberneticScorePlugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.pulses = new Map();
      this.meters = new Map();
      this.timer = null;
      this.decorations = buildCyberneticScoreDecorations(view, this.pulses, this.meters);
      this.unsubscribe = ensurePulseBus().on((payload) => this.receive(payload));
    }

    receive(payload) {
      const line = Math.max(1, Number(payload && payload.line) | 0);
      if (!line || line > this.view.state.doc.lines) return;
      const now = Date.now();
      const intensity = clamp01(payload.intensity == null ? 1 : payload.intensity);
      this.pulses.set(line, {
        expires: now + CS_PULSE_MS,
        kind: payload.kind || 'event',
        voice: payload.voice || payload.color || '',
        intensity,
      });
      if (payload.meter || payload.kind === 'mod' || payload.kind === 'input') {
        this.meters.set(line, { expires: now + CS_METER_MS, value: intensity });
      }
      this.requestRefresh();
    }

    requestRefresh() {
      if (!this.view || this.view.destroyed) return;
      this.decorations = buildCyberneticScoreDecorations(this.view, this.pulses, this.meters);
      try { this.view.dispatch({ effects: csPulseNudge.of(Date.now()) }); } catch (_) {}
      this.armCleanup();
    }

    armCleanup() {
      if (this.timer) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        const now = Date.now();
        for (const [line, p] of Array.from(this.pulses.entries())) {
          if (!p || p.expires <= now) this.pulses.delete(line);
        }
        for (const [line, m] of Array.from(this.meters.entries())) {
          if (!m || m.expires <= now) this.meters.delete(line);
        }
        this.decorations = buildCyberneticScoreDecorations(this.view, this.pulses, this.meters);
        try { this.view.dispatch({ effects: csPulseNudge.of(Date.now()) }); } catch (_) {}
        if (this.pulses.size || this.meters.size) this.armCleanup();
      }, 120);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.transactions.some((tr) => tr.effects.some((e) => e.is(csPulseNudge)))) {
        this.decorations = buildCyberneticScoreDecorations(update.view, this.pulses, this.meters);
      }
    }

    destroy() {
      if (this.unsubscribe) this.unsubscribe();
      if (this.timer) clearTimeout(this.timer);
    }
  }, {
    decorations: (plugin) => plugin.decorations,
  });

  // ============================================================================
  // theme — Cybernetic Score: white Memphis/MTA instrument-score surface.
  // ============================================================================

  const replTheme = EditorView.theme({
    '&': {
      backgroundColor: '#ffffff',
      color: '#070707',
      fontFamily: '"Courier New", Courier, monospace',
      fontSize: '14px',
      '--cs-white': '#ffffff',
      '--cs-paper': '#fffefa',
      '--cs-ink': '#070707',
      '--cs-line': '#070707',
      '--cs-red': '#e3342f',
      '--cs-blue': '#0057ff',
      '--cs-yellow': '#ffd400',
      '--cs-green': '#008f5a',
      '--cs-violet': '#6c2cff',
      '--cs-cyan': '#00a8c8',
      '--cs-muted': '#5f6368',
      '--cs-faint': '#d8d8d8',
      '--cs-warning': '#f59e0b',
      '--cs-error': '#d7263d',
      '--cs-string-ink': '#070707',
      '--cs-sample-ink': '#070707',
      '--cs-input-ink': '#070707',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-scroller': {
      backgroundColor: '#ffffff',
      backgroundImage:
        'linear-gradient(90deg, rgba(7,7,7,0.035) 1px, transparent 1px), linear-gradient(180deg, rgba(7,7,7,0.028) 1px, transparent 1px)',
      backgroundSize: '32px 32px',
    },
    '.cm-content': {
      caretColor: '#070707',
      padding: '1.05em 1.2em 1.05em 1.05em',
      minHeight: '22em',
      lineHeight: '1.62',
      color: '#070707',
      counterReset: 'cs-line',
    },
    '.cm-line': {
      position: 'relative',
      padding: '0 7.5rem 0 3.25rem',
      borderLeft: '4px solid transparent',
      borderRadius: '0',
      transition: 'background-color 90ms ease, border-color 90ms ease, box-shadow 90ms ease, color 90ms ease',
      counterIncrement: 'cs-line',
    },
    '.cm-line::before': {
      content: 'counter(cs-line)',
      position: 'absolute',
      left: '0.36rem',
      top: '0',
      width: '2.08rem',
      color: 'rgba(7,7,7,0.44)',
      fontSize: '0.78em',
      textAlign: 'right',
      pointerEvents: 'none',
      fontWeight: '800',
      letterSpacing: '0.04em',
    },
    '.cm-line.cs-current-block': {
      backgroundColor: '#f7f7f7',
      borderLeftColor: '#070707',
      boxShadow: 'inset 0 -1px 0 rgba(7,7,7,0.08)',
    },
    '.cm-line.cs-line-voice-string': {
      backgroundColor: '#ffffff',
      borderLeftColor: '#ffd400',
      boxShadow: 'inset 0 -2px 0 #ffd400',
    },
    '.cm-line.cs-line-voice-sample': {
      backgroundColor: '#ffffff',
      borderLeftColor: '#e3342f',
      boxShadow: 'inset 0 -2px 0 #e3342f',
    },
    '.cm-line.cs-line-voice-input': {
      backgroundColor: '#ffffff',
      borderLeftColor: '#0057ff',
      boxShadow: 'inset 0 -2px 0 #0057ff',
    },
    '.cm-line.cs-line-live-control': {
      backgroundColor: '#ffffff',
      borderLeftColor: '#6c2cff',
    },
    '.cm-line.cs-line-routing': {
      backgroundColor: '#ffffff',
      borderLeftColor: '#008f5a',
    },
    '.cm-line.cs-active-line': {
      animation: 'cs-line-stamp 780ms ease-out both',
      boxShadow: 'inset 0 -2px 0 #070707, 3px 3px 0 rgba(7,7,7,0.16)',
    },
    '.cm-line.cs-pulse-string': {
      borderLeftColor: '#ffd400',
      boxShadow: 'inset 0 -2px 0 #ffd400, 3px 3px 0 #070707',
    },
    '.cm-line.cs-pulse-sample': {
      borderLeftColor: '#e3342f',
      boxShadow: 'inset 0 -2px 0 #e3342f, 3px 3px 0 #070707',
    },
    '.cm-line.cs-pulse-input, .cm-line.cs-pulse-mod': {
      borderLeftColor: '#0057ff',
      boxShadow: 'inset 0 -2px 0 #0057ff, 3px 3px 0 #070707',
    },
    '.cm-line.cs-metered-line::after': {
      content: '""',
      position: 'absolute',
      top: '50%',
      right: '0.72rem',
      width: '5.2rem',
      height: '0.46rem',
      transform: 'translateY(-50%)',
      border: '2px solid #070707',
      background: 'linear-gradient(90deg, #0057ff var(--cs-meter), #ffffff var(--cs-meter))',
      boxShadow: '2px 2px 0 #070707',
      pointerEvents: 'none',
    },
    '.cm-activeLine': {
      backgroundColor: '#f0f0f0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#070707',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, ::selection, .cm-selectionBackground': {
      backgroundColor: 'rgba(0, 87, 255, 0.22)',
    },
    '.cm-selectionMatch': {
      backgroundColor: '#ffd400',
      color: '#070707',
      outline: '1px solid #070707',
    },
    '.cs-token': {
      position: 'relative',
      zIndex: '1',
      borderRadius: '0',
      textDecorationThickness: '2px',
      textUnderlineOffset: '0.18em',
      transition: 'color 90ms ease, background-color 90ms ease, box-shadow 90ms ease, outline-color 90ms ease',
    },
    '.cs-head': {
      color: '#070707',
      fontWeight: '900',
      letterSpacing: '0.025em',
      textTransform: 'none',
    },
    '.cs-voice-string': {
      color: '#070707',
      textDecoration: 'underline solid #ffd400',
      textDecorationThickness: '3px',
    },
    '.cs-voice-sample, .cs-sample-token': {
      color: '#070707',
      textDecoration: 'underline solid #e3342f',
      textDecorationThickness: '3px',
    },
    '.cs-voice-input': {
      color: '#070707',
      textDecoration: 'underline solid #0057ff',
      textDecorationThickness: '3px',
    },
    '.cs-directive': {
      color: '#070707',
      fontWeight: '900',
      textDecoration: 'underline solid #070707',
    },
    '.cs-param, .cs-effect': {
      color: '#070707',
      fontWeight: '800',
      boxShadow: 'inset 0 -2px 0 rgba(0,87,255,0.32)',
    },
    '.cs-routing, .cs-attractor': {
      color: '#006642',
      fontWeight: '850',
      textDecoration: 'underline solid #008f5a',
    },
    '.cs-live-control': {
      color: '#4e20d4',
      fontWeight: '850',
      textDecoration: 'underline solid #6c2cff',
    },
    '.cs-live-source': {
      color: '#0048d8',
      fontWeight: '850',
      boxShadow: 'inset 0 -2px 0 #00a8c8',
    },
    '.cs-live-ref': {
      color: '#0048d8',
      fontWeight: '900',
      boxShadow: 'inset 0 -3px 0 #00a8c8',
    },
    '.cs-operator, .cs-bracket': {
      color: '#5c20df',
      fontWeight: '900',
    },
    '.cs-number': {
      color: '#070707',
      fontWeight: '800',
      boxShadow: 'inset 0 -2px 0 #d8d8d8',
    },
    '.cs-pitch': {
      color: '#070707',
      fontWeight: '850',
      boxShadow: 'inset 0 -2px 0 #ffd400',
    },
    '.cs-atom': {
      color: '#111111',
      fontWeight: '650',
    },
    '.cs-comment': {
      color: '#5f5147',
      fontStyle: 'italic',
      fontWeight: '650',
      boxShadow: 'inset 3px 0 0 #070707',
    },
    '.cs-invalid': {
      color: '#d7263d',
      textDecoration: 'underline wavy #d7263d',
      fontWeight: '900',
    },
    '.cs-token-active': {
      animation: 'cs-token-stamp 780ms ease-out both',
    },
    '.cm-line.cs-pulse-string .cs-token-active': {
      backgroundColor: '#ffd400',
      color: '#070707',
      outlineColor: '#070707',
    },
    '.cm-line.cs-pulse-sample .cs-token-active': {
      backgroundColor: '#e3342f',
      color: '#ffffff',
      outlineColor: '#070707',
    },
    '.cm-line.cs-pulse-input .cs-token-active, .cm-line.cs-pulse-mod .cs-token-active': {
      backgroundColor: '#0057ff',
      color: '#ffffff',
      outlineColor: '#070707',
    },
    '.cm-tooltip': {
      backgroundColor: '#ffffff',
      border: '2px solid #070707',
      color: '#070707',
      fontFamily: '"Courier New", Courier, monospace',
      fontSize: '13px',
      boxShadow: '4px 4px 0 #070707',
    },
    '.cm-tooltip.cm-tooltip-autocomplete': {
      borderRadius: '0',
    },
    '.cm-tooltip-autocomplete > ul > li': {
      padding: '3px 9px',
      fontFamily: '"Courier New", Courier, monospace',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: '#0057ff',
      color: '#ffffff',
    },
    '.cm-completionLabel': { color: '#070707', fontWeight: '800' },
    '.cm-completionDetail': { color: '#5f6368', fontStyle: 'italic', marginLeft: '0.6em' },
    '.cm-completionMatchedText': {
      textDecoration: 'none',
      fontWeight: '900',
      color: '#0057ff',
    },
    '.cm-diagnostic': {
      fontFamily: '"Courier New", Courier, monospace',
      fontSize: '13px',
      borderLeft: '0',
      padding: '4px 8px',
    },
    '.cm-diagnostic-error': {
      borderLeft: '6px solid #d7263d',
      backgroundColor: '#ffffff',
      color: '#7a1020',
      boxShadow: 'inset 0 0 0 1px #d7263d',
    },
    '.cm-diagnostic-warning': {
      borderLeft: '6px solid #ffd400',
      backgroundColor: '#ffffff',
      color: '#3f2f00',
      boxShadow: 'inset 0 0 0 1px #070707',
    },
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      borderBottom: '2px wavy #d7263d',
    },
    '.cm-lintRange-warning': {
      backgroundImage: 'none',
      borderBottom: '2px dotted #070707',
    },
    '.cm-panels': {
      backgroundColor: '#ffffff',
      color: '#070707',
      borderTop: '2px solid #070707',
      fontFamily: '"Courier New", Courier, monospace',
    },
    '.cm-searchMatch': {
      backgroundColor: '#ffd400',
      color: '#070707',
      outline: '1px solid #070707',
    },
    '@keyframes cs-line-stamp': {
      '0%': { backgroundColor: '#ffd400', color: '#070707' },
      '18%': { backgroundColor: '#ffffff', color: '#070707' },
      '36%': { backgroundColor: '#0057ff', color: '#ffffff' },
      '100%': { backgroundColor: 'inherit', color: 'inherit' },
    },
    '@keyframes cs-token-stamp': {
      '0%': { outline: '2px solid #070707', boxShadow: '2px 2px 0 #070707' },
      '100%': { outline: '0 solid transparent', boxShadow: 'none' },
    },
  }, { dark: false });


  // ============================================================================
  // typography sanitizer — normalizes destructive punctuation introduced by
  // the OS/IME without altering user DSL syntax.
  //
  // Anything that re-encodes a literal token (lowercasing, "fixing" spelling,
  // re-pluralizing samples, etc.) is explicitly out of scope for this filter.
  // ============================================================================

  const TYPOGRAPHY_REPLACEMENTS = [
    [' ', ' '],   // NBSP → space
    ['“', '"'],
    ['”', '"'],
    ['‘', "'"],
    ['’', "'"],
    ['–', '-'],   // en dash
    ['—', '-'],   // em dash
  ];

  function sanitizeText(text) {
    let out = text;
    for (const [from, to] of TYPOGRAPHY_REPLACEMENTS) {
      if (out.indexOf(from) !== -1) out = out.split(from).join(to);
    }
    return out;
  }

  const sanitizerFilter = EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    let dirty = false;
    const rewritten = [];
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const text = inserted.toString();
      const cleaned = sanitizeText(text);
      if (cleaned !== text) dirty = true;
      rewritten.push({ from: fromA, to: toA, insert: cleaned });
    });
    if (!dirty) return tr;
    // 1-to-1 character substitutions preserve all selection offsets.
    return [{
      changes: rewritten,
      selection: tr.selection,
      effects: tr.effects,
      scrollIntoView: tr.scrollIntoView,
      annotations: tr.annotations,
    }];
  });

  // ============================================================================
  // completion — context-aware. Never auto-applies.
  // ============================================================================

  function makeOption(label, detail) {
    return detail ? { label, detail, type: 'keyword' } : { label, type: 'keyword' };
  }

  function classifyContext(state, pos, ctx) {
    const line = state.doc.lineAt(pos);
    const beforeCursorOnLine = line.text.slice(0, pos - line.from);

    // Inside a comment? Don't complete.
    const commentIdx = beforeCursorOnLine.indexOf('//');
    if (commentIdx !== -1) return { kind: 'comment' };

    // Word boundary for "from"
    const wordMatch = ctx.matchBefore(/[A-Za-z0-9_.\-#*&!~/]+/);
    const from = wordMatch ? wordMatch.from : pos;

    const trimmed = beforeCursorOnLine.replace(/^\s+/, '');
    const indentLen = beforeCursorOnLine.length - trimmed.length;

    // At line head? "trimmed" is either empty or a single bare word with no
    // trailing whitespace.
    if (trimmed.length === 0 || /^[A-Za-z][A-Za-z0-9_.-]*$/.test(trimmed)) {
      return { kind: 'head', from: line.from + indentLen };
    }

    // Determine the line head (first whitespace-bounded token)
    const headMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_.-]*)\s+(.*)$/);
    if (!headMatch) return { kind: 'unknown', from };

    const head = headMatch[1].toLowerCase();
    const rest = headMatch[2];
    const tokensSoFar = rest.trim().split(/\s+/).filter(Boolean);

    if (HEAD_COUPLING.has(head)) {
      return {
        kind: 'coupling-body',
        head,
        position: tokensSoFar.length,
        from,
      };
    }
    if (HEAD_VOICE.has(head)) {
      return { kind: 'voice-body', voice: head, from };
    }
    if (HEAD_PARAM.has(head)) {
      return { kind: 'param-body', param: head, from };
    }
    if (HEAD_EFFECT.has(head)) {
      return { kind: 'effect-body', effect: head, from };
    }
    if (HEAD_DIRECTIVE.has(head)) {
      return { kind: 'directive-body', directive: head, from };
    }
    return { kind: 'unknown', from };
  }

  function getSampleNamesSafe() {
    if (!editorEnvRef.getSampleNames) return [];
    try { return editorEnvRef.getSampleNames() || []; } catch (_) { return []; }
  }
  function getSampleGroupsSafe() {
    if (!editorEnvRef.getSampleGroups) return [];
    try { return editorEnvRef.getSampleGroups() || []; } catch (_) { return []; }
  }

  // The completion source is referenced by language config above, so it must
  // be hoistable. We bind it as a function declaration.
  function completionSource(ctx) {
    const here = classifyContext(ctx.state, ctx.pos, ctx);
    if (here.kind === 'comment') return null;

    const explicit = ctx.explicit;
    const wordMatch = ctx.matchBefore(/[A-Za-z0-9_.\-#*&!~/]+/);
    const from = wordMatch ? wordMatch.from : ctx.pos;

    if (here.kind === 'head') {
      // Don't fire on every keystroke at a blank cursor; only when the user
      // is mid-word or has hit the trigger.
      if (!explicit && !wordMatch) return null;
      const opts = [
        ...VOICE_WORDS.map((w) => ({ label: w, type: 'keyword', detail: 'voice' })),
        ...DIRECTIVES.map((w) => ({ label: w, type: 'keyword', detail: 'directive' })),
        ...PARAMS.map((w) => ({ label: w, type: 'property', detail: 'param' })),
        ...EFFECTS.map((w) => ({ label: w, type: 'property', detail: 'effect' })),
        ...COUPLING.map((w) => ({ label: w, type: 'keyword', detail: 'coupling' })),
      ];
      return { from: here.from, options: opts, validFor: /^[A-Za-z][A-Za-z0-9_.-]*$/ };
    }

    if (here.kind === 'coupling-body') {
      if (here.head === 'attractor') {
        const opts = ATTRACTORS.map((a) => ({ label: a, type: 'class', detail: 'attractor' }));
        return { from, options: opts, validFor: /^[A-Za-z][A-Za-z0-9_.-]*$/ };
      }
      if (here.head === 'source') {
        if (here.position === 0) {
          const opts = SOURCE_KEYS.map((s) => ({ label: s, type: 'property', detail: 'source key' }));
          return { from, options: opts, validFor: /^[A-Za-z]+$/ };
        }
        return null;
      }
        if (here.head === 'every') {
          const opts = [
            { label: '4 bars', type: 'text', detail: 'every' },
            { label: '8 beats', type: 'text', detail: 'every' },
            { label: 'bars', type: 'text', detail: 'unit' },
            { label: 'beats', type: 'text', detail: 'unit' },
          ];
          return { from, options: opts };
        }

        if (here.head === 'time' || here.head === 'beat' || here.head === 'leaf' || here.head === 'choose' || here.head === 'trigger') {
          const opts = [
            ...LIVE_SOURCES.map((src) => ({ label: src, type: 'class', detail: 'live source' })),
            ...LIVE_SOURCES.flatMap((src) => LIVE_FEATURES.map((f) => ({ label: `${src}.${f}`, type: 'variable', detail: here.head }))),
          ];
          return { from, options: opts, validFor: /^[A-Za-z][A-Za-z0-9_.-]*$/ };
        }

        if (here.head === 'fade') {
          const opts = [
            { label: 'in 30s', type: 'function', detail: 'fade block in, then latch high' },
            { label: 'out 30s', type: 'function', detail: 'fade block out, then latch silent' },
            { label: 'inout 30s', type: 'function', detail: 'cycle in then out' },
            { label: 'outin 30s', type: 'function', detail: 'cycle out then in' },
            { label: 'inout 30s hold 10s', type: 'function', detail: 'breathing fade with high/low holds' },
            { label: 'outin 8s hold 2s', type: 'function', detail: 'negative-space pulse' },
            { label: 'hold', type: 'keyword', detail: 'freeze current fade level' },
            { label: 'clear', type: 'keyword', detail: 'remove fade automation' },
          ];
          return { from, options: opts };
        }

        return null;
    }

    if (here.kind === 'directive-body') {
      if (here.directive === 'meter') {
        const opts = ['4/4', '3/4', '6/8', '5/4', '7/8'].map((m) => ({ label: m, type: 'constant' }));
        return { from, options: opts };
      }
      if (here.directive === 'tempo') {
        const opts = ['60', '88', '110', '120', '140'].map((m) => ({ label: m, type: 'constant' }));
        return { from, options: opts };
      }
      return null;
    }

    if (here.kind === 'param-body') {
      const named = PARAM_NAMED[here.param] || [];
      const opts = [
        ...named.map((v) => ({ label: v, type: 'constant', detail: here.param })),
        ...LIVE_SOURCES.map((src) => ({ label: src, type: 'class', detail: 'live source' })),
        ...LIVE_SOURCES.flatMap((src) => LIVE_FEATURES.slice(0, 8).map((f) => ({ label: `${src}.${f}`, type: 'variable', detail: 'live modulation' }))),
        ...COMMON_OPERATORS.map((op) => ({
          label: op, type: 'keyword',
          detail: opDescription(op),
        })),
      ];
      // For sample-only params, surface sample-friendly hints.
      if (here.param === 'rate') {
        opts.unshift({ label: '1', type: 'constant', detail: 'rate' });
      }
      return { from, options: opts };
    }

    if (here.kind === 'effect-body') {
      const opts = [
        ...EFFECT_NAMED.map((m) => ({ label: m, type: 'constant', detail: here.effect })),
        ...LIVE_SOURCES.flatMap((src) => LIVE_FEATURES.slice(0, 8).map((f) => ({ label: `${src}.${f}`, type: 'variable', detail: 'live modulation' }))),
        { label: '0.25', type: 'constant', detail: '0..1' },
        { label: '0.5', type: 'constant', detail: '0..1' },
        ...COMMON_OPERATORS.map((op) => ({
          label: op, type: 'keyword', detail: opDescription(op),
        })),
      ];
      return { from, options: opts };
    }

    if (here.kind === 'voice-body') {
      if (here.voice === 'string') {
        const opts = [
          { label: 'A3', type: 'variable', detail: 'pitch' },
          { label: 'C4', type: 'variable', detail: 'pitch' },
          { label: 'E4', type: 'variable', detail: 'pitch' },
          { label: 'G4', type: 'variable', detail: 'pitch' },
          ...COMMON_OPERATORS.map((op) => ({ label: op, type: 'keyword', detail: opDescription(op) })),
          { label: '*4', type: 'keyword', detail: 'random pitch in oct 4' },
          { label: '*!4', type: 'keyword', detail: 'frozen random pitch in oct 4' },
          { label: 'A*', type: 'keyword', detail: 'random A octave' },
          { label: '~', type: 'keyword', detail: 'sustain previous' },
          { label: '.', type: 'keyword', detail: 'rest' },
          { label: '|', type: 'keyword', detail: 'bar' },
        ];
        return { from, options: opts };
      }
      if (here.voice === 'input') {
        const opts = [
          { label: 'mic', type: 'class', detail: 'browser microphone' },
          { label: 'interface', type: 'class', detail: 'audio interface input' },
          { label: 'tab', type: 'class', detail: 'shared tab audio' },
        ];
        return { from, options: opts, validFor: /^[A-Za-z][A-Za-z0-9_.-]*$/ };
      }
      if (here.voice === 'sample') {
        const samples = getSampleNamesSafe();
        const groups = getSampleGroupsSafe();
        const opts = [];
        // Useful selector examples first.
        const selectorExamples = [
          ['*', 'random sample from full bank'],
          ['*;', 'random, gated to slot'],
          ['snm-*', 'random snm sample'],
          ['snm-*!', 'frozen random snm sample'],
          ['snm-*&30', 'snm crossfade over 30s'],
          ['snm-*&30!', 'frozen snm pair, 30s grain'],
          ['snm-*/tub-*&30', 'snm or tub union, gradient'],
          ['tub-*', 'random tub sample'],
          ['amp-*', 'random amp sample'],
          ['lux-*', 'random lux sample'],
          ['b3-*', 'random b3 sample'],
        ];
        for (const [label, detail] of selectorExamples) {
          opts.push({ label, type: 'keyword', detail });
        }
        // Group-prefixed wildcards from manifest groups.
        for (const g of groups) {
          if (g && g.prefix) {
            opts.push({ label: `${g.prefix}-*`, type: 'keyword', detail: `${g.label || g.prefix} bank` });
          }
        }
        // Concrete sample names.
        for (const name of samples) {
          opts.push({ label: name, type: 'text', detail: 'sample' });
        }
        return { from, options: opts };
      }
    }

    return null;
  }

  function opDescription(op) {
    switch (op) {
      case '*': return 'random pick';
      case '*!': return 'frozen random';
      case '*~': return 'continuous random';
      case '*&8': return '8-second drift';
      case '*&16': return '16-second drift';
      case '*&30': return '30-second drift';
      case '~': return 'hold previous';
      case '_': return 'reset to default';
      default: return '';
    }
  }

  // Capture-by-reference for completion source so callbacks see live env.
  const editorEnvRef = {};

  // ============================================================================
  // diagnostics — debounced parser run mapped to CodeMirror linter.
  // ============================================================================

  function buildLinter(parseFn) {
    return linter((view) => {
      if (typeof parseFn !== 'function') return [];
      let result;
      try {
        result = parseFn(view.state.doc.toString());
      } catch (err) {
        return [];
      }
      if (!result || result.ok) return [];
      const diags = [];
      const doc = view.state.doc;
      for (const e of (result.errors || [])) {
        let line = e.line;
        if (!Number.isFinite(line) || line < 1 || line > doc.lines) line = 1;
        const lineObj = doc.line(line);
        diags.push({
          from: lineObj.from,
          to: lineObj.to,
          severity: 'error',
          message: e.message || 'parse error',
        });
      }
      return diags;
    }, {
      delay: 160,
      // Don't surface tooltips on hover — the gutter underline is enough.
    });
  }

  // ============================================================================
  // keymap — privileged transport bindings; do not reach outside the editor.
  // ============================================================================

  function makeKeymap(callbacks, viewRef) {
    const cmd = callbacks || {};
    const tabBinding = (view) => {
      if (completionStatus(view.state) === 'active') {
        return acceptCompletion(view);
      }
      view.dispatch(view.state.replaceSelection('  '));
      return true;
    };

    return [
      // Higher precedence than defaults so Cmd-Enter never falls through.
      Prec.highest(keymap.of([
        {
          key: 'Mod-Shift-Enter',
          preventDefault: true,
          run: (view) => {
            if (cmd.safePlay) cmd.safePlay();
            view.focus();
            return true;
          },
        },
        {
          key: 'Mod-Enter',
          preventDefault: true,
          run: (view) => {
            if (cmd.play) cmd.play();
            view.focus();
            return true;
          },
        },
        {
          key: 'Escape',
          preventDefault: true,
          run: (view) => {
            if (cmd.stop) cmd.stop();
            view.focus();
            return true;
          },
        },
        {
          key: 'Mod-s',
          preventDefault: true,
          run: (view) => {
            if (cmd.share) cmd.share();
            view.focus();
            return true;
          },
        },
        {
          key: 'Mod-k',
          preventDefault: true,
          run: () => true, // reserved for future command palette
        },
        {
          key: 'Mod-/',
          preventDefault: true,
          run: toggleLineComment,
        },
        {
          key: 'Tab',
          preventDefault: true,
          run: tabBinding,
        },
        {
          key: 'Shift-Tab',
          preventDefault: true,
          run: indentLess,
        },
        {
          // Enter accepts an open completion; otherwise falls through to
          // the default newline insertion via lower-precedence keymaps.
          key: 'Enter',
          run: (view) => {
            if (completionStatus(view.state) === 'active') {
              return acceptCompletion(view);
            }
            return false;
          },
        },
        {
          key: 'Ctrl-Space',
          run: startCompletion,
        },
      ])),
    ];
  }

  // ============================================================================
  // factory — wires it all up and returns the adapter.
  // ============================================================================

  function createReplEditor(options) {
    const opts = options || {};
    const parent = opts.parent;
    if (!parent) throw new Error('createReplEditor: parent is required');

    // Bind environment refs used by the completion source.
    editorEnvRef.getSampleNames = opts.getSampleNames;
    editorEnvRef.getSampleGroups = opts.getSampleGroups;

    const onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

    const parseFn = typeof opts.parseForDiagnostics === 'function'
      ? opts.parseForDiagnostics
      : null;

    const updateListener = EditorView.updateListener.of((u) => {
      if (u.docChanged && onChange) {
        onChange(u.state.doc.toString());
      }
    });

    const extensions = [
      history(),
      drawSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      bracketMatching(),
      replLanguageWithTags,
      syntaxHighlighting(replHighlight),
      cyberneticScorePlugin,
      autocompletion({
        override: [completionSource],
        activateOnTyping: true,
        defaultKeymap: false,
        closeOnBlur: true,
        icons: false,
      }),
      sanitizerFilter,
      replTheme,
      updateListener,
      EditorView.contentAttributes.of({
        spellcheck: 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
        autocomplete: 'off',
        translate: 'no',
        'data-gramm': 'false',
        'data-gramm_editor': 'false',
        'data-enable-grammarly': 'false',
        'aria-label': 'REPL score editor',
      }),
      placeholder('// start typing — Cmd-Enter to evaluate'),
      // keymap built last so it can reference the eventual view via closure.
      makeKeymap(opts.onCommand || {}),
      // baseline editing keymap, lower precedence
      keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap, ...searchKeymap, ...lintKeymap]),
    ];

    if (parseFn) extensions.push(buildLinter(parseFn));

    const initialText = typeof opts.initialText === 'string' ? opts.initialText : '';

    const state = EditorState.create({
      doc: initialText,
      extensions,
    });

    const view = new EditorView({ state, parent });

    // Reinforce contentDOM attributes after mount in case the theme injects
    // extras downstream.
    const cd = view.contentDOM;
    cd.setAttribute('spellcheck', 'false');
    cd.setAttribute('autocorrect', 'off');
    cd.setAttribute('autocapitalize', 'off');
    cd.setAttribute('autocomplete', 'off');
    cd.setAttribute('data-gramm', 'false');
    cd.setAttribute('data-gramm_editor', 'false');
    cd.setAttribute('data-enable-grammarly', 'false');

    // Adapter API.
    const api = {
      getView() { return view; },

      getValue() {
        return view.state.doc.toString();
      },

      setValue(text) {
        const safe = sanitizeText(typeof text === 'string' ? text : '');
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: safe },
        });
      },

      focus() {
        view.focus();
      },

      getCursor() {
        return view.state.selection.main.head;
      },

      setCursor(pos) {
        const max = view.state.doc.length;
        const clamped = Math.max(0, Math.min(max, pos | 0));
        view.dispatch({ selection: { anchor: clamped } });
      },

      dispatchTextChange(from, to, text) {
        const docLen = view.state.doc.length;
        const f = Math.max(0, Math.min(docLen, from | 0));
        const tt = Math.max(f, Math.min(docLen, to | 0));
        view.dispatch({
          changes: { from: f, to: tt, insert: typeof text === 'string' ? text : '' },
        });
      },

      replaceSelection(text) {
        const insert = typeof text === 'string' ? text : '';
        view.dispatch(view.state.replaceSelection(insert));
      },

      // Insert at the cursor, applying repl's surrounding-whitespace rule:
      //   add a leading space unless the previous char is whitespace or '('
      //   add a trailing space unless the next char is whitespace or ')'
      insertText(text) {
        const value = typeof text === 'string' ? text : '';
        const sel = view.state.selection.main;
        const doc = view.state.doc;
        const before = sel.from > 0 ? doc.sliceString(sel.from - 1, sel.from) : '';
        const after = sel.to < doc.length ? doc.sliceString(sel.to, sel.to + 1) : '';
        const needLead = before && !/\s|\(/.test(before);
        const needTrail = after && !/\s|\)/.test(after);
        const lead = needLead ? ' ' : '';
        const trail = needTrail ? ' ' : '';
        const insert = lead + value + trail;
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert },
          selection: { anchor: sel.from + insert.length },
        });
      },
    };

    return api;
  }

  root.createReplEditor = createReplEditor;
})(window);
