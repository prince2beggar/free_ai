import { mkdir, writeFile, readFile, unlink, rm } from 'node:fs/promises';
import { join, resolve, normalize } from 'node:path';

function validateId(id, name = 'id') {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(id)) {
    throw new Error(`Invalid ${name}: must be alphanumeric or dash/underscore`);
  }
}

/**
 * Resolve and verify that a file path remains strictly inside the user's isolated directory.
 */
export function getIsolatedUserDir(storageBaseDir, userId) {
  validateId(userId, 'userId');
  const baseResolved = resolve(storageBaseDir);
  const userDir = resolve(join(baseResolved, 'users', userId));

  // Security guard: path must start with baseResolved
  if (!userDir.startsWith(baseResolved)) {
    throw new Error('Path traversal detected outside base storage directory');
  }

  return userDir;
}

/**
 * Save file buffer to isolated user directory on disk.
 */
export async function saveFileToStorage({
  storageBaseDir,
  userId,
  fileId,
  sanitizedFilename,
  buffer,
}) {
  validateId(userId, 'userId');
  validateId(fileId, 'fileId');

  const userDir = getIsolatedUserDir(storageBaseDir, userId);
  await mkdir(userDir, { recursive: true });

  const safeStorageFilename = `${fileId}_${sanitizedFilename}`;
  const fullPath = resolve(join(userDir, safeStorageFilename));

  if (!fullPath.startsWith(userDir)) {
    throw new Error('Path traversal attempt blocked in file storage');
  }

  await writeFile(fullPath, buffer);

  // Return normalized relative storage path
  const relativePath = normalize(join('users', userId, safeStorageFilename));
  return {
    fullPath,
    relativePath,
  };
}

/**
 * Read file buffer from isolated user storage.
 */
export async function readFileFromStorage({ storageBaseDir, userId, relativePath }) {
  validateId(userId, 'userId');

  const baseResolved = resolve(storageBaseDir);
  const fullPath = resolve(join(baseResolved, relativePath));
  const userDir = getIsolatedUserDir(storageBaseDir, userId);

  // IDOR / isolation guard: file must be strictly within this user's directory
  if (!fullPath.startsWith(userDir)) {
    const err = new Error('Access denied: file does not belong to authorized user');
    err.code = 'IDOR_ACCESS_DENIED';
    throw err;
  }

  return readFile(fullPath);
}

/**
 * Delete file buffer from isolated user storage.
 */
export async function deleteFileFromStorage({ storageBaseDir, userId, relativePath }) {
  validateId(userId, 'userId');

  const baseResolved = resolve(storageBaseDir);
  const fullPath = resolve(join(baseResolved, relativePath));
  const userDir = getIsolatedUserDir(storageBaseDir, userId);

  if (!fullPath.startsWith(userDir)) {
    const err = new Error('Access denied: file does not belong to authorized user');
    err.code = 'IDOR_ACCESS_DENIED';
    throw err;
  }

  try {
    await unlink(fullPath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Remove entire user directory (e.g. on account deletion or test teardown).
 */
export async function purgeUserStorage({ storageBaseDir, userId }) {
  validateId(userId, 'userId');
  const userDir = getIsolatedUserDir(storageBaseDir, userId);
  try {
    await rm(userDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
