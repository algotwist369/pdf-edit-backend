import { Router } from 'express';
import {
  addRules,
  analyzeBatch,
  deleteBatch,
  downloadZip,
  getBatch,
  getBatchFiles,
  getBatchFilePdf,
  getBatchReport,
  getBatchResults,
  getBatchStatus,
  pauseBatch,
  processBatch,
  listBatches,
  resumeBatch,
  saveManualPdfEdits,
  cancelBatch,
  uploadBatch
} from '../controllers/pdfBatchController.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadPdfs } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { createRulesSchema } from '../validators/pdfBatchValidators.js';

export const pdfBatchRoutes = Router();

pdfBatchRoutes.use(requireAuth);
pdfBatchRoutes.get('/', listBatches);
pdfBatchRoutes.post('/upload', uploadPdfs, uploadBatch);
pdfBatchRoutes.post('/:batchId/rules', validate(createRulesSchema), addRules);
pdfBatchRoutes.post('/:batchId/analyze', analyzeBatch);
pdfBatchRoutes.post('/:batchId/process', processBatch);
pdfBatchRoutes.post('/:batchId/pause', pauseBatch);
pdfBatchRoutes.post('/:batchId/resume', resumeBatch);
pdfBatchRoutes.post('/:batchId/cancel', cancelBatch);
pdfBatchRoutes.get('/:batchId', getBatch);
pdfBatchRoutes.get('/:batchId/status', getBatchStatus);
pdfBatchRoutes.get('/:batchId/files', getBatchFiles);
pdfBatchRoutes.get('/:batchId/files/:fileId/:variant', getBatchFilePdf);
pdfBatchRoutes.post('/:batchId/files/:fileId/manual-edits', saveManualPdfEdits);
pdfBatchRoutes.get('/:batchId/results', getBatchResults);
pdfBatchRoutes.get('/:batchId/download-zip', downloadZip);
pdfBatchRoutes.get('/:batchId/report', getBatchReport);
pdfBatchRoutes.delete('/:batchId', deleteBatch);
