import { connectDb } from '../config/db.js';
import { startInMemoryQueue } from '../queues/pdfBatchQueue.js';

await connectDb();
startInMemoryQueue();

console.log('MongoDB-backed in-memory PDF queue worker is running');
