import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getAllAuditLogs, getUserAuditLogs } from '../controllers/auditLogController.js';

const router = express.Router();

router.get('/', requireAuth, requireAdmin, getAllAuditLogs);
router.get('/user/:userId', requireAuth, requireAdmin, getUserAuditLogs);

export default router;
