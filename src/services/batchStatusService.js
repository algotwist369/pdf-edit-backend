import { PdfBatch } from '../models/PdfBatch.js';
import { PdfFile } from '../models/PdfFile.js';

const FINISHED_FILE_STATUSES = new Set(['edited', 'edited_with_skips', 'skipped', 'failed']);

const msBetween = (start, end) => {
  if (!start) return 0;
  return Math.max(new Date(end).getTime() - new Date(start).getTime(), 0);
};

export const buildBatchStatusPayload = async (batchId) => {
  const batch = await PdfBatch.findById(batchId).lean();
  if (!batch) return null;

  const files = await PdfFile.find({ batchId: batch._id }).select('status').lean();
  const processedFiles = files.filter((file) => FINISHED_FILE_STATUSES.has(file.status)).length;
  const totalFiles = batch.totalFiles || files.length;
  const now = new Date();
  const startedAt = batch.startedAt || batch.queuedAt;
  const elapsedMs = startedAt ? msBetween(startedAt, batch.completedAt || now) : 0;
  const durationMs = batch.completedAt && startedAt ? msBetween(startedAt, batch.completedAt) : null;
  const averageMsPerProcessedFile = processedFiles > 0 ? Math.round(elapsedMs / processedFiles) : null;
  const remainingFiles = Math.max(totalFiles - processedFiles, 0);

  return {
    batchId: batch._id,
    status: batch.status,
    progress: {
      totalFiles,
      processedFiles,
      remainingFiles,
      progressPercent: totalFiles ? Math.round((processedFiles / totalFiles) * 100) : 0
    },
    timing: {
      queuedAt: batch.queuedAt,
      startedAt: batch.startedAt,
      completedAt: batch.completedAt,
      serverNow: now,
      elapsedMs,
      durationMs,
      averageMsPerProcessedFile,
      estimatedRemainingMs: averageMsPerProcessedFile && !batch.completedAt ? averageMsPerProcessedFile * remainingFiles : 0
    },
    artifacts: {
      zipReady: Boolean(batch.zipKey),
      reportReady: Boolean(batch.reportJsonKey),
      zipKey: Boolean(batch.zipKey),
      reportKey: Boolean(batch.reportJsonKey)
    },
    totals: {
      totalFiles: batch.totalFiles,
      editedFiles: batch.editedFiles,
      skippedFiles: batch.skippedFiles,
      failedFiles: batch.failedFiles,
      totalReplacements: batch.totalReplacements,
      reviewRequiredCount: batch.reviewRequiredCount,
      notFoundCount: batch.notFoundCount
    }
  };
};
