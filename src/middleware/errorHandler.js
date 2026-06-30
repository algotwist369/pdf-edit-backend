import { env } from '../config/env.js';

export const notFound = (_req, _res, next) => {
  const error = new Error('Route not found');
  error.statusCode = 404;
  next(error);
};

export const errorHandler = (err, _req, res, _next) => {
  const statusCode = err.statusCode || 500;
  const payload = {
    error: {
      message: err.message || 'Internal server error',
      code: err.code || 'internal_error'
    }
  };

  if (env.nodeEnv !== 'production') payload.error.stack = err.stack;
  res.status(statusCode).json(payload);
};
