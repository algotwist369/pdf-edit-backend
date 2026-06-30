import fs from 'fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { env } from '../../config/env.js';

const parseTsvWords = (tsv) => {
  const rows = String(tsv || '').trim().split(/\r?\n/);
  const standardHeader = [
    'level',
    'page_num',
    'block_num',
    'par_num',
    'line_num',
    'word_num',
    'left',
    'top',
    'width',
    'height',
    'conf',
    'text'
  ];
  const firstRow = rows[0]?.split('\t') || [];
  const hasHeader = firstRow.includes('level') && firstRow.includes('text');
  const header = hasHeader ? rows.shift().split('\t') : standardHeader;
  return rows
    .map((row) => {
      const values = row.split('\t');
      return Object.fromEntries(header.map((key, index) => [key, values[index]]));
    })
    .filter((row) => row.level === '5' && row.text?.trim() && Number(row.conf) >= 0);
};

const toTextItem = ({ word, pageIndex, scale }) => {
  const text = word.text?.trim();
  if (!text) return null;
  const x0 = Number(word.left || 0);
  const y0 = Number(word.top || 0);
  const width = Number(word.width || 0);
  const height = Number(word.height || 0);

  return {
    pageIndex,
    text,
    normalizedText: text.replace(/\s+/g, ' ').trim(),
    x: x0 / scale,
    y: y0 / scale,
    width: Math.max(width / scale, 1),
    height: Math.max(height / scale, 1),
    fontName: 'ocr',
    source: 'ocr',
    confidence: Number.isFinite(Number(word.conf)) ? Number(word.conf) / 100 : undefined
  };
};

export const extractPdfTextWithOcr = async (absolutePath) => {
  const data = await fs.readFile(absolutePath);
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data), useWorkerFetch: false }).promise;
  const textItems = [];
  const pages = [];
  const scale = env.ocrRenderScale;
  const worker = await tesseract.createWorker(env.ocrLang);

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const canvasContext = canvas.getContext('2d');

      await page.render({ canvasContext, viewport }).promise;
      const png = canvas.toBuffer('image/png');
      const result = await worker.recognize(png, {}, { text: true, tsv: true });
      const pageItems = parseTsvWords(result.data.tsv)
        .map((word) => toTextItem({ word, pageIndex: pageNumber - 1, scale }))
        .filter(Boolean);

      pages.push({
        pageIndex: pageNumber - 1,
        width: viewport.width / scale,
        height: viewport.height / scale,
        text: pageItems.map((item) => item.text).join(' ')
      });
      textItems.push(...pageItems);
    }
  } finally {
    await worker.terminate();
  }

  const fullText = pages.map((page) => page.text).join('\n');
  return {
    pageCount: pdf.numPages,
    hasTextLayer: false,
    ocrUsed: true,
    scannedPdf: true,
    documentType: 'unknown',
    fullText,
    pages,
    textItems
  };
};
