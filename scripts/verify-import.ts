/**
 * Compares the database with data/catalog_import.json after seeding.
 *
 *   npx tsx scripts/verify-import.ts --emulator --project demo-wider
 *   npx tsx scripts/verify-import.ts --project <id>
 *
 * Checks every cleaned record exists in `products` and `productSources`, that model
 * numbers, names and brands match exactly, that each record with a source image has an
 * image URL, that no public product carries a source price field, and that SKUs are unique.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFirestore } from 'firebase-admin/firestore';
import { initAdmin } from './admin-init';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  initAdmin();
  const db = getFirestore();
  const data = JSON.parse(readFileSync(path.join(root, 'data', 'catalog_import.json'), 'utf8')).products as {
    id: string; model: string; name: string; brand: string; imageFile: string | null; source: { price: number };
  }[];
  const products = new Map((await db.collection('products').get()).docs.map((d) => [d.id, d.data()]));
  const sources = new Map((await db.collection('productSources').get()).docs.map((d) => [d.id, d.data()]));

  const problems: string[] = [];
  for (const r of data) {
    const p = products.get(r.id);
    const s = sources.get(r.id);
    if (!p) { problems.push(`${r.id}: missing in products`); continue; }
    if (!s) problems.push(`${r.id}: missing in productSources`);
    if (p.model !== r.model) problems.push(`${r.id}: model "${p.model}" != "${r.model}"`);
    if (p.name !== r.name) problems.push(`${r.id}: name differs`);
    if (p.brand !== r.brand) problems.push(`${r.id}: brand differs`);
    if (r.imageFile && !p.imageUrl) problems.push(`${r.id}: image missing`);
    if (s && s.price !== r.source.price) problems.push(`${r.id}: source price ${s.price} != ${r.source.price}`);
  }
  const leaked = [...products.entries()].filter(([, p]) => Object.keys(p).some((k) => /source(price|currency)|^source$/i.test(k)));
  leaked.forEach(([id]) => problems.push(`${id}: public product contains source pricing fields`));
  const skus = new Map<string, string[]>();
  products.forEach((p, id) => skus.set(String(p.sku).toUpperCase(), [...(skus.get(String(p.sku).toUpperCase()) ?? []), id]));
  [...skus.entries()].filter(([, ids]) => ids.length > 1).forEach(([sku, ids]) => problems.push(`duplicate SKU ${sku}: ${ids.join(', ')}`));

  const extra = [...products.keys()].filter((id) => !data.some((r) => r.id === id));
  console.log(`dataset records: ${data.length}`);
  console.log(`products in database: ${products.size} (${extra.length} not from the dataset, e.g. added by administrators)`);
  console.log(`productSources in database: ${sources.size}`);
  console.log(`published: ${[...products.values()].filter((p) => p.status === 'published').length}, with image: ${[...products.values()].filter((p) => p.imageUrl).length}`);
  console.log(problems.length ? `PROBLEMS (${problems.length}):\n${problems.slice(0, 50).join('\n')}` : 'OK: database matches the cleaned dataset');
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
