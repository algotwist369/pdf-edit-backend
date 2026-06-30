import mongoose from 'mongoose';

export const BATCH_STATUSES = [
  'uploaded',
  'queued',
  'processing',
  'paused',
  'cancelled',
  'completed',
  'completed_with_warnings',
  'failed'
];

const pdfBatchSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: BATCH_STATUSES, default: 'uploaded', index: true },
    totalFiles: { type: Number, default: 0 },
    editedFiles: { type: Number, default: 0 },
    skippedFiles: { type: Number, default: 0 },
    failedFiles: { type: Number, default: 0 },
    totalRules: { type: Number, default: 0 },
    totalReplacements: { type: Number, default: 0 },
    reviewRequiredCount: { type: Number, default: 0 },
    notFoundCount: { type: Number, default: 0 },
    zipKey: { type: String },
    reportJsonKey: { type: String },
    reportCsvKey: { type: String },
    failureReason: { type: String },
    queuedAt: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date }
  },
  { timestamps: true }
);

pdfBatchSchema.index({ userId: 1, status: 1, createdAt: -1 });
pdfBatchSchema.index({ createdAt: 1, status: 1 });

export const PdfBatch = mongoose.model('PdfBatch', pdfBatchSchema);
