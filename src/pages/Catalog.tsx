import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CatalogRow } from '../components/CatalogRow';
import { QuoteColumn } from '../components/QuoteColumn';
import { PublicShell } from '../components/Layout';
import { EMPTY_FILTER, filterProducts, uniqueSorted, type CatalogFilter, type SortKey } from '../lib/catalogFilter';
import { fetchIndexedCatalog, lastIndexUpdatedAt } from '../lib/catalogIndex';
import { activeOffer, productPriceDrop } from '../lib/format';
import { fetchBrands, fetchPublishedProducts } from '../lib/products';
import { whatsappHref } from '../lib/siteConfig';
import { useMedia } from '../lib/useMedia';
import { logoUrl, useSiteConfig } from '../lib/siteConfigStore';
import type { Brand, Product } from '../types';

const ROWS_PER_GROUP = 8;
const LAYOUT_KEY = 'wu-catalog-layout';
const GROUPS_PER_PAGE = 10;

/** Reads the compact public index; falls back to querying products directly. */
async function loadCatalog(): Promise<Product[]> {
  try {
    const indexed = await fetchIndexedCatalog();
    if (indexed) return indexed;
  } catch (e) {
    console.warn('Catalog index unavailable, loading products directly', e);
  }
  return fetchPublishedProducts();
}

const SORT_LABELS: Record<SortKey, string> = {
  relevance: 'Featured',
  'price-asc': 'Price: low to high',
  'price-desc': 'Price: high to low',
  'name-asc': 'Name: A–Z',
  'name-desc': 'Name: Z–A',
  'model-asc': 'Model number',
};

export default function Catalog() {
  const { config } = useSiteConfig();
  useEffect(() => {
    document.title = `${config.company.name} | Product Catalog`;
  }, [config.company.name]);
  // Layout: admin chooses automatic/standard and the width; visitors may override if allowed.
  const screenIsWide = useMedia(`(min-width: ${config.catalog.wideMinWidth}px)`);
  const [visitorLayout, setVisitorLayout] = useState<'wide' | 'standard' | null>(() => {
    try {
      const v = localStorage.getItem(LAYOUT_KEY);
      return v === 'wide' || v === 'standard' ? v : null;
    } catch {
      return null;
    }
  });
  const chooseLayout = (v: 'wide' | 'standard') => {
    setVisitorLayout(v);
    try {
      localStorage.setItem(LAYOUT_KEY, v);
    } catch {
      /* preference only */
    }
  };
  const canWide = config.catalog.layout === 'auto' && screenIsWide;
  const showSwitch = canWide && config.catalog.visitorLayoutSwitch;
  const wide = canWide && !(showSwitch && visitorLayout === 'standard');
  const showStock = config.catalog.showStock;
  const [products, setProducts] = useState<Product[] | null>(null);
  const [brandDocs, setBrandDocs] = useState<Brand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [pdfBusy, setPdfBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [groupLimit, setGroupLimit] = useState(GROUPS_PER_PAGE);
  // Search text lives in local state so typing never waits on a router update.
  const [q, setQ] = useState(params.get('q') ?? '');

  const filter: CatalogFilter = {
    q,
    brand: params.get('brand') ?? '',
    category: params.get('category') ?? '',
    offersOnly: params.get('offers') === '1',
    dropsOnly: params.get('drops') === '1',
    inStockOnly: params.get('stock') === '1',
    sort: (params.get('sort') as SortKey) || EMPTY_FILTER.sort,
  };

  const setFilter = (patch: Partial<CatalogFilter>) => {
    const next = { ...filter, ...patch };
    if (patch.q !== undefined) setQ(patch.q);
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    if (next.brand) p.set('brand', next.brand);
    if (next.category) p.set('category', next.category);
    if (next.offersOnly) p.set('offers', '1');
    if (next.dropsOnly) p.set('drops', '1');
    if (next.inStockOnly) p.set('stock', '1');
    if (next.sort !== 'relevance') p.set('sort', next.sort);
    setParams(p, { replace: true });
    setGroupLimit(GROUPS_PER_PAGE);
    setExpandedGroups(new Set());
    setOpenId(null);
  };

  const resetFilters = () => {
    setQ('');
    setParams(new URLSearchParams(), { replace: true });
    setGroupLimit(GROUPS_PER_PAGE);
  };

  const load = () => {
    setError(null);
    setProducts(null);
    loadCatalog()
      .then(setProducts)
      .catch((e) => {
        console.error(e);
        setError('The catalog could not be loaded. Please check your connection and try again.');
      });
    fetchBrands().then(setBrandDocs).catch(() => setBrandDocs([]));
  };
  useEffect(load, []);

  const brandCounts = useMemo(() => {
    const m = new Map<string, number>();
    (products ?? []).forEach((p) => m.set(p.brand, (m.get(p.brand) ?? 0) + 1));
    return m;
  }, [products]);
  // Brand order: admin order from Brands & categories, then any others alphabetically.
  const brands = useMemo(() => {
    const ordered = brandDocs.map((b) => b.name).filter((n) => brandCounts.has(n));
    return [...ordered, ...uniqueSorted([...brandCounts.keys()].filter((n) => !ordered.includes(n)))];
  }, [brandDocs, brandCounts]);
  const categories = useMemo(
    () => uniqueSorted((products ?? []).filter((p) => !filter.brand || p.brand === filter.brand).map((p) => p.category)),
    [products, filter.brand],
  );
  const results = useMemo(() => (products ? filterProducts(products, filter) : []), [products, params, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const offerCount = useMemo(() => (products ?? []).filter((p) => activeOffer(p)).length, [products]);
  const dropCount = useMemo(() => (products ?? []).filter((p) => productPriceDrop(p)).length, [products]);

  // Group rows by category while the list is in its natural order; sorted views stay flat.
  const groups = useMemo(() => {
    if (filter.sort !== 'relevance') return [{ name: `Sorted by ${SORT_LABELS[filter.sort].toLowerCase()}`, items: results }];
    const m = new Map<string, Product[]>();
    results.forEach((p) => {
      const k = p.category || 'Other products';
      m.set(k, [...(m.get(k) ?? []), p]);
    });
    return [...m.entries()].map(([name, items]) => ({ name, items }));
  }, [results, filter.sort]);

  // Spotlight: the selected brand, else the general catalog introduction.
  const spotBrand = filter.brand ? brandDocs.find((b) => b.name === filter.brand) ?? { id: '', name: filter.brand, order: 0 } : null;
  const brandIndex = filter.brand ? brands.indexOf(filter.brand) : -1;
  const stepBrand = (dir: 1 | -1) => {
    if (!brands.length) return;
    const i = brandIndex < 0 ? (dir === 1 ? 0 : brands.length - 1) : (brandIndex + dir + brands.length) % brands.length;
    setFilter({ brand: brands[i], category: '' });
  };
  const collage = useMemo(
    () => (products ?? []).filter((p) => p.imageUrl && (!filter.brand || p.brand === filter.brand)).slice(0, 4),
    [products, filter.brand],
  );
  const updated = lastIndexUpdatedAt
    ? new Date(lastIndexUpdatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  const active: { label: string; clear: () => void }[] = [];
  if (filter.q) active.push({ label: `Search: “${filter.q}”`, clear: () => setFilter({ q: '' }) });
  if (filter.category) active.push({ label: `Category: ${filter.category}`, clear: () => setFilter({ category: '' }) });
  if (filter.offersOnly) active.push({ label: 'Offers only', clear: () => setFilter({ offersOnly: false }) });
  if (filter.dropsOnly) active.push({ label: 'Price drops only', clear: () => setFilter({ dropsOnly: false }) });
  if (filter.inStockOnly) active.push({ label: 'In stock only', clear: () => setFilter({ inStockOnly: false }) });

  const downloadPdf = async () => {
    if (!products) return;
    setPdfBusy(true);
    try {
      // The PDF needs the full public records (features etc. are not in the index).
      const full = await fetchPublishedProducts();
      const ids = new Set((filter.brand || filter.category ? results : products).map((p) => p.id));
      const { downloadPriceList } = await import('../lib/pdf');
      await downloadPriceList(full.filter((p) => ids.has(p.id)), config, {
        title: filter.brand ? `${filter.brand} ${config.pdf.title}` : config.pdf.title,
        includeStock: showStock,
        includeFeatures: false,
        categories: filter.category ? [filter.category] : [],
      });
    } catch (e) {
      console.error(e);
      setError('The price list could not be generated. Please try again.');
    } finally {
      setPdfBusy(false);
    }
  };

  const quoteWa = whatsappHref(config, `Hello ${config.company.name}, I would like a quotation.`);

  // ------------------------------------------------------------------ shared pieces
  const layoutSwitch = showSwitch && (
    <div className="layout-switch" role="group" aria-label="Page layout">
      <span>Layout</span>
      <button type="button" aria-pressed={wide} className={wide ? 'active' : ''} onClick={() => chooseLayout('wide')}>Wide</button>
      <button type="button" aria-pressed={!wide} className={!wide ? 'active' : ''} onClick={() => chooseLayout('standard')}>Standard</button>
    </div>
  );
  const liveBadge = (
    <span className="live-badge"><span className="live-dot" aria-hidden="true" />LIVE PRICE LIST{updated && <> · UPDATED {updated.toUpperCase()}</>}</span>
  );
  const headline = spotBrand ? (
    <>
      <p className="spotlight-kicker">BRAND SPOTLIGHT · {brandIndex + 1} OF {brands.length}</p>
      <h1>{spotBrand.headline || <>{spotBrand.name} <span>products</span></>}</h1>
      <p className="spotlight-lead pre">{spotBrand.subtitle || `${brandCounts.get(spotBrand.name) ?? 0} ${spotBrand.name} products with current SAR prices, ready to quote.`}</p>
    </>
  ) : (
    <>
      {config.pages.heroEyebrow && <p className="spotlight-kicker">{config.pages.heroEyebrow.toUpperCase()}</p>}
      <h1>{config.pages.heroTitle}</h1>
      {config.pages.heroText && <p className="spotlight-lead pre">{config.pages.heroText}</p>}
    </>
  );
  const picture = spotBrand?.bannerPath ? (
    <img className="spotlight-banner" src={logoUrl(spotBrand.bannerPath)} alt={`${spotBrand.name} banner`} />
  ) : (
    <div className="spotlight-collage">
      {collage.length ? collage.slice(0, wide ? 4 : 3).map((p) => <img key={p.id} src={p.imageUrl!} alt="" loading="lazy" />) : <span className="muted">{products ? '' : 'Loading…'}</span>}
    </div>
  );
  const searchInput = (
    <label className="search-field" htmlFor="catalog-search">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      <span className="sr-only">Search products</span>
      <input id="catalog-search" type="search" placeholder={`Search ${(products?.length ?? 0).toLocaleString()} products by model number, SKU or name…`} value={filter.q} onChange={(e) => setFilter({ q: e.target.value })} autoComplete="off" />
    </label>
  );
  const pdfLabel = pdfBusy ? 'Preparing PDF…' : filter.brand ? `Download ${filter.brand} price list (PDF)` : 'Download price list (PDF)';
  const pdfIcon = <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  const categorySelect = (
    <>
      <label className="sr-only" htmlFor="f-cat">Category</label>
      <select id="f-cat" value={filter.category} onChange={(e) => setFilter({ category: e.target.value })}>
        <option value="">All categories</option>
        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </>
  );
  const sortSelect = (
    <>
      <label className="sr-only" htmlFor="f-sort">Sort</label>
      <select id="f-sort" value={filter.sort} onChange={(e) => setFilter({ sort: e.target.value as SortKey })}>
        {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <option key={k} value={k}>Sort: {SORT_LABELS[k]}</option>)}
      </select>
    </>
  );
  const activeFilters = active.length > 0 && (
    <div className="active-filters" aria-label="Active filters">
      {active.map((a) => (
        <button key={a.label} className="active-filter" onClick={a.clear} aria-label={`Remove filter ${a.label}`}>
          {a.label} <span aria-hidden="true">×</span>
        </button>
      ))}
      <button className="link-button" onClick={resetFilters}>Reset filters</button>
    </div>
  );
  const listing = (
    <>
      {error && (
        <div className="state error" role="alert">
          <p>{error}</p>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}
      {!error && !products && (
        <div className="group" aria-busy="true" aria-label="Loading products">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="catalog-row skeleton-row" />)}
        </div>
      )}
      {products && results.length === 0 && (
        <div className="state empty">
          <h2>No products found</h2>
          <p>
            {filter.q ? <>Nothing matches “{filter.q}”{filter.brand && <> in {filter.brand}</>}. </> : 'No products match these filters. '}
            Check the model number spelling, try fewer words, or clear the filters.
          </p>
          <div className="row-gap center-row">
            <button className="btn btn-primary" onClick={resetFilters}>Reset filters</button>
            <Link className="btn" to="/contact">Ask our sales team</Link>
          </div>
        </div>
      )}
      {products && results.length > 0 && (
        <div className="groups">
          {groups.slice(0, groupLimit).map((g) => {
            const all = expandedGroups.has(g.name) || filter.sort !== 'relevance';
            const rows = all ? g.items : g.items.slice(0, ROWS_PER_GROUP);
            return (
              <section className="group" key={g.name} aria-labelledby={`g-${g.name}`}>
                <div className="group-head">
                  <h2 id={`g-${g.name}`}><span className="group-mark" aria-hidden="true" />{g.name.toUpperCase()}</h2>
                  <span className="group-count">{g.items.length.toLocaleString()} product{g.items.length === 1 ? '' : 's'}</span>
                </div>
                {wide && (
                  <div className={`wide-colheads ${showStock ? '' : 'no-stock'}`} aria-hidden="true">
                    <div className="wch-grid"><span /><span>MODEL</span><span>PRODUCT</span>{showStock && <span>AVAILABILITY</span>}<span className="num">PRICE</span><span /></div>
                    <span className="wch-quick" />
                  </div>
                )}
                {rows.map((p) => (
                  <CatalogRow key={p.id} product={p} config={config} wide={wide} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} />
                ))}
                {!all && g.items.length > ROWS_PER_GROUP && (
                  <button type="button" className="btn show-all" onClick={() => setExpandedGroups(new Set(expandedGroups).add(g.name))}>
                    Show all {g.items.length} in {g.name}
                  </button>
                )}
              </section>
            );
          })}
          {groups.length > groupLimit && (
            <div className="center">
              <p className="muted small">Showing {groupLimit} of {groups.length} categories</p>
              <button type="button" className="btn btn-primary" onClick={() => setGroupLimit(groupLimit + GROUPS_PER_PAGE)}>Show more categories</button>
            </div>
          )}
        </div>
      )}
    </>
  );
  const about = (config.pages.aboutTitle || config.pages.aboutText) && (
    <section className={`${wide ? 'wide-pad' : 'container'} about-section`} aria-labelledby="about-h">
      {config.pages.aboutTitle && <h2 id="about-h">{config.pages.aboutTitle}</h2>}
      {config.pages.aboutText && <p className="pre">{config.pages.aboutText}</p>}
    </section>
  );

  // ------------------------------------------------------------------ wide screens: filters · products · quote list
  if (wide) {
    return (
      <PublicShell showHeaderSearch={false} headerSlot={<div role="search" className="header-catalog-search">{searchInput}</div>} hideQuoteBar wide>
        <section className="wide-band">
          <div className="wide-band-copy">
            {liveBadge}
            {headline}
          </div>
          <div className="wide-band-picture">{picture}</div>
        </section>
        <div className="wide-layout" id="catalog">
          <aside className="wide-filters" aria-label="Filters">
            <div className="wf-group">
              <span className="wf-label">BRAND</span>
              <button type="button" className={`wf-brand ${!filter.brand ? 'active' : ''}`} aria-pressed={!filter.brand} onClick={() => setFilter({ brand: '', category: '' })}>
                All brands <span>{(products?.length ?? 0).toLocaleString()}</span>
              </button>
              {brands.map((b) => (
                <button key={b} type="button" className={`wf-brand ${filter.brand === b ? 'active' : ''}`} aria-pressed={filter.brand === b} onClick={() => setFilter({ brand: filter.brand === b ? '' : b, category: '' })}>
                  {b} <span>{brandCounts.get(b)}</span>
                </button>
              ))}
            </div>
            <div className="wf-group">
              <span className="wf-label">SHOW ONLY</span>
              {offerCount > 0 && (
                <label className="wf-check"><span><input type="checkbox" checked={filter.offersOnly} onChange={(e) => setFilter({ offersOnly: e.target.checked })} /> Offers</span><span className="wf-n offer">{offerCount}</span></label>
              )}
              {dropCount > 0 && (
                <label className="wf-check"><span><input type="checkbox" checked={!!filter.dropsOnly} onChange={(e) => setFilter({ dropsOnly: e.target.checked })} /> Price drops</span><span className="wf-n drop">{dropCount}</span></label>
              )}
              {showStock && (
                <label className="wf-check"><span><input type="checkbox" checked={filter.inStockOnly} onChange={(e) => setFilter({ inStockOnly: e.target.checked })} /> In stock</span></label>
              )}
            </div>
            <button type="button" className="btn btn-outline btn-block pdf-side" onClick={downloadPdf} disabled={!products || pdfBusy}>{pdfIcon}{pdfLabel}</button>
            {quoteWa && <a className="btn btn-block" href={quoteWa} target="_blank" rel="noopener noreferrer">Request a quotation</a>}
          </aside>

          <section className="wide-main" aria-label="Products">
            <div className="wide-results-bar">
              <span className="wide-count" aria-live="polite">
                <strong>{results.length.toLocaleString()}</strong> product{results.length === 1 ? '' : 's'}
                {filter.brand && <> in {filter.brand}</>}
              </span>
              <div className="wide-selects">{layoutSwitch}{categorySelect}{sortSelect}</div>
            </div>
            {activeFilters}
            {config.pages.catalogIntro && <p className="catalog-intro pre">{config.pages.catalogIntro}</p>}
            {listing}
          </section>

          <QuoteColumn />
        </div>
        {about}
      </PublicShell>
    );
  }

  // ------------------------------------------------------------------ standard layout
  return (
    <PublicShell showHeaderSearch={false}>
      <section className="spotlight">
        <div aria-hidden="true" className="spotlight-watermark">{spotBrand ? spotBrand.name : config.company.name.split(' ').slice(0, 2).join(' ')}</div>
        <div className="container spotlight-grid">
          <div className="spotlight-copy">
            {liveBadge}
            {headline}
            <div className="spotlight-nav">
              <button type="button" className="square-btn" aria-label="Previous brand" onClick={() => stepBrand(-1)} disabled={!brands.length}>‹</button>
              <button type="button" className="square-btn" aria-label="Next brand" onClick={() => stepBrand(1)} disabled={!brands.length}>›</button>
              <span className="muted small">
                {spotBrand ? <>Next: {brands.slice(brandIndex + 1, brandIndex + 4).join(' · ') || brands.slice(0, 3).join(' · ')}</> : <>Browse {brands.length} brands</>}
              </span>
              {quoteWa && !spotBrand && <a className="btn btn-sm btn-outline" href={quoteWa} target="_blank" rel="noopener noreferrer">Request a quotation</a>}
            </div>
          </div>
          <div className="spotlight-card">
            {picture}
            <div className="spotlight-card-foot">
              <span className="muted small">{spotBrand ? spotBrand.name : 'All brands'}</span>
              <span className="spotlight-count">{(spotBrand ? brandCounts.get(spotBrand.name) ?? 0 : products?.length ?? 0).toLocaleString()} products</span>
            </div>
          </div>
        </div>
      </section>

      <section className="container catalog" id="catalog">
        <div className="search-card" role="search">
          {searchInput}
          <div className="search-count" aria-live="polite">
            <span>{filter.brand ? filter.brand.toUpperCase() : 'ALL BRANDS'}</span>
            <strong>{results.length.toLocaleString()} items</strong>
          </div>
          <button type="button" className="btn btn-primary pdf-btn" onClick={downloadPdf} disabled={!products || pdfBusy}>
            {pdfIcon}
            {pdfLabel}
          </button>
        </div>

        {config.pages.catalogIntro && <p className="catalog-intro pre">{config.pages.catalogIntro}</p>}

        <div className="brand-chips" aria-label="Brands">
          <span className="chips-label">BRAND</span>
          <button type="button" className={`brand-chip ${!filter.brand ? 'active' : ''}`} aria-pressed={!filter.brand} onClick={() => setFilter({ brand: '', category: '' })}>
            ALL <span>{(products?.length ?? 0).toLocaleString()}</span>
          </button>
          {brands.map((b) => (
            <button key={b} type="button" className={`brand-chip ${filter.brand === b ? 'active' : ''}`} aria-pressed={filter.brand === b} onClick={() => setFilter({ brand: filter.brand === b ? '' : b, category: '' })}>
              {b.toUpperCase()} <span>{brandCounts.get(b)}</span>
            </button>
          ))}
          {offerCount > 0 && (
            <button type="button" className={`brand-chip offer ${filter.offersOnly ? 'active' : ''}`} aria-pressed={filter.offersOnly} onClick={() => setFilter({ offersOnly: !filter.offersOnly })}>
              OFFERS <span>{offerCount}</span>
            </button>
          )}
          {dropCount > 0 && (
            <button type="button" className={`brand-chip drop ${filter.dropsOnly ? 'active' : ''}`} aria-pressed={!!filter.dropsOnly} onClick={() => setFilter({ dropsOnly: !filter.dropsOnly })}>
              PRICE DROPS <span>{dropCount}</span>
            </button>
          )}
        </div>

        <div className="refine-bar">
          {layoutSwitch}
          {categorySelect}
          {sortSelect}
          {showStock && (
            <label className="check">
              <input type="checkbox" checked={filter.inStockOnly} onChange={(e) => setFilter({ inStockOnly: e.target.checked })} /> In stock only
            </label>
          )}
          {activeFilters}
        </div>

        {listing}

        <div className="sales-strip">
          <div>
            <strong>Project pricing</strong>
            <span>Bulk or project quantities? Add products to your quote list and send it to your nearest branch.</span>
          </div>
          <div>
            <strong>Branches across Saudi Arabia</strong>
            <span>Call or email our sales team directly.</span>
          </div>
          <Link className="btn btn-primary" to="/contact">Contact sales</Link>
        </div>
      </section>
      {about}
    </PublicShell>
  );
}
