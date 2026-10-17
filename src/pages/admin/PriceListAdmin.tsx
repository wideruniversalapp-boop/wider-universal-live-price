import { useEffect, useMemo, useState } from 'react';
import { uniqueSorted } from '../../lib/catalogFilter';
import { useSiteConfig } from '../../lib/siteConfigStore';
import { useAdminData } from './AdminLayout';

export default function PriceListAdmin() {
  const { products } = useAdminData();
  const { config, reload } = useSiteConfig();
  const [warning, setWarning] = useState<string | null>(null);
  const [brands, setBrands] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [includeStock, setIncludeStock] = useState(true);
  const [includeFeatures, setIncludeFeatures] = useState(false);
  const [title, setTitle] = useState(config.pdf.title);
  const [busy, setBusy] = useState(false);

  // Always use the latest published branding.
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setIncludeStock(config.catalog.showStock); setTitle(config.pdf.title); }, [config]);

  const published = useMemo(() => products.filter((p) => p.status === 'published'), [products]);
  const allBrands = useMemo(() => uniqueSorted(published.map((p) => p.brand)), [published]);
  const allCategories = useMemo(
    () => uniqueSorted(published.filter((p) => !brands.length || brands.includes(p.brand)).map((p) => p.category)),
    [published, brands],
  );
  const count = published.filter((p) => (!brands.length || brands.includes(p.brand)) && (!categories.length || categories.includes(p.category))).length;
  const withoutPrice = published.filter((p) => p.price == null && (!brands.length || brands.includes(p.brand)) && (!categories.length || categories.includes(p.category))).length;

  const generate = async () => {
    setBusy(true);
    try {
      const { downloadPriceList } = await import('../../lib/pdf');
      setWarning(await downloadPriceList(published, config, { title, includeStock, includeFeatures, brands, categories }));
    } finally {
      setBusy(false);
    }
  };

  const multi = (values: string[], selected: string[], set: (v: string[]) => void) => (
    <div className="checklist">
      {values.map((v) => (
        <label key={v} className="check">
          <input type="checkbox" checked={selected.includes(v)} onChange={(e) => set(e.target.checked ? [...selected, v] : selected.filter((x) => x !== v))} />
          {v}
        </label>
      ))}
    </div>
  );

  return (
    <div>
      <h1>PDF price list</h1>
      <p className="muted">
        Generated from the current published products and Wider Universal selling prices. Reference (source) prices are stored in a separate
        admin-only collection and are never included.
      </p>
      <section className="panel">
        <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={includeStock} onChange={(e) => setIncludeStock(e.target.checked)} /> Include availability</label>
        <label className="check"><input type="checkbox" checked={includeFeatures} onChange={(e) => setIncludeFeatures(e.target.checked)} /> Include key features (up to 4 lines)</label>
        <h3>Brands {brands.length ? `(${brands.length} selected)` : '(all)'}</h3>
        {multi(allBrands, brands, (v) => { setBrands(v); setCategories([]); })}
        <h3>Categories {categories.length ? `(${categories.length} selected)` : '(all)'}</h3>
        {multi(allCategories, categories, setCategories)}
        <p>
          <strong>{count.toLocaleString()}</strong> products will be included.
          {withoutPrice > 0 && <> {withoutPrice.toLocaleString()} have no selling price yet and will show “On request”.</>}
        </p>
        <p className="muted small">Branding (logo, company name, contact details, website, footer text) comes from <a href="/admin/settings">Website settings → PDF branding</a>.</p>
        <button className="btn btn-primary" disabled={busy || count === 0} onClick={generate}>{busy ? 'Generating…' : 'Generate PDF'}</button>
        {warning && <div className="alert error">{warning}</div>}
      </section>
    </div>
  );
}
