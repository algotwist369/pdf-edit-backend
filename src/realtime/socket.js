import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/mongo-adapter';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { isAllowedOrigin } from '../config/cors.js';
import { PdfBatch } from '../models/PdfBatch.js';
import { PdfFile } from '../models/PdfFile.js';
import { ReplacementResult } from '../models/ReplacementResult.js';
import { buildBatchStatusPayload } from '../services/batchStatusService.js';

let io;

export const initRealtime = async (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  if (env.socketIoAdapter === 'mongo') {
    const collection = mongoose.connection.db.collection('socket_io_events');
    await collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 }).catch(() => {});
    io.adapter(createAdapter(collection, { addCreatedAtField: true }));
  }

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) throw new Error('Missing token');
      const payload = jwt.verify(token, env.jwtSecret);
      socket.userId = payload.sub;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('batch:join', async ({ batchId }) => {
      const batch = await PdfBatch.findById(batchId).select('userId');
      if (!batch || String(batch.userId) !== String(socket.userId)) return;
      socket.join(`batch:${batchId}`);
      await emitBatchStatus(batchId, socket);
    });

    socket.on('batch:leave', ({ batchId }) => {
      socket.leave(`batch:${batchId}`);
    });
  });

  return io;
};

export const emitBatchStatus = async (batchId, target = io) => {
  if (!target) return;
  const payload = await buildBatchStatusPayload(batchId);
  if (!payload) return;
  const [files, results] = await Promise.all([
    PdfFile.find({ batchId }).sort({ createdAt: 1 }).lean(),
    ReplacementResult.find({ batchId }).sort({ createdAt: 1 }).lean()
  ]);
  const eventPayload = { ...payload, files, results };
  if (target === io) target.to(`batch:${batchId}`).emit('batch:status', eventPayload);
  else target.emit('batch:status', eventPayload);
};

