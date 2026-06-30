import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { PdfBatch } from '../../models/PdfBatch.js';
import { PdfFile } from '../../models/PdfFile.js';
import { storage } from '../storage/localStorageService.js';

export const createBatchZip = async (batchId) => {
  const files = await PdfFile.find({ batchId, editedKey: { $exists: true } }).lean();
  const zipEntries = await Promise.all(
    files.map(async (file) => ({
      path: path.resolve(await storage.resolvePath(file.editedKey)),
      name: file.safeName
    }))
  );
  const tempName = `${batchId}-edited-pdfs.zip`;
  const artifact = await storage.putBuffer(Buffer.alloc(0), 'zips', tempName);
  const outputPath = await storage.resolvePath(artifact.key);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    for (const entry of zipEntries) {
      archive.file(entry.path, { name: entry.name });
    }

    archive.finalize();
  });

  await PdfBatch.findByIdAndUpdate(batchId, { zipKey: artifact.key });
  return artifact;
};
