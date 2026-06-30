import http from 'http';
import { app } from './app.js';
import { connectDb, stopDb } from './config/db.js';
import { env } from './config/env.js';
import { startInMemoryQueue } from './queues/pdfBatchQueue.js';
import { initRealtime } from './realtime/socket.js';
import { startStorageCleanup } from './services/storage/storageCleanupService.js';

await connectDb();
const httpServer = http.createServer(app);
await initRealtime(httpServer);
startInMemoryQueue();
startStorageCleanup();

httpServer.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${env.port} is already in use.`);
    console.error(`Stop the existing backend process or set PORT to another value in backend/.env.`);
    console.error(`On Windows, run: netstat -ano | findstr :${env.port}`);
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});

httpServer.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`);
});

const shutdown = async (signal) => {
  console.log(`${signal} received. Closing HTTP server...`);
  httpServer.close(async () => {
    await stopDb().catch((error) => console.error(error));
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
