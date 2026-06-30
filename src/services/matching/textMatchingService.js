import { env } from '../../config/env.js';
import { aiMatchingService } from '../ai/aiMatchingService.js';
import { normalizeForLooseMatch, normalizeText } from './textNormalization.js';
import { similarity } from './fuzzy.js';

const getBounds = (items) => {
  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.y));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

const getItemMeta = (candidateItems) => {
  const heights = candidateItems
    .map((candidateItem) => candidateItem.height)
    .filter((height) => Number.isFinite(height) && height > 0)
    .sort((a, b) => a - b);
  const fontNames = candidateItems.map((candidateItem) => candidateItem.fontName || '').join(' ');
  return {
    source: candidateItems[0]?.source || 'text',
    fontName: candidateItems[0]?.fontName,
    fontSize: heights[Math.floor(heights.length / 2)],
    isBold: /bold|black|heavy|semibold|demi/i.test(fontNames)
  };
};

const groupItemsByLine = (items) => {
  const byPage = items.reduce(
    (map, item) => map.set(item.pageIndex, [...(map.get(item.pageIndex) || []), item]),
    new Map()
  );
  const lines = [];

  for (const pageItems of byPage.values()) {
    const sorted = [...pageItems].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const item of sorted) {
      const line = lines.find(
        (candidateLine) => {
          if (candidateLine.pageIndex !== item.pageIndex) return false;
          const verticallyAligned =
            Math.abs(candidateLine.y - item.y) <= Math.max(candidateLine.height, item.height, 2) * 0.65;
          if (!verticallyAligned) return false;

          const lineRight = candidateLine.x + candidateLine.width;
          const itemRight = item.x + item.width;
          const horizontalGap = Math.max(item.x - lineRight, candidateLine.x - itemRight, 0);
          return horizontalGap <= Math.max(candidateLine.height, item.height, 2) * 4;
        }
      );
      if (line) {
        line.items.push(item);
        const bounds = getBounds(line.items);
        Object.assign(line, bounds);
      } else {
        lines.push({
          pageIndex: item.pageIndex,
          y: item.y,
          height: item.height,
          items: [item],
          ...getBounds([item])
        });
      }
    }
  }

  return lines.map((line) => ({
    ...line,
    items: line.items.sort((a, b) => a.x - b.x)
  }));
};

const shouldInsertSpaceBetweenItems = (previousItem, nextItem) => {
  if (!previousItem) return false;
  const previousRight = previousItem.x + previousItem.width;
  const gap = nextItem.x - previousRight;
  const averageHeight = Math.max(previousItem.height, nextItem.height, 1);
  return gap > averageHeight * 0.22;
};

const buildVisualText = (items) =>
  normalizeText(
    items.reduce((text, item, index) => {
      const separator = shouldInsertSpaceBetweenItems(items[index - 1], item) ? ' ' : '';
      return `${text}${separator}${item.text}`;
    }, '')
  );

const getAvailableLineBox = (line, pageLines = []) => {
  const sameRowRightLine = pageLines
    .filter((candidate) => {
      if (candidate === line || candidate.pageIndex !== line.pageIndex) return false;
      const aligned = Math.abs(candidate.y - line.y) <= Math.max(candidate.height, line.height, 2) * 0.65;
      return aligned && candidate.x > line.x + line.width;
    })
    .sort((a, b) => a.x - b.x)[0];

  if (!sameRowRightLine) return { x: line.x, y: line.y, width: line.width, height: line.height };
  return {
    x: line.x,
    y: line.y,
    width: Math.max(line.width, sameRowRightLine.x - line.x - Math.max(line.height, 6)),
    height: line.height
  };
};

const buildLineCandidates = (line, pageLines = [], maxWindow = 10) => {
  const candidates = [];
  const lineBox = getAvailableLineBox(line, pageLines);
  for (let start = 0; start < line.items.length; start += 1) {
    for (let end = start; end < Math.min(start + maxWindow, line.items.length); end += 1) {
      const candidateItems = line.items.slice(start, end + 1);
      const item = line.items[end];
      const text = buildVisualText(candidateItems);
      const bounds = getBounds(candidateItems);
      candidates.push({
        ...bounds,
        pageIndex: item.pageIndex,
        text,
        items: candidateItems,
        lineBox,
        ...getItemMeta(candidateItems)
      });
    }
  }
  return candidates;
};

const buildMultilineCandidates = (lines, maxWindow = 6) => {
  const candidates = [];
  const byPage = lines.reduce(
    (map, line) => map.set(line.pageIndex, [...(map.get(line.pageIndex) || []), line]),
    new Map()
  );

  for (const pageLines of byPage.values()) {
    const sortedLines = [...pageLines].sort((a, b) => a.y - b.y || a.x - b.x);
    for (let start = 0; start < sortedLines.length; start += 1) {
      const startLine = sortedLines[start];
      const columnLines = sortedLines
        .slice(start)
        .filter((line) => {
          const leftDelta = Math.abs(line.x - startLine.x);
          const overlap = Math.min(line.x + line.width, startLine.x + startLine.width) - Math.max(line.x, startLine.x);
          return leftDelta <= Math.max(startLine.height * 2, 12) || overlap > Math.min(line.width, startLine.width) * 0.35;
        })
        .slice(0, maxWindow);

      for (let end = 0; end < columnLines.length; end += 1) {
        const candidateLines = columnLines.slice(0, end + 1);
        const candidateItems = candidateLines.flatMap((line) => line.items);
        const text = candidateLines.map((line) => buildVisualText(line.items)).join('\n');
        const bounds = getBounds(candidateItems);
        candidates.push({
          ...bounds,
          pageIndex: candidateLines[0].pageIndex,
          text,
          items: candidateItems,
          lineBox: bounds,
          ...getItemMeta(candidateItems)
        });
      }
    }
  }

  return candidates;
};

const shouldApplyRuleToFile = (rule, file) => {
  if (rule.applyTo === 'all') return true;
  if (rule.applyTo === 'selected') {
    return rule.selectedFileIds.some((id) => String(id) === String(file._id));
  }
  return rule.applyTo === file.documentType;
};

const byScope = (matches, scope) => (scope === 'first' ? matches.slice(0, 1) : matches);

const replaceFirstNormalized = (text, oldText, newText, caseInsensitive = false) => {
  const flags = caseInsensitive ? 'i' : '';
  const escapedOldText = oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escapedOldText, flags), newText);
};

const boxesOverlap = (a, b) => {
  if (a.pageIndex !== b.pageIndex) return false;
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  return minArea > 0 && (xOverlap * yOverlap) / minArea > 0.3;
};

const preferSmallestNonOverlapping = (matches) => {
  const accepted = [];
  const sorted = [...matches].sort(
    (a, b) =>
      Number(Boolean(b.preferForReplacement)) - Number(Boolean(a.preferForReplacement)) ||
      a.text.length - b.text.length ||
      a.width - b.width
  );
  for (const match of sorted) {
    if (!accepted.some((acceptedMatch) => boxesOverlap(acceptedMatch, match))) {
      accepted.push(match);
    }
  }
  return accepted.sort((a, b) => a.pageIndex - b.pageIndex || a.y - b.y || a.x - b.x);
};

const buildContainedMatches = ({ candidates, oldText, newText, caseInsensitive = false, confidence }) => {
  const matches = candidates
    .filter((candidate) => {
      const candidateText = normalizeText(candidate.text);
      if (candidateText === oldText) return false;
      const haystack = caseInsensitive ? candidateText.toLowerCase() : candidateText;
      const needle = caseInsensitive ? oldText.toLowerCase() : oldText;
      const index = haystack.indexOf(needle);
      if (index < 0) return false;

      const before = index > 0 ? candidateText[index - 1] : '';
      const after = index + oldText.length < candidateText.length ? candidateText[index + oldText.length] : '';
      const prefix = candidateText.slice(0, index);
      const isGluedToken = Boolean((before && !/\s/.test(before)) || (after && !/\s/.test(after)));
      const isLabelValue = /:\s*$/.test(prefix) && index + oldText.length === candidateText.length;
      return isGluedToken || isLabelValue;
    })
    .map((candidate) => ({
      ...candidate,
      oldText: candidate.text,
      newText: replaceFirstNormalized(candidate.text, oldText, newText, caseInsensitive),
      confidence,
      preferForReplacement: true
    }));
  return preferSmallestNonOverlapping(matches);
};

export const findMatchesForRule = async ({ rule, file, extracted }) => {
  if (!shouldApplyRuleToFile(rule, file)) {
    return { status: 'skipped_not_found', matches: [], reason: 'Rule does not apply to this file' };
  }

  const oldText = normalizeText(rule.oldText);
  const newText = normalizeText(rule.newText);
  if (!oldText) return { status: 'invalid_rule', matches: [], reason: 'old_text cannot be empty' };
  if (!newText) return { status: 'invalid_rule', matches: [], reason: 'new_text cannot be empty' };
  if (oldText === newText) {
    return { status: 'skipped_same_value', matches: [], reason: 'old_text and new_text are identical' };
  }

  if (rule.replaceScope === 'manual_selected') {
    const matches = rule.manualSelections
      .filter((selection) => String(selection.fileId) === String(file._id))
      .map((selection) => ({ ...selection.toObject?.(), text: oldText, confidence: 1 }));
    return matches.length
      ? { status: 'replaced', matches, reason: 'Manual selections used' }
      : { status: 'skipped_not_found', matches: [], reason: 'No manual selections for this file' };
  }

  const lines = groupItemsByLine(extracted.textItems);
  const byPageLines = lines.reduce(
    (map, line) => map.set(line.pageIndex, [...(map.get(line.pageIndex) || []), line]),
    new Map()
  );
  const singleLineCandidates = lines.flatMap((line) => buildLineCandidates(line, byPageLines.get(line.pageIndex) || []));
  const candidates = rule.allowMultiline || /\r|\n/.test(rule.oldText)
    ? [...singleLineCandidates, ...buildMultilineCandidates(lines)]
    : singleLineCandidates;
  const exactMatches = candidates.filter((candidate) => normalizeText(candidate.text) === oldText);
  const exactContainedMatches = buildContainedMatches({
    candidates,
    oldText,
    newText,
    confidence: 0.99
  });
  const exactReplacementMatches = preferSmallestNonOverlapping([
    ...exactContainedMatches,
    ...exactMatches.map((match) => ({ ...match, confidence: 1 }))
  ]);
  if (exactReplacementMatches.length) {
    return {
      status: 'replaced',
      matches: byScope(exactReplacementMatches, rule.replaceScope),
      reason: exactContainedMatches.length ? 'Text found inside a longer visual token' : undefined
    };
  }

  const caseMatches = candidates.filter(
    (candidate) => normalizeText(candidate.text).toLowerCase() === oldText.toLowerCase()
  );
  const caseContainedMatches = buildContainedMatches({
    candidates,
    oldText,
    newText,
    caseInsensitive: true,
    confidence: 0.97
  });
  const caseReplacementMatches = preferSmallestNonOverlapping([
    ...caseContainedMatches,
    ...caseMatches.map((match) => ({ ...match, confidence: 0.98 }))
  ]);
  if (caseReplacementMatches.length && ['case_insensitive', 'fuzzy', 'ai'].includes(rule.matchType)) {
    return {
      status: 'replaced',
      matches: byScope(caseReplacementMatches, rule.replaceScope),
      reason: caseContainedMatches.length ? 'Text found inside a longer visual token' : undefined
    };
  }

  const looseOldText = normalizeForLooseMatch(oldText);
  const normalizedMatches = candidates.filter(
    (candidate) => normalizeForLooseMatch(candidate.text) === looseOldText
  );
  if (normalizedMatches.length && ['case_insensitive', 'fuzzy', 'ai'].includes(rule.matchType)) {
    return { status: 'replaced', matches: byScope(normalizedMatches, rule.replaceScope).map((m) => ({ ...m, confidence: 0.94 })) };
  }

  if (['fuzzy', 'ai'].includes(rule.matchType)) {
    const fuzzyMatches = candidates
      .map((candidate) => ({
        ...candidate,
        confidence: similarity(normalizeForLooseMatch(candidate.text), looseOldText)
      }))
      .filter((candidate) => candidate.confidence >= rule.minConfidence)
      .sort((a, b) => b.confidence - a.confidence);

    if (fuzzyMatches.length) {
      return { status: 'replaced', matches: byScope(fuzzyMatches, rule.replaceScope) };
    }
  }

  if (rule.matchType === 'ai') {
    const aiCandidates = candidates
      .map((candidate) => ({
        ...candidate,
        confidence: similarity(normalizeForLooseMatch(candidate.text), looseOldText)
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, env.aiMaxCandidates);

    const aiResult = await aiMatchingService.identifyMatches({ rule, file, extracted, candidates: aiCandidates });
    if (aiResult.matches?.length) {
      const highConfidence = aiResult.matches.filter((match) => match.confidence >= rule.minConfidence);
      if (highConfidence.length) return { status: 'replaced', matches: byScope(highConfidence, rule.replaceScope) };
      if (env.lowConfidencePolicy === 'review_required') {
        return { status: 'review_required', matches: aiResult.matches, reason: 'AI confidence below threshold' };
      }
    }
  }

  return { status: 'skipped_not_found', matches: [], reason: 'Text not found' };
};
