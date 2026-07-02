import mongoose from 'mongoose';
import { emitAuditLog } from '../realtime/socket.js';

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

// Add TTL index to automatically delete logs after 48 hours
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 48 * 60 * 60 });

// Post save middleware to emit audit log event
auditLogSchema.post('save', async function (doc) {
  try {
    await emitAuditLog(doc);
  } catch (err) {
    console.error('Failed to emit audit log:', err);
  }
});

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
