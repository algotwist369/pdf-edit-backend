import mongoose from 'mongoose';

export const MATCH_TYPES = ['exact', 'case_insensitive', 'fuzzy', 'ai'];
export const REPLACE_SCOPES = ['first', 'all', 'manual_selected'];
export const APPLY_TO = ['all', 'google_ads', 'meta_ads', 'justdial', 'selected'];

const replacementRuleSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'PdfBatch', required: true, index: true },
    oldText: { type: String, required: true },
    newText: { type: String, required: true },
    matchType: { type: String, enum: MATCH_TYPES, required: true },
    replaceScope: { type: String, enum: REPLACE_SCOPES, required: true },
    applyTo: { type: String, enum: APPLY_TO, required: true },
    selectedFileIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PdfFile' }],
    autoResizeFont: { type: Boolean, default: true },
    allowMultiline: { type: Boolean, default: false },
    minConfidence: { type: Number, min: 0, max: 1, default: 0.82 },
    manualSelections: [
      {
        fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'PdfFile' },
        pageIndex: Number,
        x: Number,
        y: Number,
        width: Number,
        height: Number
      }
    ]
  },
  { timestamps: true }
);

export const ReplacementRule = mongoose.model('ReplacementRule', replacementRuleSchema);
