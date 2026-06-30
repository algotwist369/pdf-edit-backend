import fs from 'fs/promises';
import path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
import { env, limits } from '../config/env.js';
import { PdfBatch } from '../models/PdfBatch.js';
import { PdfFile } from '../models/PdfFile.js';
import { ProcessingJob } from '../models/ProcessingJob.js';
import { ReplacementResult } from '../models/ReplacementResult.js';
import { ReplacementRule } from '../models/ReplacementRule.js';
import { enqueuePdfBatch, pausePdfBatch, resumePdfBatch, cancelPdfBatch } from '../queues/pdfBatchQueue.js';
import { emitBatchStatus } from '../realtime/socket.js';
import { buildBatchStatusPayload } from '../services/batchStatusService.js';
import { chooseWritableFont, embedPdfFonts } from '../services/pdf/pdfFonts.js';
import { buildBatchReport } from '../services/report/reportService.js';
import { createBatchZip } from '../services/report/zipService.js';
import { storage } from '../services/storage/localStorageService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { hashFile } from '../utils/hash.js';
import { assertOwned } from '../utils/ownership.js';

const getOwnedBatch = async (batchId, userId) => {
  const batch = await PdfBatch.findById(batchId);
  assertOwned(batch, userId, 'Batch');
  return batch;
};

const assertUserCanStartBatch = async (userId, excludeBatchId) => {
  const activeQuery = {
    userId,
    status: { $in: ['uploaded', 'queued', 'processing', 'paused'] }
  };
  if (excludeBatchId) activeQuery._id = { $ne: excludeBatchId };
  const activeCount = await PdfBatch.countDocuments(activeQuery);
  if (activeCount >= env.maxActiveBatchesPerUser) {
    throw new AppError(
      `You already have ${activeCount} active batch(es). Please wait, cancel, or delete old batches before starting another.`,
      429,
      'active_batch_limit'
    );
  }
};

const parseRgb = (color = '#000000') => {
  const hex = String(color).replace('#', '').padEnd(6, '0').slice(0, 6);
  const value = Number.parseInt(hex, 16);
  if (!Number.isFinite(value)) return rgb(0, 0, 0);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
};

const numberOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

const cleanupTempUploads = async (files = []) => {
  await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => {})));
};

export const uploadBatch = asyncHandler(async (req, res) => {
  const files = req.files || [];
  if (!files.length) throw new AppError('Upload at least one PDF', 400, 'no_files');
  if (files.length > limits.maxPdfsPerBatch) {
    await cleanupTempUploads(files);
    throw new AppError(`Maximum ${limits.maxPdfsPerBatch} PDFs are allowed`, 400, 'batch_limit_exceeded');
  }
  try {
    await assertUserCanStartBatch(req.user._id);
  } catch (error) {
    await cleanupTempUploads(files);
    throw error;
  }

  const batch = await PdfBatch.create({
    userId: req.user._id,
    name: req.body.name || `PDF batch ${new Date().toISOString()}`,
    status: 'uploaded',
    totalFiles: files.length
  });

  const createdFiles = [];
  for (const file of files) {
    if (file.size > limits.maxPdfBytes) throw new AppError('File too large', 400, 'file_too_large');
    const hash = await hashFile(file.path);
    const artifact = await storage.putUploadedFile(file, 'originals', file.originalname);

    createdFiles.push(
      await PdfFile.create({
        userId: req.user._id,
        batchId: batch._id,
        originalName: file.originalname,
        safeName: artifact.safeName,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        originalHash: hash,
        originalKey: artifact.key
      })
    );
  }

  res.status(201).json({ batch, files: createdFiles });
});

export const listBatches = asyncHandler(async (req, res) => {
  const batches = await PdfBatch.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100);
  res.json({ batches });
});

export const addRules = asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.batchId, req.user._id);
  const rules = await ReplacementRule.insertMany(
    req.body.rules.map((rule) => ({
      userId: req.user._id,
      batchId: batch._id,
      oldText: rule.old_text,
      newText: rule.new_text,
      matchType: rule.match_type,
      replaceScope: rule.replace_scope,
      applyTo: rule.apply_to,
      selectedFileIds: rule.selected_file_ids,
      autoResizeFont: rule.auto_resize_font,
      allowMultiline: rule.allow_multiline,
      minConfidence: rule.min_confidence,
      manualSelections: rule.manual_selections
    }))
  );

  await PdfBatch.findByIdAndUpdate(batch._id, { totalRules: await ReplacementRule.countDocuments({ batchId: batch._id }) });
  res.status(201).json({ rules });
});

export const analyzeBatch = asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.batchId, req.user._id);
  res.json({
    batch,
    message: 'Analysis runs inside the processing worker in this scaffold. Add a dedicated analysis queue for preflight previews.'
  });
});

export const processBatch = asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.batchId, req.user._id);
  if (['queued', 'processing'].includes(batch.status)) {
    throw new AppError('Batch is already processing', 409, 'batch_already_processing');
  }
  if (['completed', 'cancelled'].includes(batch.status)) {
    throw new AppError(`Batch cannot be processed from ${batch.status} status`, 409, 'invalid_batch_status');
  }
  const rulesCount = await ReplacementRule.countDocuments({ batchId: batch._id });
  if (!rulesCount) throw new AppError('Add at least one replacement rule before processing', 400, 'rules_required');
  await assertUserCanStartBatch(req.user._id, batch._id);

  await ReplacementResult.deleteMany({ batchId: batch._id });
  await PdfFile.updateMany(
    { batchId: batch._id },
    {
      $set: {
        status: 'queued',
        replacementCount: 0,
        skippedRuleCount: 0,
        reviewRequiredCount: 0
      },
      $unset: { editedKey: 1, failureReason: 1 }
    }
  );
  await PdfBatch.findByIdAndUpdate(batch._id, {
    $set: {
      status: 'queued',
      queuedAt: new Date(),
      totalRules: rulesCount,
      editedFiles: 0,
      skippedFiles: 0,
      failedFiles: 0,
      totalReplacements: 0,
      reviewRequiredCount: 0,
      notFoundCount: 0
    },
    $unset: { zipKey: 1, reportJsonKey: 1, reportCsvKey: 1, failureReason: 1, completedAt: 1 }
  });
  await enqueuePdfBatch(batch._id);
  await emitBatchStatus(batch._id);
  res.status(202).json({ batchId: batch._id, status: 'queued' });
});

export const getBatch = asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.batchId, req.user._id);
  res.json({ batch });
});

export const getBatchStatus = asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.batchId, req.user._id);
  const payload = await buildBatchStatusPayload(batch._id);
  res.json(payload);
});

export const pauseBatch = asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.batchId, req.user._id);
  if (!['queued', 'processing'].includes(batch.status)) {
    throw new AppError(`Batch cannot be paused from ${batch.status} status`, 409, 'invalid_batch_status');
  }
  await pausePdfBatch(batch._id);
  await emitBatchStatus(batch._id);
  res.json(await buildBatchStatusPayload(batch._id));
});

export const resumeBatch = asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.batchId, req.user._id);
  if (batch.status !== 'paused') {
    throw new AppError(`Batch cannot be resumed from ${batch.status} status`, 409, 'invalid_batch_status');
  }
  await resumePdfBatch(batch._id);
  await emitBatchStatus(batch._id);
  res.json(await buildBatchStatusPayload(batch._id));
});

export const cancelBatch = asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.batchId, req.user._id);
  if (['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(batch.status)) {
    throw new AppError(`Batch cannot be cancelled from ${batch.status} status`, 409, 'invalid_batch_status');
  }
  await cancelPdfBatch(batch._id);
  await emitBatchStatus(batch._id);
  res.json(await buildBatchStatusPayload(batch._id));
});

export const getBatchFiles = asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.batchId, req.user._id);
  const files = await PdfFile.find({ batchId: batch._id }).sort({ createdAt: 1 });
  res.json({ files });
});

export const getBatchResults = asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.batchId, req.user._id);
  const results = await ReplacementResult.find({ batchId: batch._id }).sort({ createdAt: 1 });
  res.json({ results });
});

export const getBatchFilePdf = asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.batchId, req.user._id);
  const file = await PdfFile.findOne({ _id: req.params.fileId, batchId: batch._id, userId: req.user._id });
  if (!file) throw new AppError('File not found', 404, 'file_not_found');

  const variant = req.params.variant;
  if (!['original', 'edited'].includes(variant)) {
    throw new AppError('Invalid PDF variant', 400, 'invalid_pdf_variant');
  }
  if (variant === 'edited' && !file.editedKey) {
    throw new AppError('Edited PDF is not ready yet', 404, 'edited_pdf_not_ready');
  }

  const key = variant === 'edited' ? file.editedKey : file.originalKey;
  const pdfPath = await storage.resolvePath(key);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${variant}-${file.safeName}"`);
  res.sendFile(path.resolve(pdfPath));
});

export const saveManualPdfEdits = asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.batchId, req.user._id);
  const file = await PdfFile.findOne({ _id: req.params.fileId, batchId: batch._id, userId: req.user._id });
  if (!file) throw new AppError('File not found', 404, 'file_not_found');

  const baseVariant = req.body.baseVariant === 'edited' && file.editedKey ? 'edited' : 'original';
  const basePath = await storage.resolvePath(baseVariant === 'edited' ? file.editedKey : file.originalKey);
  const operations = Array.isArray(req.body.operations) ? req.body.operations.slice(0, 500) : [];
  if (!operations.length) throw new AppError('Add at least one manual edit', 400, 'manual_edits_required');

  const pdfDoc = await PDFDocument.load(await fs.readFile(basePath), { ignoreEncryption: false });
  const fonts = await embedPdfFonts(pdfDoc);

  for (const operation of operations) {
    const page = pdfDoc.getPages()[numberOr(operation.pageIndex, -1)];
    if (!page) continue;
    const x = numberOr(operation.x, 0);
    const y = numberOr(operation.y, 0);
    const width = Math.max(numberOr(operation.width, 1), 1);
    const height = Math.max(numberOr(operation.height, 1), 1);
    const pdfY = page.getHeight() - y - height;

    if (operation.type === 'whiteout') {
      page.drawRectangle({ x, y: pdfY, width, height, color: rgb(1, 1, 1) });
      continue;
    }

    if (operation.type === 'text') {
      const text = String(operation.text || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const size = Math.min(Math.max(numberOr(operation.fontSize, 10), 4), 72);
      page.drawText(text, {
        x,
        y: page.getHeight() - y - size,
        size,
        font: chooseWritableFont({ text, bold: operation.bold, ...fonts }),
        color: parseRgb(operation.color)
      });
    }
  }

  const outputName = file.safeName.replace(/\.pdf$/i, '') + '-manual-edited.pdf';
  const artifact = await storage.putBuffer(Buffer.from(await pdfDoc.save()), 'edited', outputName);
  if (file.editedKey) await storage.deleteKey(file.editedKey);

  const updatedFile = await PdfFile.findByIdAndUpdate(
    file._id,
    {
      editedKey: artifact.key,
      status: 'edited',
      failureReason: undefined
    },
    { new: true }
  );
  await Promise.all([
    storage.deleteKey(batch.zipKey),
    storage.deleteKey(batch.reportJsonKey),
    storage.deleteKey(batch.reportCsvKey)
  ]);
  await PdfBatch.findByIdAndUpdate(batch._id, {
    $set: { status: 'completed_with_warnings' },
    $unset: { zipKey: 1, reportJsonKey: 1, reportCsvKey: 1 }
  });
  await buildBatchReport(batch._id);
  await createBatchZip(batch._id);
  await emitBatchStatus(batch._id);
  res.json({ file: updatedFile, editedKey: artifact.key });
});

export const getBatchReport = asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.batchId, req.user._id);
  if (!batch.reportJsonKey) throw new AppError('Report is not ready yet', 404, 'report_not_ready');
  const reportPath = await storage.resolvePath(batch.reportJsonKey);
  res.sendFile(path.resolve(reportPath));
});

export const downloadZip = asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.batchId, req.user._id);
  if (!batch.zipKey) throw new AppError('ZIP is not ready yet', 404, 'zip_not_ready');
  const zipPath = await storage.resolvePath(batch.zipKey);
  res.download(path.resolve(zipPath), `${batch._id}-edited-pdfs.zip`);
});

export const deleteBatch = asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.batchId, req.user._id);
  if (['queued', 'processing'].includes(batch.status)) {
    throw new AppError('Cancel or wait for this batch before deleting it', 409, 'batch_delete_in_progress');
  }
  const files = await PdfFile.find({ batchId: batch._id });
  await Promise.all(
    files.flatMap((file) => [storage.deleteKey(file.originalKey), storage.deleteKey(file.editedKey)])
  );
  await Promise.all([storage.deleteKey(batch.zipKey), storage.deleteKey(batch.reportJsonKey), storage.deleteKey(batch.reportCsvKey)]);
  await Promise.all([
    ReplacementResult.deleteMany({ batchId: batch._id }),
    ReplacementRule.deleteMany({ batchId: batch._id }),
    ProcessingJob.deleteMany({ batchId: batch._id }),
    PdfFile.deleteMany({ batchId: batch._id }),
    PdfBatch.deleteOne({ _id: batch._id })
  ]);
  await fs.rm(path.join('storage', String(batch._id)), { recursive: true, force: true }).catch(() => {});
  res.status(204).send();
});





