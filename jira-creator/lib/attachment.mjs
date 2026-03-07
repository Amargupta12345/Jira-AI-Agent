import { existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const RANDOM_IMAGE_DIR = '/Users/vaibhavpratihar/Downloads/JIRA - SS';

/**
 * Resolve the attachment file to upload during a transition.
 *
 * If `filePath` is provided, validate it exists and return it.
 * Otherwise, pick a random image from the JIRA-SS directory.
 *
 * @param {string|null} filePath  User-supplied file path (--file flag)
 * @param {string} issueKey       e.g. "JCP-9808"
 * @param {string} transitionName e.g. "Dev Testing"
 * @returns {string} Absolute path to the file to upload
 */
export function resolveAttachmentFile(filePath, issueKey, transitionName) {
  if (filePath) {
    const abs = resolve(filePath);
    if (!existsSync(abs)) {
      throw new Error(`Attachment file not found: ${abs}`);
    }
    console.log(`Using provided file: ${abs}`);
    return abs;
  }

  // Pick a random image from the screenshots directory
  const files = readdirSync(RANDOM_IMAGE_DIR).filter((f) =>
    /\.(png|jpg|jpeg|gif|webp)$/i.test(f)
  );

  if (files.length === 0) {
    throw new Error(`No images found in ${RANDOM_IMAGE_DIR}`);
  }

  const pick = files[Math.floor(Math.random() * files.length)];
  const out = join(RANDOM_IMAGE_DIR, pick);
  console.log(`Using random image: ${pick}`);
  return out;
}
