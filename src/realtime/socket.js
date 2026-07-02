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
import { setIoInstance, getIoInstance } from './socketInstance.js';

// Track active user connections
const activeUsers = new Map(); // userId -> Set of socket IDs

export const getActiveUsers = () => activeUsers;

export const initRealtime = async (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  setIoInstance(io);

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
      socket.userRole = payload.role;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    console.log('[Socket] New client connected:', { userId: socket.userId, role: socket.userRole });
    
    // Add user to active users
    if (socket.userId) {
      if (!activeUsers.has(socket.userId)) {
        activeUsers.set(socket.userId, new Set());
        console.log('[Socket] User came online:', socket.userId);
        // User just came online
        io.to('audit-logs').emit('user:status-change', {
          userId: socket.userId,
          isOnline: true
        });
      }
      activeUsers.get(socket.userId).add(socket.id);
      console.log('[Socket] Active users:', Array.from(activeUsers.keys()));
    }

    socket.on('batch:join', async ({ batchId }) => {
      console.log('[Socket] batch:join event received:', { batchId, userId: socket.userId });
      const batch = await PdfBatch.findById(batchId).select('userId');
      if (!batch || String(batch.userId) !== String(socket.userId)) return;
      socket.join(`batch:${batchId}`);
      await emitBatchStatus(batchId, socket);
    });

    socket.on('batch:leave', ({ batchId }) => {
      console.log('[Socket] batch:leave event received:', { batchId, userId: socket.userId });
      socket.leave(`batch:${batchId}`);
    });

    // Let admins join audit logs room
    if (socket.userRole === 'admin') {
      socket.join('audit-logs');
      console.log('[Socket] Admin joined audit-logs room:', socket.userId);
    }

    // Send current active users to new admin
    if (socket.userRole === 'admin') {
      const onlineUsers = Array.from(activeUsers.keys());
      socket.emit('users:initial-status', onlineUsers);
      console.log('[Socket] Sent initial online users to admin:', onlineUsers);
    }

    socket.on('disconnect', () => {
      console.log('[Socket] Client disconnected:', { userId: socket.userId, role: socket.userRole });
      if (socket.userId) {
        const userSockets = activeUsers.get(socket.userId);
        if (userSockets) {
          userSockets.delete(socket.id);
          if (userSockets.size === 0) {
            activeUsers.delete(socket.userId);
            console.log('[Socket] User went offline:', socket.userId);
            // User went offline
            io.to('audit-logs').emit('user:status-change', {
              userId: socket.userId,
              isOnline: false
            });
          }
        }
      }
      console.log('[Socket] Active users after disconnect:', Array.from(activeUsers.keys()));
    });
  });

  return io;
};

export const emitBatchStatus = async (batchId, target = getIoInstance()) => {
  if (!target) return;
  const payload = await buildBatchStatusPayload(batchId);
  if (!payload) return;
  const [files, results] = await Promise.all([
    PdfFile.find({ batchId }).sort({ createdAt: 1 }).lean(),
    ReplacementResult.find({ batchId }).sort({ createdAt: 1 }).lean()
  ]);
  const eventPayload = { ...payload, files, results };
  if (target === getIoInstance()) target.to(`batch:${batchId}`).emit('batch:status', eventPayload);
  else target.emit('batch:status', eventPayload);
};

export const emitAuditLog = async (log) => {
  const io = getIoInstance();
  if (!io) {
    console.log('[Socket] emitAuditLog failed: io instance not available');
    return;
  }
  console.log('[Socket] Emitting audit log to audit-logs room:', { logId: log._id, action: log.action });
  // Populate user info
  const populatedLog = await log.populate('userId', 'name email');
  const batch = await PdfBatch.findById(log.batchId);
  const file = await PdfFile.findById(log.fileId);
  const isUserOnline = activeUsers.has(log.userId.toString());
  const eventPayload = {
    ...populatedLog.toObject(),
    batch,
    file,
    isUserOnline
  };
  io.to('audit-logs').emit('audit-log:new', eventPayload);
  console.log('[Socket] Audit log emitted successfully');
};

