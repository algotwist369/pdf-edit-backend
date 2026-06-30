import { env } from './env.js';

const configuredOrigins = new Set(
  env.frontendOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

export const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (configuredOrigins.has(origin)) return true;
  if (env.nodeEnv !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return true;
  return false;
};

export const corsOrigin = (origin, callback) => {
  callback(null, isAllowedOrigin(origin));
};
