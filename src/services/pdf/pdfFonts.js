import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import fontkit from '@pdf-lib/fontkit';
import { StandardFonts } from 'pdf-lib';

const require = createRequire(import.meta.url);

const fontPath = (fileName) =>
  path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts', fileName);

let regularFontBytesPromise;
let boldFontBytesPromise;

const readRegularFontBytes = () => {
  regularFontBytesPromise ||= fs.readFile(fontPath('LiberationSans-Regular.ttf'));
  return regularFontBytesPromise;
};

const readBoldFontBytes = () => {
  boldFontBytesPromise ||= fs.readFile(fontPath('LiberationSans-Bold.ttf'));
  return boldFontBytesPromise;
};

export const textNeedsUnicodeFont = (text) => /[^\u0000-\u00ff]/u.test(String(text ?? ''));

export const embedPdfFonts = async (pdfDoc) => {
  pdfDoc.registerFontkit(fontkit);

  const [regularFont, boldFont, unicodeRegularFont, unicodeBoldFont] = await Promise.all([
    pdfDoc.embedFont(StandardFonts.Helvetica),
    pdfDoc.embedFont(StandardFonts.HelveticaBold),
    pdfDoc.embedFont(await readRegularFontBytes()),
    pdfDoc.embedFont(await readBoldFontBytes())
  ]);

  return { regularFont, boldFont, unicodeRegularFont, unicodeBoldFont };
};

export const chooseWritableFont = ({ text, bold = false, regularFont, boldFont, unicodeRegularFont, unicodeBoldFont }) => {
  if (textNeedsUnicodeFont(text)) return bold ? unicodeBoldFont : unicodeRegularFont;
  return bold ? boldFont : regularFont;
};
