import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { uniqueSorted } from '../../lib/catalogFilter';
import { activeOffer, formatSar, productPriceDrop, STOCK_LABELS } from '../../lib/format';
import { productToRow, TEMPLATE_COLUMNS } from '../../lib/importer';
import { commitProductWrites, fetchAllSources, productToInput } from '../../lib/products';
import type { Product, ProductStatus, StockStatus } from '../../types';
import { useAdminData } from './AdminLayout';
import { missingInfo } from './missing';

const PAGE = 100;

export default function ProductList() {
  const { products, loading } = useAdminData();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const brand = params.get('brand') ?? '';
  const category = params.get('category') ?? '';
  const stock = params.get('stock') ?? '';
  const flag = params.get('flag') ?? '';

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
    setPage(0);
  };

  const filtered = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return products
      .filter((p) => (status ? p.status === status : true))
      .filter((p) => (brand ? p.brand === brand : true))
      .filter((p) => (category ? p.category === category : true))
      .filter((p) => (stock ? p.stockStatus === stock : true))
      .filter((p) => {
        if (flag === 'offer') return activeOffer(p);
        if (flag === 'price-drop') return !!productPriceDrop(p);
        if (flag === 'no-price') return p.price == null;
        if (flag === 'missing') return missingInfo(p).length > 0;
        if (flag === 'no-image') return !p.imageUrl;
        if (flag === 'no-specs') return p.specs.length === 0;
        return true;
      })
      .filter((p) => terms.every((t) => (p.searchText || `${p.name} ${p.model} ${p.sku}`.toLowerCase()).includes(t)))
      .sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
  }, [products, q, status, brand, category, stock, flag]);

  const brands = useMemo(() => uniqueSorted(products.map((p) => p.brand)), [products]);
  const categories = useMemo(() => uniqueSorted(products.filter((p) => !brand || p.brand === brand).map((p) => p.category)), [products, brand]);
  const pageRows = filtered.slice(page * PAGE, (page + 1) * PAGE);
  const selectedProducts = products.filter((p) => selected.has(p.id));
  const target = selectedProducts.length ? selectedProducts : null;

  const toggle = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  };

  const run = async (label: string, mutate: (p: Product) => Product | null) => {
    if (!target) return;
    const writes = target
      .map((p) => {
        const next = mutate(p);
        return next ? { id: p.id, before: p, after: productToInput(next) } : null;
      })
      .filter((w): w is NonNullable<typeof w> => w !== null);
    if (!writes.length) return setMessage('Nothing to change for the selected products.');
    if (!confirm(`${label} for ${writes.length} product(s)?`)) return;
    setBusy(label);
    setMessage(null);
    try {
      await commitProductWrites(writes, 'bulk', null, (d, t) => setBusy(`${label}: ${d}/${t}`));
      setMessage(`${label}: ${writes.length} product(s) updated.`);
      setSelected(new Set());
    } catch (e) {
      setMessage(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (s: ProductStatus) => run(`Set status to ${s}`, (p) => (p.status === s ? null : { ...p, status: s }));
  const setStock = (s: StockStatus) => run(`Set stock to ${STOCK_LABELS[s]}`, (p) => (p.stockStatus === s ? null : { ...p, stockStatus: s }));
  const clearOffer = () => run('Clear offer', (p) => (p.offerPrice == null ? null : { ...p, offerPrice: null, offerStart: null, offerEnd: null, offerText: '' }));

  const priceFromSource = async () => {
    const raw = prompt(
      'Set the Wider Universal selling price from the stored reference price (PDF list price, or catalog source price when no PDF price exists).\n' +
        'Enter the adjustment in percent (e.g. 0 = same as source, 10 = +10%, -5 = -5%).\n' +
        'Products that already have a selling price are skipped.',
      '0',
    );
    if (raw == null) return;
    const pct = Number(raw);
    if (!Number.isFinite(pct)) return setMessage('Invalid percentage.');
    setBusy('Loading source prices');
    let sources;
    try {
      sources = await fetchAllSources();
    } catch (e) {
      setBusy(null);
      return setMessage(`Could not load source prices: ${(e as Error).message}`);
    }
    setBusy(null);
    await run(`Apply source price ${pct >= 0 ? '+' : ''}${pct}%`, (p) => {
      const s = sources.get(p.id);
      const src = s?.pdfListPrice ?? s?.price;
      if (p.price != null || src == null) return null;
      return { ...p, price: Math.round(src * (1 + pct / 100) * 100) / 100 };
    });
  };

  const exportSelection = async (format: 'xlsx' | 'csv') => {
    const { exportRows } = await import('../../lib/sheets');
    const list = target ?? filtered;
    exportRows(list.map(productToRow), [...TEMPLATE_COLUMNS], `wider-universal-products-${list.length}`, format);
  };

  if (loading) return <div className="page-state">Loading products…</div>;

  return (
    <div>
      <div className="page-head">
        <h1>Products</h1>
        <Link className="btn btn-primary" to="/admin/products/new">Add product</Link>
      </div>
      <div className="toolbar">
        <input type="search" className="search" placeholder="Search name, model, SKU…" value={q} onChange={(e) => set('q', e.target.value)} />
        <select value={status} onChange={(e) => set('status', e.target.value)}>
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
        <select value={brand} onChange={(e) => { set('brand', e.target.value); }}>
          <option value="">All brands</option>
          {brands.map((b) => <option key={b}>{b}</option>)}
        </select>
        <select value={category} onChange={(e) => set('category', e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={stock} onChange={(e) => set('stock', e.target.value)}>
          <option value="">Any stock</option>
          {Object.entries(STOCK_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={flag} onChange={(e) => set('flag', e.target.value)}>
          <option value="">No flag filter</option>
          <option value="offer">Active offer</option>
          <option value="price-drop">Price-drop tag showing</option>
          <option value="no-price">No selling price</option>
          <option value="missing">Missing important info</option>
          <option value="no-image">No image</option>
          <option value="no-specs">No specifications</option>
        </select>
      </div>

      <div className="bulk-bar">
        <span>{selected.size ? `${selected.size} selected` : `${filtered.length.toLocaleString()} shown`}</span>
        <button className="btn btn-sm" onClick={() => setSelected(new Set(filtered.map((p) => p.id)))}>Select all {filtered.length}</button>
        {selected.size > 0 && <button className="btn btn-sm" onClick={() => setSelected(new Set())}>Clear selection</button>}
        <span className="sep" />
        <button className="btn btn-sm" disabled={!target || !!busy} onClick={() => setStatus('published')}>Publish</button>
        <button className="btn btn-sm" disabled={!target || !!busy} onClick={() => setStatus('draft')}>Unpublish</button>
        <button className="btn btn-sm" disabled={!target || !!busy} onClick={() => setStatus('archived')}>Archive</button>
        <select disabled={!target || !!busy} value="" onChange={(e) => e.target.value && setStock(e.target.value as StockStatus)}>
          <option value="">Set stock…</option>
          {Object.entries(STOCK_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn btn-sm" disabled={!target || !!busy} onClick={clearOffer}>Clear offer</button>
        <button className="btn btn-sm" disabled={!target || !!busy} onClick={priceFromSource}>Price from source…</button>
        <span className="sep" />
        <button className="btn btn-sm" onClick={() => exportSelection('xlsx')}>Export {target ? 'selected' : 'filtered'} (Excel)</button>
        <button className="btn btn-sm" onClick={() => exportSelection('csv')}>CSV</button>
      </div>
      {busy && <div className="alert">{busy}…</div>}
      {message && <div className="alert">{message}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Select page" checked={pageRows.length > 0 && pageRows.every((p) => selected.has(p.id))} onChange={(e) => {
                const s = new Set(selected);
                pageRows.forEach((p) => (e.target.checked ? s.add(p.id) : s.delete(p.id)));
                setSelected(s);
              }} /></th>
              <th>Image</th>
              <th>Model / SKU</th>
              <th>Name</th>
              <th>Brand</th>
              <th>Category</th>
              <th className="num">Price</th>
              <th className="num">Offer</th>
              <th>Stock</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((p) => (
              <tr key={p.id} className={selected.has(p.id) ? 'selected' : ''}>
                <td><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.model}`} /></td>
                <td>{p.imageUrl ? <img className="thumb" src={p.imageUrl} alt="" loading="lazy" /> : <span className="muted small">none</span>}</td>
                <td><Link to={`/admin/products/${p.id}`}><code>{p.model || '—'}</code></Link>{p.sku !== p.model && <div className="muted small">{p.sku}</div>}</td>
                <td className="clip">{p.name}</td>
                <td>{p.brand}</td>
                <td className="clip">{p.category}</td>
                <td className="num">{p.price == null ? <span className="muted">—</span> : formatSar(p.price)}</td>
                <td className="num">{activeOffer(p) ? formatSar(p.offerPrice) : ''}</td>
                <td><span className={`stock stock-${p.stockStatus}`}>{STOCK_LABELS[p.stockStatus]}{p.stockQty != null && ` (${p.stockQty})`}</span></td>
                <td><span className={`pill pill-${p.status}`}>{p.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > PAGE && (
        <div className="pager">
          <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page + 1} of {Math.ceil(filtered.length / PAGE)}</span>
          <button className="btn btn-sm" disabled={(page + 1) * PAGE >= filtered.length} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
