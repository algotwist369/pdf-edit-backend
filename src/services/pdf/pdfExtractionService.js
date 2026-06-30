import fs from 'fs/promises';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const viewportScale = 1;

const normalizeItem = (item, pageIndex, viewport) => {
  const [, , , transformHeight, x, baselineY] = item.transform;
  const text = item.str || '';
  const height = Math.abs(item.height || transformHeight || 10);
  const width = Math.abs(item.width || Math.max(text.length * height * 0.5, 1));
  const topY = viewport.height - baselineY - height;

  return {
    pageIndex,
    text,
    normalizedText: text.replace(/\s+/g, ' ').trim(),
    x,
    y: topY,
    width,
    height,
    fontName: item.fontName
  };
};

export const detectDocumentTypeHeuristically = (fullText) => {
  const text = fullText.toLowerCase();
  if (text.includes('google ads') || text.includes('google india')) return 'google_ads';
  if (
    text.includes('meta platforms') ||
    text.includes('facebook ads') ||
    text.includes('meta ads') ||
    text.includes('facebook india')
  ) return 'meta_ads';
  if (text.includes('justdial') || text.includes('just dial')) return 'justdial';
  return 'other';
};

export const extractPdfText = async (absolutePath) => {
  const data = await fs.readFile(absolutePath);
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data), useWorkerFetch: false }).promise;
  const textItems = [];
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: viewportScale });
    const content = await page.getTextContent();
    const pageItems = content.items
      .filter((item) => item.str && item.str.trim())
      .map((item) => normalizeItem(item, pageNumber - 1, viewport));

    pages.push({
      pageIndex: pageNumber - 1,
      width: viewport.width,
      height: viewport.height,
      text: pageItems.map((item) => item.text).join(' ')
    });
    textItems.push(...pageItems);
  }

  const fullText = pages.map((page) => page.text).join('\n');
  return {
    pageCount: pdf.numPages,
    hasTextLayer: textItems.length > 0,
    scannedPdf: textItems.length === 0,
    documentType: textItems.length > 0 ? detectDocumentTypeHeuristically(fullText) : 'unknown',
    fullText,
    pages,
    textItems
  };
};
