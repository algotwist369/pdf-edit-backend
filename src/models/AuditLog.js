import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'PdfBatch', index: true },
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'PdfFile', index: true },
    action: { type: String, required: true, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed }
  },
  { timestamps: true }
);

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
