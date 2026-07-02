import { AuditLog } from '../models/AuditLog.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getActiveUsers } from '../realtime/socket.js';

export const getAllAuditLogs = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const skip = (page - 1) * limit;

  const logs = await AuditLog.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('userId', 'name email')
    .populate('batchId', 'name')
    .populate('fileId', 'originalName');

  const activeUsers = getActiveUsers();
  const logsWithStatus = logs.map(log => ({
    ...log.toObject(),
    isUserOnline: activeUsers.has(log.userId?._id.toString())
  }));

  const total = await AuditLog.countDocuments();

  res.json({
    logs: logsWithStatus,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    },
    onlineUsers: Array.from(activeUsers.keys())
  });
});

export const getUserAuditLogs = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const skip = (page - 1) * limit;

  const logs = await AuditLog.find({ userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('userId', 'name email')
    .populate('batchId', 'name')
    .populate('fileId', 'originalName');

  const activeUsers = getActiveUsers();
  const logsWithStatus = logs.map(log => ({
    ...log.toObject(),
    isUserOnline: activeUsers.has(log.userId?._id.toString())
  }));

  const total = await AuditLog.countDocuments({ userId });

  res.json({
    logs: logsWithStatus,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
});
