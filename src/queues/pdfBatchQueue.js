import pLimit from 'p-limit';
import { env } from '../config/env.js';
import { PdfBatch } from '../models/PdfBatch.js';
import { ProcessingJob } from '../models/ProcessingJob.js';
import { processPdfBatch } from '../services/pdfBatchProcessingService.js';

const limit = pLimit(env.inMemoryQueueConcurrency);
const activeJobs = new Set();
let draining = false;

const recoverStaleJobs = async () => {
  const staleBefore = new Date(Date.now() - env.jobLockTimeoutMinutes * 60 * 1000);
  await ProcessingJob.updateMany(
    {
      status: 'processing',
      lockedAt: { $lt: staleBefore },
      attempts: { $lt: 3 }
    },
    {
      status: 'queued',
      failureReason: 'Recovered stale processing lock'
    }
  );
};

const runJob = async (jobId) => {
  if (activeJobs.has(String(jobId))) return;
  activeJobs.add(String(jobId));

  try {
    const job = await ProcessingJob.findOneAndUpdate(
      { _id: jobId, status: { $in: ['queued', 'failed'] }, attempts: { $lt: 3 } },
      {
        status: 'processing',
        $inc: { attempts: 1 },
        lockedAt: new Date(),
        startedAt: new Date(),
        failureReason: undefined
      },
      { new: true }
    );
    if (!job) return;

    await processPdfBatch(job.batchId);
    const batch = await PdfBatch.findById(job.batchId).select('status');
    if (batch?.status === 'paused') {
      await ProcessingJob.findByIdAndUpdate(job._id, {
        status: 'paused',
        failureReason: 'Paused by user'
      });
      return;
    }
    if (batch?.status === 'cancelled') {
      await ProcessingJob.findByIdAndUpdate(job._id, {
        status: 'cancelled',
        completedAt: new Date(),
        failureReason: 'Cancelled by user'
      });
      return;
    }
    await ProcessingJob.findByIdAndUpdate(job._id, {
      status: 'completed',
      completedAt: new Date()
    });
  } catch (error) {
    const job = await ProcessingJob.findById(jobId);
    if (error.status === 'paused') {
      await ProcessingJob.findByIdAndUpdate(jobId, {
        status: 'paused',
        failureReason: 'Paused by user'
      });
      return;
    }
    if (error.status === 'cancelled') {
      await ProcessingJob.findByIdAndUpdate(jobId, {
        status: 'cancelled',
        failedAt: new Date(),
        failureReason: 'Cancelled by user'
      });
      return;
    }
    const canRetry = job && job.attempts < job.maxAttempts;
    await ProcessingJob.findByIdAndUpdate(jobId, {
      status: canRetry ? 'queued' : 'failed',
      failedAt: canRetry ? undefined : new Date(),
      failureReason: error.message
    });

    if (!canRetry && job?.batchId) {
      await PdfBatch.findByIdAndUpdate(job.batchId, {
        status: 'failed',
        failureReason: error.message,
        completedAt: new Date()
      });
    }
  } finally {
    activeJobs.delete(String(jobId));
    setImmediate(() => drainQueuedJobs().catch(() => {}));
  }
};

export const drainQueuedJobs = async () => {
  if (draining) return;
  draining = true;
  try {
    const availableSlots = Math.max(env.inMemoryQueueConcurrency - activeJobs.size, 0);
    if (!availableSlots) return;
    await recoverStaleJobs();

    const jobs = await ProcessingJob.find({ status: 'queued' })
      .sort({ createdAt: 1 })
      .limit(availableSlots)
      .select('_id');

    for (const job of jobs) {
      limit(() => runJob(job._id)).catch(() => {});
    }
  } finally {
    draining = false;
  }
};

export const enqueuePdfBatch = async (batchId) => {
  const job = await ProcessingJob.findOneAndUpdate(
    { batchId, type: 'process_pdf_batch' },
    {
      batchId,
      type: 'process_pdf_batch',
      status: 'queued',
      failureReason: undefined
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  setImmediate(() => drainQueuedJobs().catch(() => {}));
  return job;
};

export const pausePdfBatch = async (batchId) => {
  await PdfBatch.findByIdAndUpdate(batchId, { status: 'paused' });
  await ProcessingJob.findOneAndUpdate(
    { batchId, type: 'process_pdf_batch', status: { $in: ['queued', 'processing'] } },
    { status: 'paused', failureReason: 'Paused by user' }
  );
};

export const resumePdfBatch = async (batchId) => {
  await PdfBatch.findByIdAndUpdate(batchId, {
    status: 'queued',
    completedAt: undefined,
    failureReason: undefined
  });
  await ProcessingJob.findOneAndUpdate(
    { batchId, type: 'process_pdf_batch' },
    { batchId, type: 'process_pdf_batch', status: 'queued', failureReason: undefined },
    { upsert: true, setDefaultsOnInsert: true }
  );
  setImmediate(() => drainQueuedJobs().catch(() => {}));
};

export const cancelPdfBatch = async (batchId) => {
  const now = new Date();
  await PdfBatch.findByIdAndUpdate(batchId, {
    status: 'cancelled',
    completedAt: now,
    failureReason: 'Cancelled by user'
  });
  await ProcessingJob.findOneAndUpdate(
    { batchId, type: 'process_pdf_batch' },
    { status: 'cancelled', failedAt: now, failureReason: 'Cancelled by user' }
  );
};

export const startInMemoryQueue = () => {
  setInterval(() => drainQueuedJobs().catch(() => {}), 5000).unref();
  setImmediate(() => drainQueuedJobs().catch(() => {}));
};
