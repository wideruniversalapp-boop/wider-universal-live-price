/**
 * Restores `products` and `productSources` documents from a backup made by
 * scripts/backup-products.ts. Only documents present in the backup are rewritten;
 * documents created after the backup are left untouched (listed in the output).
 *
 *   npx tsx scripts/restore-products.ts --emulator --project demo-wider --file backups/<file>.json [--dry-run]
 */
import { readFileSync } from 'node:fs';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { arg, flag, initAdmin } from './admin-init';

function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.__ts === 'number' && Object.keys(o).length === 1) return Timestamp.fromMillis(o.__ts);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

async function main() {
  initAdmin();
  const file = arg('file');
  if (!file) throw new Error('Pass --file <backup.json>');
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  const db = getFirestore();
  for (const c of ['products', 'productSources']) {
    const docs = Object.entries(backup.collections[c] as Record<string, unknown>);
    const current = new Set((await db.collection(c).select().get()).docs.map((d) => d.id));
    const newer = [...current].filter((id) => !(backup.collections[c] as Record<string, unknown>)[id]);
    console.log(`${c}: restoring ${docs.length}; ${newer.length} newer documents left as-is`);
    if (flag('dry-run')) continue;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      docs.slice(i, i + 400).forEach(([id, data]) => batch.set(db.doc(`${c}/${id}`), decode(data) as FirebaseFirestore.DocumentData));
      await batch.commit();
    }
  }
  console.log(flag('dry-run') ? 'dry run complete' : 'restore complete');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
