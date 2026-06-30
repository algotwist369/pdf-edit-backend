import mongoose from 'mongoose';

export const RULE_RESULT_STATUSES = [
  'replaced',
  'skipped_not_found',
  'skipped_same_value',
  'invalid_rule',
  'review_required',
  'failed'
];

const replacementResultSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'PdfBatch', required: true, index: true },
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'PdfFile', required: true, index: true },
    ruleId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReplacementRule', required: true, index: true },
    status: { type: String, enum: RULE_RESULT_STATUSES, required: true, index: true },
    replacements: [
      {
        pageIndex: Number,
        oldText: String,
        newText: String,
        confidence: Number,
        x: Number,
        y: Number,
        width: Number,
        height: Number,
        fontSize: Number
      }
    ],
    confidence: { type: Number, min: 0, max: 1, default: 0 },
    reason: { type: String }
  },
  { timestamps: true }
);

replacementResultSchema.index({ batchId: 1, fileId: 1, createdAt: 1 });

export const ReplacementResult = mongoose.model('ReplacementResult', replacementResultSchema);
