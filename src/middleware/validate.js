import { AppError } from '../utils/AppError.js';

export const validate = (schema, source = 'body') => (req, _res, next) => {
  const { error, value } = schema.validate(req[source], {
    abortEarly: false,
    stripUnknown: true
  });
  if (error) {
    throw new AppError(
      error.details.map((detail) => detail.message).join(', '),
      400,
      'validation_error'
    );
  }
  req[source] = value;
  next();
};
