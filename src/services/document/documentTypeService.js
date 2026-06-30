import { env } from '../../config/env.js';
import { aiMatchingService } from '../ai/aiMatchingService.js';
import { detectDocumentTypeHeuristically } from '../pdf/pdfExtractionService.js';

const heuristicConfidence = (type) => {
  if (['google_ads', 'meta_ads', 'justdial'].includes(type)) return 0.86;
  if (type === 'other') return 0.45;
  return 0;
};

export const detectDocumentTypeForPdf = async (extracted) => {
  if (!extracted.fullText?.trim()) {
    return {
      documentType: 'unknown',
      documentTypeConfidence: 0,
      documentTypeSource: 'none',
      documentTypeReason: 'No extractable text available for document type detection'
    };
  }

  const heuristicType = detectDocumentTypeHeuristically(extracted.fullText);

  try {
    const aiResult = await aiMatchingService.detectDocumentType(extracted.fullText);
    if (
      aiResult.type &&
      aiResult.type !== 'unknown' &&
      aiResult.confidence >= env.aiDocumentTypeMinConfidence
    ) {
      return {
        documentType: aiResult.type,
        documentTypeConfidence: aiResult.confidence,
        documentTypeSource: 'llm',
        documentTypeReason: aiResult.reason
      };
    }

    return {
      documentType: heuristicType,
      documentTypeConfidence: heuristicConfidence(heuristicType),
      documentTypeSource: 'fallback',
      documentTypeReason:
        aiResult.reason || `LLM confidence was below ${env.aiDocumentTypeMinConfidence}; heuristic fallback used`
    };
  } catch (error) {
    return {
      documentType: heuristicType,
      documentTypeConfidence: heuristicConfidence(heuristicType),
      documentTypeSource: 'fallback',
      documentTypeReason: `LLM document type detection failed: ${error.message}`
    };
  }
};
