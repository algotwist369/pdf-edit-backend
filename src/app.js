import cors from 'cors';
import compression from 'compression';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { corsOrigin } from './config/cors.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { authRoutes } from './routes/authRoutes.js';
import { pdfBatchRoutes } from './routes/pdfBatchRoutes.js';

export const app = express();

app.set('trust proxy', env.trustProxy);
app.use(helmet());
app.use(compression());
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(
  morgan(
    env.nodeEnv === 'production'
      ? 'combined'
      : ':method :url :status :response-time ms - :res[content-length]'
  )
);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/pdf-batches', pdfBatchRoutes);
app.use(notFound);
app.use(errorHandler);
