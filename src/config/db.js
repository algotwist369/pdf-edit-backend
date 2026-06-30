import mongoose from 'mongoose';
import { env } from './env.js';

let memoryMongoServer;

export const connectDb = async () => {
  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: env.mongoMaxPoolSize,
      minPoolSize: env.mongoMinPoolSize
    });
    console.log(`MongoDB connected: ${env.mongoUri}`);
  } catch (error) {
    const canUseMemoryFallback = env.nodeEnv !== 'production' && env.mongoMemoryFallback;
    if (!canUseMemoryFallback) {
      console.error(`MongoDB connection failed: ${error.message}`);
      console.error('Start MongoDB, update MONGO_URI, or set MONGO_MEMORY_FALLBACK=true for local development.');
      throw error;
    }

    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryMongoServer = await MongoMemoryServer.create();
    const uri = memoryMongoServer.getUri('pdf_replacement_tool');
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: env.mongoMaxPoolSize,
      minPoolSize: 0
    });
    console.warn(`MongoDB unavailable at ${env.mongoUri}; using in-memory MongoDB for development.`);
  }
};

export const stopDb = async () => {
  await mongoose.disconnect();
  await memoryMongoServer?.stop();
};
