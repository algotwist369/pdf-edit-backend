import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

const aiMatchSchema = z.object({
  matches: z
    .array(
      z.object({
        candidateIndex: z.number().int().min(0),
        confidence: z.number().min(0).max(1),
        reason: z.string().max(240)
      })
    )
    .max(10),
  documentType: z.enum(['unknown', 'google_ads', 'meta_ads', 'justdial', 'other']).optional()
});

const documentTypeSchema = z.object({
  type: z.enum(['unknown', 'google_ads', 'meta_ads', 'justdial', 'other']),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(240)
});

const withTimeout = (promise, timeoutMs) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new AppError('AI matching timed out', 504, 'ai_timeout')), timeoutMs)
    )
  ]);

const buildModel = () => {
  if (!env.openAiApiKey) {
    throw new AppError('OPENAI_API_KEY is required when AI_MATCHING_PROVIDER=openai', 500, 'openai_key_missing');
  }

  return new ChatOpenAI({
    apiKey: env.openAiApiKey,
    model: env.openAiModel,
    temperature: 0,
    timeout: env.aiMatchTimeoutMs,
    maxRetries: 1
  });
};

const selectPageBalancedCandidates = (candidates, limit) => {
  const selected = [];
  const byPage = candidates.reduce(
    (map, candidate) => map.set(candidate.pageIndex, [...(map.get(candidate.pageIndex) || []), candidate]),
    new Map()
  );

  while (selected.length < limit && byPage.size) {
    for (const [pageIndex, pageCandidates] of byPage.entries()) {
      const next = pageCandidates.shift();
      if (next) selected.push(next);
      if (!pageCandidates.length) byPage.delete(pageIndex);
      if (selected.length >= limit) break;
    }
  }

  return selected;
};

export class AiMatchingService {
  async identifyMatches({ rule, file, candidates }) {
    if (env.aiMatchingProvider === 'disabled') {
      return { matches: [], reason: 'AI matching provider is disabled' };
    }

    if (env.aiMatchingProvider !== 'openai') {
      throw new AppError(`AI provider "${env.aiMatchingProvider}" is not implemented`, 500, 'ai_provider_unknown');
    }

    const selectedCandidates = selectPageBalancedCandidates(candidates, env.aiMaxCandidates);
    const compactCandidates = selectedCandidates.map((candidate, index) => ({
      candidateIndex: index,
      pageIndex: candidate.pageIndex,
      text: candidate.text
    }));

    const model = buildModel().withStructuredOutput(aiMatchSchema, {
      name: 'pdf_text_match_result'
    });

    const result = await withTimeout(
      model.invoke([
        {
          role: 'system',
          content:
            'You identify invoice PDF text replacement matches. Never suggest PDF edits. Return only candidates that clearly represent the old text. Be conservative, precise, and prefer no match over a risky match.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            documentType: file.documentType,
            oldText: rule.oldText,
            newText: rule.newText,
            matchType: rule.matchType,
            minConfidence: rule.minConfidence,
            candidates: compactCandidates
          })
        }
      ]),
      env.aiMatchTimeoutMs
    );

    return {
      matches: result.matches
        .map((match) => {
          const candidate = compactCandidates[match.candidateIndex];
          const source = selectedCandidates[match.candidateIndex];
          if (!candidate || !source) return null;
          return {
            ...source,
            confidence: match.confidence,
            aiReason: match.reason
          };
        })
        .filter(Boolean),
      documentType: result.documentType
    };
  }

  async detectDocumentType(extractedText) {
    if (env.aiMatchingProvider === 'disabled') return { type: 'unknown', confidence: 0 };
    if (env.aiMatchingProvider !== 'openai') return { type: 'unknown', confidence: 0 };

    const model = buildModel().withStructuredOutput(documentTypeSchema, {
      name: 'pdf_document_type_result'
    });

    return withTimeout(
      model.invoke([
        {
          role: 'system',
          content:
            'Classify an invoice PDF text sample into one document type. Allowed types: google_ads, meta_ads, justdial, other, unknown. Use google_ads for Google Ads/Google India ad invoices, meta_ads for Meta/Facebook ad invoices, justdial for Justdial invoices, other for recognized invoices outside those vendors, and unknown only when evidence is too weak. Return a calibrated confidence and concise reason.'
        },
        {
          role: 'user',
          content: String(extractedText || '').slice(0, 6000)
        }
      ]),
      env.aiMatchTimeoutMs
    );
  }
}

export const aiMatchingService = new AiMatchingService();
