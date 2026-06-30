import fs from 'fs/promises';
import path from 'path';
import sanitize from 'sanitize-filename';
import { nanoid } from 'nanoid';
import { env } from '../../config/env.js';

const root = path.resolve(env.localStorageRoot);

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

export const storage = {
  async putUploadedFile(file, folder, preferredName) {
    const safeName = sanitize(preferredName || file.originalname || `${nanoid()}.pdf`);
    const key = path.join(folder, `${nanoid()}-${safeName}`);
    const destination = path.join(root, key);
    await ensureDir(path.dirname(destination));
    await fs.copyFile(file.path, destination);
    await fs.unlink(file.path).catch(() => {});
    return { key, absolutePath: destination, safeName };
  },

  async putBuffer(buffer, folder, preferredName) {
    const safeName = sanitize(preferredName);
    const key = path.join(folder, `${nanoid()}-${safeName}`);
    const destination = path.join(root, key);
    await ensureDir(path.dirname(destination));
    await fs.writeFile(destination, buffer);
    return { key, absolutePath: destination, safeName };
  },

  async resolvePath(key) {
    return path.join(root, key);
  },

  async deleteKey(key) {
    if (!key) return;
    await fs.unlink(path.join(root, key)).catch(() => {});
  }
};
