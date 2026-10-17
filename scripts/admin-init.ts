/**
 * Shared Admin SDK initialisation for CLI scripts.
 *
 *   --emulator           use the local emulators (no credentials needed)
 *   --project <id>       Firebase project ID
 *   --bucket <name>      Storage bucket (defaults to <project>.appspot.com in emulator mode)
 *
 * Production credentials come from GOOGLE_APPLICATION_CREDENTIALS (path to a service
 * account key kept OUTSIDE the repository) or from `gcloud auth application-default login`.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app';

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
export const flag = (name: string) => process.argv.includes(`--${name}`);

export function initAdmin() {
  const emulator = flag('emulator');
  const projectId = arg('project') ?? process.env.GCLOUD_PROJECT;
  if (!projectId) throw new Error('Pass --project <id>');
  const bucket = arg('bucket') ?? (emulator ? `${projectId}.appspot.com` : undefined);
  if (emulator) {
    process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= '127.0.0.1:9199';
    initializeApp({ projectId, storageBucket: bucket });
  } else {
    initializeApp({ credential: applicationDefault(), projectId, storageBucket: bucket });
  }
  return { emulator, projectId, bucket };
}
