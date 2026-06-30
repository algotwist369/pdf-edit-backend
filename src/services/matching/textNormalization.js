export const normalizeText = (value) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();

export const normalizeForLooseMatch = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]/gu, '');
