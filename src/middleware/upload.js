import multer from 'multer';
import os from 'os';
import path from 'path';
import { limits } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const upload = multer({
  dest: path.join(os.tmpdir(), 'pdf-tool-uploads'),
  limits: {
    fileSize: limits.maxPdfBytes,
    files: limits.maxPdfsPerBatch
  },
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    cb(isPdf ? null : new AppError('Only PDF files are allowed', 400, 'invalid_file_type'), isPdf);
  }
});

export const uploadPdfs = upload.array('files', limits.maxPdfsPerBatch);
