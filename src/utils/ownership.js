import { AppError } from './AppError.js';

export const assertOwned = (doc, userId, resource = 'resource') => {
  if (!doc || String(doc.userId) !== String(userId)) {
    throw new AppError(`${resource} not found`, 404, 'not_found');
  }
};
