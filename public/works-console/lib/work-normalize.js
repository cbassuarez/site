const RECOMMENDED_ONELINER_LENGTH = 160;
const MAX_ONELINER_LENGTH = 240;

function coerceString(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function toSingleLine(value) {
  const raw = coerceString(value);
  if (!raw) return '';
  return raw.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeDescription(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    value = value.map(coerceString).join('\n\n');
  }
  return coerceString(value).replace(/\r\n?/g, '\n').trim();
}

function stripMarkdown(input) {
  let text = coerceString(input);
  if (!text) return '';
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/`[^`]*`/g, ' ');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/^#{1,6}\s*/gm, '');
  text = text.replace(/^>\s?/gm, '');
  text = text.replace(/([*_~]{1,3})([^*_~]+)\1/g, '$2');
  text = text.replace(/<[^>]+>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function truncateWithEllipsis(text, limit) {
  if (!text) return '';
  if (text.length <= limit) return text;
  const slice = text.slice(0, Math.max(0, limit - 1));
  const trimmed = slice.replace(/\s+\S*$/, '').trim();
  if (trimmed.length >= limit - 1) return `${trimmed}…`;
  return `${text.slice(0, limit - 1).trim()}…`;
}

function deriveOnelinerFromDescription(description) {
  if (!description) return '';
  const plain = stripMarkdown(description);
  if (!plain) return '';
  const sentenceMatch = plain.match(/(.+?[.!?])(?=\s|$)/);
  let candidate = sentenceMatch ? sentenceMatch[1] : plain;
  if (!sentenceMatch) {
    const firstBreak = candidate.indexOf('\n');
    if (firstBreak >= 0) candidate = candidate.slice(0, firstBreak);
  }
  candidate = candidate.replace(/\s+/g, ' ').trim();
  if (!candidate) return '';
  return truncateWithEllipsis(candidate, RECOMMENDED_ONELINER_LENGTH);
}

export function normalizeWork(work = {}) {
  const source = work || {};
  const normalized = { ...source };

  const onelinerInput = source.oneliner ?? source.one ?? '';
  const onelinerRaw = coerceString(onelinerInput);
  let onelinerEffective = toSingleLine(onelinerRaw).trim();
  const hasProvidedOneliner = onelinerRaw.trim().length > 0;

  const normalizeDescCandidate = (value) => {
    if (value === undefined || value === null) return '';
    let text;
    if (Array.isArray(value)) {
      text = value
        .map((part) => coerceString(part).replace(/\r\n?/g, '\n').trim())
        .filter(Boolean)
        .join('\n\n');
    } else {
      text = coerceString(value);
    }
    text = text.replace(/\r\n?/g, '\n').trim();
    if (!text) return '';
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.replace(/[ \t]{2,}/g, ' ');
    return text;
  };

  const descriptionKeys = [
    'description',
    'desc',
    'program',
    'programNote',
    'programNotes',
    'notes',
    'body',
    'text',
    'copy',
  ];

  let descriptionEffective = '';
  let descriptionField = null;

  for (const key of descriptionKeys) {
    const candidate = normalizeDescCandidate(source[key]);
    if (candidate) {
      descriptionEffective = candidate;
      descriptionField = key;
      break;
    }
  }

  if (!onelinerEffective && !hasProvidedOneliner && descriptionEffective) {
    onelinerEffective = deriveOnelinerFromDescription(descriptionEffective) || '';
  }

  let dedupedOneliner = false;

  const canonical = (value) => value.replace(/\s+/g, ' ').trim().toLowerCase();

  if (descriptionEffective) {
    const firstParagraph = descriptionEffective
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .find(Boolean)
      || descriptionEffective.split(/\n+/).map((part) => part.trim()).find(Boolean)
      || '';

    if (firstParagraph && onelinerEffective && canonical(firstParagraph) === canonical(onelinerEffective)) {
      onelinerEffective = '';
      dedupedOneliner = true;
    }
  } else if (onelinerEffective) {
    descriptionEffective = '';
  }

  if (hasProvidedOneliner && onelinerEffective) normalized.oneliner = onelinerEffective;
  else if ('oneliner' in normalized) delete normalized.oneliner;

  if (onelinerEffective) normalized.one = onelinerEffective;
  else if ('one' in normalized) delete normalized.one;

  if (descriptionEffective) normalized.description = descriptionEffective;
  else if ('description' in normalized) delete normalized.description;

  if (!onelinerEffective) onelinerEffective = null;
  if (!descriptionEffective) descriptionEffective = null;

  if (typeof window !== 'undefined' && window && window.__PRAE_DEBUG) {
    try {
      const logger = window.console && window.console.debug ? window.console.debug : window.console?.log;
      if (logger) {
        logger('[prae] normalizeWork', {
          descriptionField,
          dedupedOneliner,
        });
      }
    } catch (_) {}
  }

  const onelinerEffectiveValue = onelinerEffective ? onelinerEffective : null;
  const descriptionEffectiveValue = descriptionEffective ? descriptionEffective : null;

  return {
    ...normalized,
    onelinerEffective: onelinerEffectiveValue,
    descriptionEffective: descriptionEffectiveValue,
  };
}

export function collectWorkWarnings(work = {}) {
  const warnings = [];
  const rawOneliner = coerceString(work.oneliner);
  const rawLegacy = coerceString(work.one);
  const source = coerceString(work.oneliner ?? work.one ?? '');

  if (work.oneliner != null && work.one != null) {
    if (toSingleLine(rawOneliner) && toSingleLine(rawLegacy) && toSingleLine(rawOneliner) !== toSingleLine(rawLegacy)) {
      warnings.push('Both "oneliner" and legacy "one" provided; "oneliner" will be used (remove "one" after migrating).');
    }
  }

  if (/\r|\n/.test(source)) {
    warnings.push('Oneliner contains line breaks; they will be collapsed to a single space.');
  }

  const normalized = toSingleLine(source);
  if (normalized.length > RECOMMENDED_ONELINER_LENGTH) {
    warnings.push(`Oneliner is ${normalized.length} characters (recommended ≤ ${RECOMMENDED_ONELINER_LENGTH}).`);
  }
  if (normalized.length > MAX_ONELINER_LENGTH) {
    warnings.push(`Oneliner exceeds ${MAX_ONELINER_LENGTH} characters and will be truncated.`);
  }

  return warnings;
}

export const __workModelInternals = {
  toSingleLine,
  normalizeDescription,
  stripMarkdown,
  deriveOnelinerFromDescription,
  truncateWithEllipsis,
};
