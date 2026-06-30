import fs from 'fs/promises';
import { PDFDocument, rgb } from 'pdf-lib';
import { embedPdfFonts, textNeedsUnicodeFont } from './pdfFonts.js';

const MIN_FONT_SIZE = 4;
const MAX_FONT_SIZE = 72;
const TEXT_LAYER_FONT_SCALE = 1;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const normalizeDrawableText = (text, allowMultiline = false) => {
  const value = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

  if (!allowMultiline) return value.replace(/\s+/g, ' ').trim();

  return value
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .trim();
};

const pdfLibBox = (page, match) => ({
  x: match.x,
  y: page.getHeight() - match.y - match.height,
  width: match.width,
  height: match.height
});

const toPdfLibBox = (page, box) => ({
  x: box.x,
  y: page.getHeight() - box.y - box.height,
  width: box.width,
  height: box.height
});

const inferOriginalFontSize = (replacement) => {
  const source = replacement.source || replacement.items?.[0]?.source;
  if (replacement.fontSize) {
    const scale = source === 'ocr' ? 1.18 : TEXT_LAYER_FONT_SCALE;
    return clamp(replacement.fontSize * scale, MIN_FONT_SIZE, MAX_FONT_SIZE);
  }

  const itemHeights = (replacement.items || [])
    .map((item) => Number(item.height))
    .filter((height) => Number.isFinite(height) && height > 0);
  const medianItemHeight = itemHeights.sort((a, b) => a - b)[Math.floor(itemHeights.length / 2)];

  if (source === 'ocr') {
    return clamp((medianItemHeight || replacement.height) * 1.18, MIN_FONT_SIZE, MAX_FONT_SIZE);
  }

  return clamp((medianItemHeight || replacement.height) * TEXT_LAYER_FONT_SCALE, MIN_FONT_SIZE, MAX_FONT_SIZE);
};

const inferRawOriginalFontSize = (replacement) => {
  if (replacement.fontSize) return clamp(replacement.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE);
  const heights = (replacement.items || [])
    .map((item) => Number(item.height))
    .filter((height) => Number.isFinite(height) && height > 0)
    .sort((a, b) => a - b);
  return clamp(heights[Math.floor(heights.length / 2)] || replacement.height, MIN_FONT_SIZE, MAX_FONT_SIZE);
};

const chooseFont = ({ replacement, regularFont, boldFont, unicodeRegularFont, unicodeBoldFont }) => {
  const text = normalizeDrawableText(replacement.oldText || replacement.text || replacement.items?.map((item) => item.text).join(' '));
  if (textNeedsUnicodeFont(replacement.newText) || textNeedsUnicodeFont(text)) {
    return replacement.isBold ? unicodeBoldFont : unicodeRegularFont;
  }
  if (replacement.isBold) return boldFont;
  const rawSize = inferRawOriginalFontSize(replacement);
  const regularDiff = Math.abs(regularFont.widthOfTextAtSize(text, rawSize) - replacement.width);
  const boldDiff = Math.abs(boldFont.widthOfTextAtSize(text, rawSize) - replacement.width);
  return boldDiff + 0.2 < regularDiff ? boldFont : regularFont;
};

const wrapLines = (font, text, fontSize, maxWidth, allowMultiline) => {
  const drawableText = normalizeDrawableText(text, allowMultiline);
  if (!allowMultiline) return [drawableText];
  const lines = [];

  for (const paragraph of drawableText.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }

  return lines.length ? lines : [''];
};

const measureLines = (font, lines, fontSize) => {
  const lineHeight = fontSize * 1.12;
  return {
    maxLineWidth: Math.max(...lines.map((line) => font.widthOfTextAtSize(line, fontSize)), 0),
    lineHeight,
    totalTextHeight: lines.length > 1 ? lineHeight * lines.length : font.heightAtSize(fontSize)
  };
};

const fitTextBlock = ({ font, text, boxWidth, boxHeight, preferredSize, autoResize, allowMultiline }) => {
  let size = preferredSize;
  const maxWidth = Math.max(boxWidth, 1);
  const maxHeight = Math.max(boxHeight, 1);

  while (size > MIN_FONT_SIZE) {
    const lines = wrapLines(font, text, size, maxWidth, allowMultiline);
    const metrics = measureLines(font, lines, size);
    if (!autoResize || (metrics.maxLineWidth <= maxWidth && metrics.totalTextHeight <= maxHeight)) {
      return { fontSize: clamp(size, MIN_FONT_SIZE, MAX_FONT_SIZE), lines, ...metrics };
    }
    size -= 0.25;
  }

  const lines = wrapLines(font, text, MIN_FONT_SIZE, maxWidth, allowMultiline);
  return { fontSize: MIN_FONT_SIZE, lines, ...measureLines(font, lines, MIN_FONT_SIZE) };
};

const getOverlayPadding = (replacement) => {
  const source = replacement.source || replacement.items?.[0]?.source;
  if (source === 'ocr') {
    return {
      x: Math.max(replacement.height * 0.08, 0.4),
      y: Math.max(replacement.height * 0.12, 0.6)
    };
  }
  return {
    x: Math.max(replacement.height * 0.08, 0.35),
    y: Math.max(replacement.height * 0.18, 0.8)
  };
};

const chooseDrawBox = ({ page, font, replacement, preferredSize }) => {
  const matchBox = pdfLibBox(page, replacement);
  if (!replacement.lineBox) return matchBox;

  const lineBox = toPdfLibBox(page, replacement.lineBox);
  const source = replacement.source || replacement.items?.[0]?.source;
  const newTextWidth = font.widthOfTextAtSize(
    normalizeDrawableText(replacement.newText, replacement.allowMultiline).split('\n')[0] || '',
    preferredSize
  );

  if (source === 'ocr' && !replacement.allowMultiline) {
    const maxRight = lineBox.x + lineBox.width;
    const preferredWidth = Math.max(matchBox.width, newTextWidth * 1.06);
    return {
      ...matchBox,
      width: Math.min(preferredWidth, Math.max(matchBox.width, maxRight - matchBox.x))
    };
  }

  const shouldUseLineBox =
    replacement.allowMultiline ||
    newTextWidth > matchBox.width * 1.08 ||
    replacement.newText.length > String(replacement.oldText || replacement.text || '').length * 1.1;

  if (!shouldUseLineBox) return matchBox;

  return {
    x: Math.min(matchBox.x, lineBox.x),
    y: Math.min(matchBox.y, lineBox.y),
    width: Math.min(
      Math.max(
        Math.max(matchBox.x + matchBox.width, lineBox.x + lineBox.width) - Math.min(matchBox.x, lineBox.x),
        lineBox.width <= matchBox.width * 1.05 ? newTextWidth * 1.08 : 0
      ),
      page.getWidth() - Math.min(matchBox.x, lineBox.x) - Math.max(matchBox.height * 3, 24)
    ),
    height: Math.max(matchBox.y + matchBox.height, lineBox.y + lineBox.height) - Math.min(matchBox.y, lineBox.y)
  };
};

const boxesOverlap = (a, b) => {
  if (a.pageIndex !== b.pageIndex) return false;
  const xOverlap = Math.max(0, Math.min(a.overlayBox.x + a.overlayBox.width, b.overlayBox.x + b.overlayBox.width) - Math.max(a.overlayBox.x, b.overlayBox.x));
  const yOverlap = Math.max(0, Math.min(a.overlayBox.y + a.overlayBox.height, b.overlayBox.y + b.overlayBox.height) - Math.max(a.overlayBox.y, b.overlayBox.y));
  const overlapArea = xOverlap * yOverlap;
  const minArea = Math.min(a.overlayBox.width * a.overlayBox.height, b.overlayBox.width * b.overlayBox.height);
  return minArea > 0 && overlapArea / minArea > 0.2;
};

const drawReplacement = ({ page, font, replacement }) => {
  const preferredSize = inferOriginalFontSize(replacement);
  const box = chooseDrawBox({ page, font, replacement, preferredSize });
  const padding = getOverlayPadding(replacement);
  const availableWidth = Math.max(box.width - padding.x * 2, 1);
  const availableHeight = Math.max(box.height, 1);
  const fitted = fitTextBlock({
    font,
    text: replacement.newText,
    boxWidth: availableWidth,
    boxHeight: availableHeight,
    preferredSize,
    autoResize: replacement.autoResizeFont,
    allowMultiline: replacement.allowMultiline
  });
  const { fontSize, lines, lineHeight, totalTextHeight } = fitted;
  const overlayHeight = Math.max(box.height, totalTextHeight + padding.y * 2);
  const overlayY = box.y - Math.max(overlayHeight - box.height, 0) / 2;
  const firstBaselineY =
    overlayY + (overlayHeight - totalTextHeight) / 2 + Math.max(totalTextHeight - fontSize, 0) + fontSize * 0.12;

  page.drawRectangle({
    x: box.x - padding.x,
    y: overlayY - padding.y,
    width: box.width + padding.x * 2,
    height: overlayHeight + padding.y * 2,
    color: rgb(1, 1, 1)
  });

  lines.forEach((line, index) => {
    page.drawText(normalizeDrawableText(line), {
      x: box.x + padding.x,
      y: firstBaselineY - index * lineHeight,
      size: fontSize,
      font,
      color: rgb(0, 0, 0)
    });
  });

  replacement.fontSize = fontSize;
  replacement.renderBox = {
    x: box.x + padding.x,
    y: firstBaselineY,
    width: availableWidth,
    height: overlayHeight
  };
  replacement.overlayBox = {
    x: box.x - padding.x,
    y: overlayY - padding.y,
    width: box.width + padding.x * 2,
    height: overlayHeight + padding.y * 2
  };
};

const prepareReplacementLayout = ({ page, font, replacement }) => {
  const preferredSize = inferOriginalFontSize(replacement);
  const box = chooseDrawBox({ page, font, replacement, preferredSize });
  const padding = getOverlayPadding(replacement);
  const fitted = fitTextBlock({
    font,
    text: replacement.newText,
    boxWidth: Math.max(box.width - padding.x * 2, 1),
    boxHeight: Math.max(box.height, 1),
    preferredSize,
    autoResize: replacement.autoResizeFont,
    allowMultiline: replacement.allowMultiline
  });
  const { fontSize, totalTextHeight } = fitted;
  const overlayHeight = Math.max(box.height, totalTextHeight + padding.y * 2);
  const overlayY = box.y - Math.max(overlayHeight - box.height, 0) / 2;

  return {
    pageIndex: replacement.pageIndex,
    replacement,
    fontSize,
    preferredSize,
    overlayBox: {
      x: box.x - padding.x,
      y: overlayY - padding.y,
      width: box.width + padding.x * 2,
      height: overlayHeight + padding.y * 2
    }
  };
};

const resolveOverlappingReplacements = ({ pdfDoc, replacements, fonts }) => {
  const layouts = replacements
    .map((replacement, index) => {
      const page = pdfDoc.getPages()[replacement.pageIndex];
      if (!page) return null;
      const font = chooseFont({ replacement, ...fonts });
      return {
        ...prepareReplacementLayout({ page, font, replacement }),
        index
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.pageIndex - b.pageIndex || a.overlayBox.y - b.overlayBox.y || a.overlayBox.x - b.overlayBox.x);

  const accepted = [];
  for (const layout of layouts) {
    const collision = accepted.find((existing) => boxesOverlap(existing, layout));
    if (!collision) {
      accepted.push(layout);
      continue;
    }

    const existingArea = collision.overlayBox.width * collision.overlayBox.height;
    const nextArea = layout.overlayBox.width * layout.overlayBox.height;
    const shouldReplace = nextArea > existingArea * 1.15 || layout.replacement.confidence > collision.replacement.confidence;
    if (shouldReplace) {
      collision.replacement.skippedOverlap = true;
      accepted.splice(accepted.indexOf(collision), 1, layout);
    } else {
      layout.replacement.skippedOverlap = true;
    }
  }

  return accepted.sort((a, b) => a.index - b.index).map((layout) => layout.replacement);
};

export const replaceTextInPdf = async ({ originalPath, replacements, outputName }) => {
  const originalBytes = await fs.readFile(originalPath);
  const pdfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: false });
  const fonts = await embedPdfFonts(pdfDoc);

  const safeReplacements = resolveOverlappingReplacements({ pdfDoc, replacements, fonts });

  for (const replacement of safeReplacements) {
    const page = pdfDoc.getPages()[replacement.pageIndex];
    if (!page) continue;
    const font = chooseFont({ replacement, ...fonts });
    drawReplacement({ page, font, replacement });
  }

  const bytes = await pdfDoc.save();
  return {
    outputName,
    buffer: Buffer.from(bytes),
    replacements
  };
};



