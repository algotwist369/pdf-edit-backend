import { env } from '../../config/env.js';
import { PdfBatch } from '../../models/PdfBatch.js';
import { PdfFile } from '../../models/PdfFile.js';
import { ProcessingJob } from '../../models/ProcessingJob.js';
import { ReplacementResult } from '../../models/ReplacementResult.js';
import { ReplacementRule } from '../../models/ReplacementRule.js';
import { storage } from './localStorageService.js';

const CLEANABLE_STATUSES = ['uploaded', 'cancelled', 'completed', 'completed_with_warnings', 'failed'];
let cleanupRunning = false;

export const cleanupExpiredStorage = async () => {
  if (cleanupRunning) return { skipped: true };
  cleanupRunning = true;

  try {
    const cutoff = new Date(Date.now() - env.storageRetentionHours * 60 * 60 * 1000);
    const batches = await PdfBatch.find({
      createdAt: { $lt: cutoff },
      status: { $in: CLEANABLE_STATUSES }
    }).lean();

    for (const batch of batches) {
      const files = await PdfFile.find({ batchId: batch._id }).lean();
      await Promise.all([
        ...files.flatMap((file) => [
          storage.deleteKey(file.originalKey),
          storage.deleteKey(file.editedKey)
        ]),
        storage.deleteKey(batch.zipKey),
        storage.deleteKey(batch.reportJsonKey),
        storage.deleteKey(batch.reportCsvKey)
      ]);

      await Promise.all([
        ReplacementResult.deleteMany({ batchId: batch._id }),
        ReplacementRule.deleteMany({ batchId: batch._id }),
        ProcessingJob.deleteMany({ batchId: batch._id }),
        PdfFile.deleteMany({ batchId: batch._id }),
        PdfBatch.deleteOne({ _id: batch._id })
      ]);
    }

    if (batches.length) {
      console.log(`Storage cleanup deleted ${batches.length} expired batch(es).`);
    }
    return { deletedBatches: batches.length };
  } finally {
    cleanupRunning = false;
  }
};

export const startStorageCleanup = () => {
  const intervalMs = Math.max(env.storageCleanupIntervalMinutes, 5) * 60 * 1000;
  setTimeout(() => cleanupExpiredStorage().catch((error) => console.error('Storage cleanup failed:', error)), 30000).unref();
  setInterval(() => cleanupExpiredStorage().catch((error) => console.error('Storage cleanup failed:', error)), intervalMs).unref();
};
