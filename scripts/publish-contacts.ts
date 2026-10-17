/**
 * Publishes the initial branch contact directory from data/contacts.initial.json.
 * Afterwards contacts are maintained in Admin → Contacts.
 *
 *   npx tsx scripts/publish-contacts.ts --emulator --project demo-wider
 *   npx tsx scripts/publish-contacts.ts --project <id> [--force]
 *
 * Refuses to overwrite an existing directory (which may contain admin edits) unless --force.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { normalizeDirectory, validateDirectory } from '../src/lib/contacts';
import { arg, flag, initAdmin } from './admin-init';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  initAdmin();
  const file = arg('file') ?? path.join(root, 'data', 'contacts.initial.json');
  const directory = normalizeDirectory(JSON.parse(readFileSync(file, 'utf8')));
  const errors = validateDirectory(directory);
  if (Object.keys(errors).length) throw new Error(`Invalid contacts file: ${JSON.stringify(errors)}`);
  const db = getFirestore();
  const ref = db.doc('contactDirectory/published');
  const current = await ref.get();
  if (current.exists && !flag('force')) {
    console.log('contactDirectory/published already exists — not changed (use --force to overwrite).');
    return;
  }
  const config = { ...directory, version: (current.exists ? (current.data()!.version as number) : 0) + 1 };
  const hist = db.collection('settingsHistory').doc();
  const batch = db.batch();
  batch.set(hist, {
    by: 'setup-script',
    byEmail: 'setup script',
    at: FieldValue.serverTimestamp(),
    changed: ['contacts (initial)'],
    before: current.exists ? { contactDirectory: current.data() } : null,
    after: { contactDirectory: config },
    note: `Published from ${path.basename(file)}`,
  });
  batch.set(ref, { ...config, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'setup-script', updatedByEmail: 'setup script', lastChangeId: hist.id });
  await batch.commit();
  console.log(`published ${config.branches.length} branches, ${config.branches.reduce((n, b) => n + b.contacts.length, 0)} contacts`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
