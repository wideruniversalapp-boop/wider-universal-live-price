import { deleteDoc, doc, setDoc, writeBatch } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../../firebase';
import { slugId } from '../../lib/format';
import { commitProductWrites, fetchBrands, fetchCategories, productToInput } from '../../lib/products';
import type { Brand, Category } from '../../types';
import { useAdminData } from './AdminLayout';
import BrandSpotlightEditor from './BrandSpotlightEditor';

type Kind = 'brands' | 'categories';

export default function Taxonomy() {
  const { products } = useAdminData();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    fetchBrands().then(setBrands).catch((e) => setMessage(e.message));
    fetchCategories().then(setCategories).catch((e) => setMessage(e.message));
  };
  useEffect(reload, []);

  const counts = useMemo(() => {
    const b = new Map<string, number>();
    const c = new Map<string, number>();
    products.forEach((p) => {
      b.set(p.brand, (b.get(p.brand) ?? 0) + 1);
      c.set(p.category, (c.get(p.category) ?? 0) + 1);
    });
    return { brands: b, categories: c };
  }, [products]);

  const sync = async () => {
    setBusy(true);
    try {
      const batch = writeBatch(db);
      let n = 0;
      const have = { brands: new Set(brands.map((b) => b.name)), categories: new Set(categories.map((c) => c.name)) };
      (['brands', 'categories'] as Kind[]).forEach((kind) => {
        const names = [...counts[kind].keys()].filter((x) => x && !have[kind].has(x)).sort();
        const start = (kind === 'brands' ? brands : categories).length;
        names.forEach((name, i) => {
          batch.set(doc(db, kind, slugId(name)), { name, order: start + i });
          n++;
        });
      });
      if (n) await batch.commit();
      setMessage(n ? `Added ${n} missing entries.` : 'Already in sync with products.');
      reload();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = async (kind: Kind) => {
    const name = prompt(`New ${kind === 'brands' ? 'brand' : 'category'} name`)?.trim();
    if (!name) return;
    const list = kind === 'brands' ? brands : categories;
    await setDoc(doc(db, kind, slugId(name)), { name, order: list.length });
    reload();
  };

  const rename = async (kind: Kind, item: Brand | Category) => {
    const name = prompt('New name', item.name)?.trim();
    if (!name || name === item.name) return;
    const field = kind === 'brands' ? 'brand' : 'category';
    const affected = products.filter((p) => p[field] === item.name);
    if (!confirm(`Rename "${item.name}" to "${name}" and update ${affected.length} product(s)?`)) return;
    setBusy(true);
    try {
      await commitProductWrites(affected.map((p) => ({ id: p.id, before: p, after: { ...productToInput(p), [field]: name } })), 'bulk');
      // merge: keeps brand spotlight fields (headline, subtitle, banner)
      await setDoc(doc(db, kind, item.id), { name, order: item.order }, { merge: true });
      setMessage(`Renamed; ${affected.length} product(s) updated.`);
      reload();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const move = async (kind: Kind, list: (Brand | Category)[], i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const batch = writeBatch(db);
    batch.update(doc(db, kind, list[i].id), { order: j });
    batch.update(doc(db, kind, list[j].id), { order: i });
    await batch.commit();
    reload();
  };

  const remove = async (kind: Kind, item: Brand | Category) => {
    const n = counts[kind].get(item.name) ?? 0;
    if (n) return setMessage(`"${item.name}" is used by ${n} product(s). Reassign them first.`);
    if (!confirm(`Delete "${item.name}"?`)) return;
    await deleteDoc(doc(db, kind, item.id));
    reload();
  };

  const section = (kind: Kind, list: (Brand | Category)[]) => (
    <section className="panel">
      <div className="page-head">
        <h2>{kind === 'brands' ? 'Brands' : 'Categories'}</h2>
        <button className="btn btn-sm" onClick={() => add(kind)}>Add</button>
      </div>
      <table className="data-table compact">
        <thead><tr><th>Order</th><th>Name</th><th className="num">Products</th><th /></tr></thead>
        <tbody>
          {list.map((item, i) => (
            <tr key={item.id}>
              <td>
                <button className="btn btn-xs" onClick={() => move(kind, list, i, -1)} aria-label="Move up">↑</button>
                <button className="btn btn-xs" onClick={() => move(kind, list, i, 1)} aria-label="Move down">↓</button>
              </td>
              <td>{item.name}</td>
              <td className="num">{counts[kind].get(item.name) ?? 0}</td>
              <td>
                <button className="btn btn-xs" disabled={busy} onClick={() => rename(kind, item)}>Rename</button>
                <button className="btn btn-xs" disabled={busy} onClick={() => remove(kind, item)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );

  return (
    <div>
      <div className="page-head">
        <h1>Brands &amp; categories</h1>
        <button className="btn" disabled={busy} onClick={sync}>Add entries used by products</button>
      </div>
      {message && <div className="alert">{message}</div>}
      <div className="two-col">
        {section('brands', brands)}
        {section('categories', categories)}
      </div>
      {brands.length > 0 && <BrandSpotlightEditor brands={brands} onSaved={reload} />}
    </div>
  );
}
