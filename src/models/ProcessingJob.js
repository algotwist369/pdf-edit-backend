import mongoose from 'mongoose';

export const JOB_STATUSES = ['queued', 'processing', 'paused', 'cancelled', 'completed', 'failed'];

const processingJobSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['process_pdf_batch'], required: true, index: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'PdfBatch', required: true, index: true },
    status: { type: String, enum: JOB_STATUSES, default: 'queued', index: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    lockedAt: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    failedAt: { type: Date },
    failureReason: { type: String }
  },
  { timestamps: true }
);

processingJobSchema.index({ batchId: 1, type: 1 }, { unique: true });
processingJobSchema.index({ status: 1, createdAt: 1 });
processingJobSchema.index({ status: 1, lockedAt: 1 });

export const ProcessingJob = mongoose.model('ProcessingJob', processingJobSchema);
