import mongoose from 'mongoose';

export const FILE_STATUSES = [
  'uploaded',
  'queued',
  'extracting',
  'analyzing',
  'editing',
  'edited',
  'edited_with_skips',
  'skipped',
  'failed'
];

const pdfFileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'PdfBatch', required: true, index: true },
    originalName: { type: String, required: true },
    safeName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    originalHash: { type: String, required: true, index: true },
    originalKey: { type: String, required: true },
    editedKey: { type: String },
    documentType: {
      type: String,
      enum: ['unknown', 'google_ads', 'meta_ads', 'justdial', 'other'],
      default: 'unknown'
    },
    documentTypeConfidence: { type: Number, min: 0, max: 1, default: 0 },
    documentTypeSource: {
      type: String,
      enum: ['none', 'heuristic', 'llm', 'fallback'],
      default: 'none'
    },
    documentTypeReason: { type: String },
    hasTextLayer: { type: Boolean, default: false },
    scannedPdf: { type: Boolean, default: false },
    status: { type: String, enum: FILE_STATUSES, default: 'uploaded', index: true },
    pageCount: { type: Number, default: 0 },
    replacementCount: { type: Number, default: 0 },
    skippedRuleCount: { type: Number, default: 0 },
    reviewRequiredCount: { type: Number, default: 0 },
    failureReason: { type: String }
  },
  { timestamps: true }
);

pdfFileSchema.index({ userId: 1, batchId: 1, createdAt: 1 });

export const PdfFile = mongoose.model('PdfFile', pdfFileSchema);
