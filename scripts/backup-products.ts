/**
 * Exports products, productSources and settings to a timestamped JSON file before any
 * bulk change. Restore with scripts/restore-products.ts.
 *
 *   npx tsx scripts/backup-products.ts --emulator --project demo-wider
 *   npx tsx scripts/backup-products.ts --project <id>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initAdmin } from './admin-init';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Timestamps are written as {"__ts": millis} so restore can recreate them exactly. */
function encode(v: unknown): unknown {
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}

async function main() {
  const { projectId, emulator } = initAdmin();
  const db = getFirestore();
  const out: Record<string, Record<string, unknown>> = {};
  for (const c of ['products', 'productSources', 'settings', 'brands', 'categories']) {
    const snap = await db.collection(c).get();
    out[c] = Object.fromEntries(snap.docs.map((d) => [d.id, encode(d.data())]));
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(root, 'backups');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `firestore-${emulator ? 'emulator' : projectId}-${stamp}.json`);
  writeFileSync(file, JSON.stringify({ projectId, emulator, createdAt: new Date().toISOString(), collections: out }));
  console.log(`backup written: ${path.relative(root, file)} (products ${Object.keys(out.products).length}, sources ${Object.keys(out.productSources).length})`);
  console.log(file);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
