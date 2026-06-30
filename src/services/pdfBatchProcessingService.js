import path from 'path';
import pLimit from 'p-limit';
import { env } from '../config/env.js';
import { AuditLog } from '../models/AuditLog.js';
import { PdfBatch } from '../models/PdfBatch.js';
import { PdfFile } from '../models/PdfFile.js';
import { ReplacementResult } from '../models/ReplacementResult.js';
import { ReplacementRule } from '../models/ReplacementRule.js';
import { detectDocumentTypeForPdf } from './document/documentTypeService.js';
import { findMatchesForRule } from './matching/textMatchingService.js';
import { extractPdfText } from './pdf/pdfExtractionService.js';
import { extractPdfTextWithOcr } from './pdf/ocrExtractionService.js';
import { replaceTextInPdf } from './pdf/pdfReplacementService.js';
import { buildBatchReport } from './report/reportService.js';
import { createBatchZip } from './report/zipService.js';
import { storage } from './storage/localStorageService.js';
import { emitBatchStatus } from '../realtime/socket.js';

class BatchInterruptedError extends Error {
  constructor(status) {
    super(`Batch ${status}`);
    this.status = status;
  }
}

const assertBatchCanContinue = async (batchId) => {
  const batch = await PdfBatch.findById(batchId).select('status');
  if (['paused', 'cancelled'].includes(batch?.status)) {
    throw new BatchInterruptedError(batch.status);
  }
};

const getBatchSummary = async (batchId) => {
  const [files, results, rules] = await Promise.all([
    PdfFile.find({ batchId }).lean(),
    ReplacementResult.find({ batchId }).lean(),
    ReplacementRule.find({ batchId }).lean()
  ]);

  const editedFiles = files.filter((file) => ['edited', 'edited_with_skips'].includes(file.status)).length;
  const failedFiles = files.filter((file) => file.status === 'failed').length;
  const skippedFiles = files.filter((file) => file.status === 'skipped').length;
  const totalReplacements = results.reduce((sum, result) => sum + result.replacements.length, 0);
  const notFoundCount = results.filter((result) => result.status === 'skipped_not_found').length;
  const reviewRequiredCount = results.filter((result) => result.status === 'review_required').length;
  const hasWarnings = failedFiles > 0 || skippedFiles > 0 || notFoundCount > 0 || reviewRequiredCount > 0;

  return {
    editedFiles,
    failedFiles,
    skippedFiles,
    totalRules: rules.length,
    totalReplacements,
    notFoundCount,
    reviewRequiredCount,
    finalStatus: hasWarnings ? 'completed_with_warnings' : 'completed'
  };
};

const processFile = async ({ file, rules }) => {
  await assertBatchCanContinue(file.batchId);
  await PdfFile.findByIdAndUpdate(file._id, { status: 'extracting' });
  await emitBatchStatus(file.batchId);
  const originalPath = await storage.resolvePath(file.originalKey);
  let extracted = await extractPdfText(originalPath);
  if (extracted.scannedPdf && env.ocrEnabled) {
    await PdfFile.findByIdAndUpdate(file._id, {
      status: 'extracting',
      failureReason: 'No text layer found; running OCR fallback'
    });
    await emitBatchStatus(file.batchId);
    extracted = await extractPdfTextWithOcr(originalPath);
  }
  await assertBatchCanContinue(file.batchId);
  const documentTypeResult = await detectDocumentTypeForPdf(extracted);
  await assertBatchCanContinue(file.batchId);

  await PdfFile.findByIdAndUpdate(file._id, {
    status: extracted.scannedPdf && !extracted.ocrUsed ? 'skipped' : 'analyzing',
    hasTextLayer: extracted.hasTextLayer,
    scannedPdf: extracted.scannedPdf,
    documentType: documentTypeResult.documentType,
    documentTypeConfidence: documentTypeResult.documentTypeConfidence,
    documentTypeSource: documentTypeResult.documentTypeSource,
    documentTypeReason: documentTypeResult.documentTypeReason,
    pageCount: extracted.pageCount,
    failureReason:
      extracted.scannedPdf && !extracted.ocrUsed ? 'No text layer found; OCR fallback is not enabled' : undefined
  });
  await emitBatchStatus(file.batchId);

  if (extracted.scannedPdf && !extracted.ocrUsed) return;

  const replacementsForPdf = [];
  let skippedRuleCount = 0;
  let reviewRequiredCount = 0;
  const fileForRules = {
    ...(file.toObject ? file.toObject() : file),
    documentType: documentTypeResult.documentType
  };

  await AuditLog.create({
    userId: file.userId,
    batchId: file.batchId,
    fileId: file._id,
    action: 'pdf.document_type_detected',
    metadata: documentTypeResult
  });

  for (const rule of rules) {
    await assertBatchCanContinue(file.batchId);
    try {
      const matchResult = await findMatchesForRule({ rule, file: fileForRules, extracted });
      await assertBatchCanContinue(file.batchId);
      if (matchResult.status !== 'replaced') {
        if (matchResult.status === 'review_required') reviewRequiredCount += 1;
        else skippedRuleCount += 1;
      }

      const replacements = matchResult.matches.map((match) => ({
        pageIndex: match.pageIndex,
        oldText: match.oldText || rule.oldText,
        newText: match.newText || rule.newText,
        x: match.x,
        y: match.y,
        width: match.width,
        height: match.height,
        source: match.source || match.items?.[0]?.source || 'text',
        items: match.items,
        lineBox: match.lineBox,
        fontName: match.fontName,
        fontSize: match.fontSize,
        isBold: match.isBold,
        confidence: match.confidence || 0,
        ruleId: rule._id,
        autoResizeFont: rule.autoResizeFont,
        allowMultiline: rule.allowMultiline
      }));

      replacementsForPdf.push(...(matchResult.status === 'replaced' ? replacements : []));

      await ReplacementResult.create({
        userId: file.userId,
        batchId: file.batchId,
        fileId: file._id,
        ruleId: rule._id,
        status: matchResult.status,
        confidence: replacements[0]?.confidence || 0,
        reason: matchResult.reason,
        replacements
      });
    } catch (error) {
      skippedRuleCount += 1;
      await ReplacementResult.create({
        userId: file.userId,
        batchId: file.batchId,
        fileId: file._id,
        ruleId: rule._id,
        status: 'failed',
        reason: error.message,
        replacements: []
      });
    }
  }

  if (!replacementsForPdf.length) {
    await assertBatchCanContinue(file.batchId);
    await PdfFile.findByIdAndUpdate(file._id, {
      status: reviewRequiredCount ? 'edited_with_skips' : 'skipped',
      skippedRuleCount,
      reviewRequiredCount
    });
    await emitBatchStatus(file.batchId);
    return;
  }

  await assertBatchCanContinue(file.batchId);
  await PdfFile.findByIdAndUpdate(file._id, { status: 'editing' });
  await emitBatchStatus(file.batchId);
  const outputName = file.safeName.replace(/\.pdf$/i, '') + '-edited.pdf';
  const edited = await replaceTextInPdf({
    originalPath,
    replacements: replacementsForPdf,
    outputName
  });
  const skippedVisualReplacements = replacementsForPdf.filter(
    (replacement) => replacement.skippedOverlap || replacement.skippedFit
  );
  if (skippedVisualReplacements.length) {
    await Promise.all(
      skippedVisualReplacements.map((replacement) =>
        ReplacementResult.updateOne(
          {
            batchId: file.batchId,
            fileId: file._id,
            ruleId: replacement.ruleId
          },
          {
            status: 'review_required',
            reason: replacement.skippedFit
              ? 'Skipped because replacement text could not fit safely in the original visual area'
              : 'Skipped because this replacement overlapped another replacement on the same visual area'
          }
        )
      )
    );
    reviewRequiredCount += skippedVisualReplacements.length;
  }
  await assertBatchCanContinue(file.batchId);
  const artifact = await storage.putBuffer(edited.buffer, 'edited', outputName);
  await assertBatchCanContinue(file.batchId);

  await PdfFile.findByIdAndUpdate(file._id, {
    status: skippedRuleCount || reviewRequiredCount ? 'edited_with_skips' : 'edited',
    editedKey: artifact.key,
    replacementCount: replacementsForPdf.length - skippedVisualReplacements.length,
    skippedRuleCount,
    reviewRequiredCount
  });
  await emitBatchStatus(file.batchId);

  await AuditLog.create({
    userId: file.userId,
    batchId: file.batchId,
    fileId: file._id,
    action: 'pdf.edited',
    metadata: { replacementCount: replacementsForPdf.length, outputName: path.basename(artifact.key) }
  });
};

export const processPdfBatch = async (batchId) => {
  await assertBatchCanContinue(batchId);
  await PdfBatch.findByIdAndUpdate(batchId, {
    status: 'processing',
    startedAt: new Date()
  });
  await emitBatchStatus(batchId);

  const batch = await PdfBatch.findById(batchId);
  const [files, rules] = await Promise.all([
    PdfFile.find({ batchId }).sort({ createdAt: 1 }),
    ReplacementRule.find({ batchId }).sort({ createdAt: 1 })
  ]);

  if (!batch || !files.length) {
    await PdfBatch.findByIdAndUpdate(batchId, { status: 'failed', failureReason: 'No files found' });
    return;
  }

  const fileLimit = pLimit(env.pdfFileConcurrency);
  try {
    await Promise.all(files.map((file) => fileLimit(async () => {
      try {
        await processFile({ file, rules });
      } catch (error) {
        if (error instanceof BatchInterruptedError) throw error;
        await PdfFile.findByIdAndUpdate(file._id, {
          status: 'failed',
          failureReason: error.message
        });
        await emitBatchStatus(file.batchId);
        await AuditLog.create({
          userId: file.userId,
          batchId: file.batchId,
          fileId: file._id,
          action: 'pdf.failed',
          metadata: { reason: error.message }
        });
      }
    })));
  } catch (error) {
    if (error instanceof BatchInterruptedError) {
      await emitBatchStatus(batchId);
      return;
    }
    throw error;
  }

  await assertBatchCanContinue(batchId);
  const summary = await getBatchSummary(batchId);
  await PdfBatch.findByIdAndUpdate(batchId, {
    ...summary,
    status: 'processing'
  });
  await assertBatchCanContinue(batchId);
  await buildBatchReport(batchId);
  await emitBatchStatus(batchId);
  await assertBatchCanContinue(batchId);
  await createBatchZip(batchId);
  await assertBatchCanContinue(batchId);
  await PdfBatch.findByIdAndUpdate(batchId, {
    status: summary.finalStatus,
    completedAt: new Date()
  });
  await emitBatchStatus(batchId);
};
