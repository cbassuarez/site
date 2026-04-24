export function buildOpenDetailLines(work = {}) {
  const detailLines = [];
  const normalizeLine = (value) => String(value ?? '').trim();
  const canonical = (value) => normalizeLine(value).replace(/\s+/g, ' ').toLowerCase();

  const oneliner = normalizeLine(work?.onelinerEffective);
  if (oneliner) {
    detailLines.push({ text: oneliner, className: 'one' });
  }

  const descriptionSource = normalizeLine(work?.descriptionEffective);
  if (descriptionSource) {
    const paragraphs = String(work.descriptionEffective)
      .split(/\n{2,}/)
      .map(part => part.trim())
      .filter(Boolean);
    const compare = oneliner ? canonical(oneliner) : null;
    paragraphs.forEach((text, idx) => {
      const trimmed = normalizeLine(text);
      if (!trimmed) return;
      if (compare && canonical(trimmed) === compare) {
        if (paragraphs.length === 1) return;
        if (idx === 0) return;
      }
      detailLines.push({ text: trimmed, className: '' });
    });
  }

  const openNotes = Array.isArray(work?.openNote)
    ? work.openNote
    : (work?.openNote != null ? [work.openNote] : []);
  openNotes
    .map(note => normalizeLine(note))
    .filter(Boolean)
    .forEach(text => detailLines.push({ text, className: '' }));

  return detailLines;
}
