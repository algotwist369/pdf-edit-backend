import { stringify } from 'csv-stringify/sync';
import { PdfBatch } from '../../models/PdfBatch.js';
import { PdfFile } from '../../models/PdfFile.js';
import { ReplacementResult } from '../../models/ReplacementResult.js';
import { ReplacementRule } from '../../models/ReplacementRule.js';
import { storage } from '../storage/localStorageService.js';

export const buildBatchReport = async (batchId) => {
  const [batch, files, rules, results] = await Promise.all([
    PdfBatch.findById(batchId).lean(),
    PdfFile.find({ batchId }).lean(),
    ReplacementRule.find({ batchId }).lean(),
    ReplacementResult.find({ batchId }).lean()
  ]);

  const report = {
    batch: {
      id: batch._id,
      status: batch.status,
      totalPdfs: batch.totalFiles,
      editedPdfs: batch.editedFiles,
      skippedPdfs: batch.skippedFiles,
      failedPdfs: batch.failedFiles,
      totalRules: batch.totalRules,
      totalReplacements: batch.totalReplacements,
      notFoundCount: batch.notFoundCount,
      reviewRequiredCount: batch.reviewRequiredCount,
      failureReason: batch.failureReason
    },
    files: files.map((file) => ({
      id: file._id,
      name: file.originalName,
      status: file.status,
      documentType: file.documentType,
      scannedPdf: file.scannedPdf,
      replacementCount: file.replacementCount,
      skippedRuleCount: file.skippedRuleCount,
      reviewRequiredCount: file.reviewRequiredCount,
      failureReason: file.failureReason
    })),
    rules: rules.map((rule) => ({
      id: rule._id,
      oldText: rule.oldText,
      newText: rule.newText,
      matchType: rule.matchType,
      replaceScope: rule.replaceScope,
      applyTo: rule.applyTo
    })),
    results: results.map((result) => ({
      fileId: result.fileId,
      ruleId: result.ruleId,
      status: result.status,
      confidence: result.confidence,
      replacementCount: result.replacements.length,
      reason: result.reason
    }))
  };

  const csv = stringify(report.results, {
    header: true,
    columns: ['fileId', 'ruleId', 'status', 'confidence', 'replacementCount', 'reason']
  });

  const jsonArtifact = await storage.putBuffer(
    Buffer.from(JSON.stringify(report, null, 2)),
    'reports',
    `${batch._id}-report.json`
  );
  const csvArtifact = await storage.putBuffer(Buffer.from(csv), 'reports', `${batch._id}-report.csv`);

  await PdfBatch.findByIdAndUpdate(batchId, {
    reportJsonKey: jsonArtifact.key,
    reportCsvKey: csvArtifact.key
  });

  return { report, jsonArtifact, csvArtifact };
};
