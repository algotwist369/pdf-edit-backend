import dotenv from 'dotenv';

dotenv.config();

const numberFromEnv = (key, fallback) => {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: numberFromEnv('PORT', 8080),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pdf_replacement_tool',
  mongoMemoryFallback: process.env.MONGO_MEMORY_FALLBACK !== 'false',
  mongoMaxPoolSize: numberFromEnv('MONGO_MAX_POOL_SIZE', 50),
  mongoMinPoolSize: numberFromEnv('MONGO_MIN_POOL_SIZE', 5),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  maxPdfsPerBatch: numberFromEnv('MAX_PDFS_PER_BATCH', 50),
  maxPdfSizeMb: numberFromEnv('MAX_PDF_SIZE_MB', 25),
  lowConfidencePolicy: process.env.LOW_CONFIDENCE_POLICY || 'review_required',
  storageDriver: process.env.STORAGE_DRIVER || 'local',
  localStorageRoot: process.env.LOCAL_STORAGE_ROOT || 'storage',
  aiMatchingProvider: process.env.AI_MATCHING_PROVIDER || 'openai',
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  aiMatchTimeoutMs: numberFromEnv('AI_MATCH_TIMEOUT_MS', 8000),
  aiMaxCandidates: numberFromEnv('AI_MAX_CANDIDATES', 25),
  inMemoryQueueConcurrency: numberFromEnv('IN_MEMORY_QUEUE_CONCURRENCY', 2),
  pdfFileConcurrency: numberFromEnv('PDF_FILE_CONCURRENCY', 3),
  maxActiveBatchesPerUser: numberFromEnv('MAX_ACTIVE_BATCHES_PER_USER', 3),
  jobLockTimeoutMinutes: numberFromEnv('JOB_LOCK_TIMEOUT_MINUTES', 30),
  requestTimeoutMs: numberFromEnv('REQUEST_TIMEOUT_MS', 120000),
  keepAliveTimeoutMs: numberFromEnv('KEEP_ALIVE_TIMEOUT_MS', 65000),
  headersTimeoutMs: numberFromEnv('HEADERS_TIMEOUT_MS', 66000),
  aiDocumentTypeMinConfidence: numberFromEnv('AI_DOCUMENT_TYPE_MIN_CONFIDENCE', 0.7),
  ocrEnabled: process.env.OCR_ENABLED !== 'false',
  ocrLang: process.env.OCR_LANG || 'eng',
  ocrRenderScale: numberFromEnv('OCR_RENDER_SCALE', 2),
  storageRetentionHours: numberFromEnv('STORAGE_RETENTION_HOURS', 24),
  storageCleanupIntervalMinutes: numberFromEnv('STORAGE_CLEANUP_INTERVAL_MINUTES', 60),
  trustProxy: numberFromEnv('TRUST_PROXY', 1),
  socketIoAdapter: process.env.SOCKET_IO_ADAPTER || 'mongo'
};

export const limits = {
  maxPdfBytes: env.maxPdfSizeMb * 1024 * 1024,
  maxPdfsPerBatch: env.maxPdfsPerBatch
};
