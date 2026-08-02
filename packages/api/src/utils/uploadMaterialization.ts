import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { uploadsDir } from '../env';

/**
 * Persist bytes before metadata while ensuring a failed metadata transaction
 * does not leave an untracked file on disk. Cleanup failure is rethrown with
 * the original persistence error so callers never report the failed upload as
 * successful.
 */
export async function materializeUploadFile<T>(
  filename: string,
  content: Uint8Array,
  persist: () => Promise<T>,
  directory = uploadsDir,
): Promise<T> {
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, filename);
  await writeFile(filePath, content);
  try {
    return await persist();
  } catch (error) {
    try {
      await unlink(filePath);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Upload failed and file cleanup was unsuccessful',
      );
    }
    throw error;
  }
}
