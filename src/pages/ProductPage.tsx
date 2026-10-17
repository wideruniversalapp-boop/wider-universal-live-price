import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PublicShell } from '../components/Layout';
import { QuoteButton } from '../components/CatalogRow';
import { PriceBlock, ProductCard, ProductImage, StockBadge } from '../components/ProductCard';
import { fetchIndexedCatalog } from '../lib/catalogIndex';
import { activeOffer, discountPct, splitFeatures } from '../lib/format';
import { fetchProduct } from '../lib/products';
import { whatsappHref } from '../lib/siteConfig';
import { useSiteConfig } from '../lib/siteConfigStore';
import type { Product, Spec } from '../types';

export default function ProductPage() {
  const { id = '' } = useParams();
  const [product, setProduct] = useState<Product | null | undefined>(undefined);
  const { config } = useSiteConfig();
  const [related, setRelated] = useState<Product[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    setProduct(undefined);
    setRelated([]);
    window.scrollTo(0, 0);
    fetchProduct(id)
      .then((p) => {
        const visible = p && p.status === 'published' ? p : null;
        setProduct(visible);
        if (visible) {
          fetchIndexedCatalog()
            .then((all) => {
              const same = (all ?? []).filter((x) => x.id !== visible.id && x.brand === visible.brand && x.category === visible.category);
              setRelated(same.slice(0, 4));
            })
            .catch(() => setRelated([]));
        }
      })
      .catch((e) => {
        // Unpublished products are rejected by security rules; treat as not found.
        if (e?.code === 'permission-denied') setProduct(null);
        else setError(true);
      });
  }, [id]);

  useEffect(() => {
    if (product) document.title = `${product.model} — ${product.name} | ${config.company.name}`;
    return () => {
      document.title = `${config.company.name} | Product Catalog`;
    };
  }, [product, config.company.name]);

  const split = useMemo(() => splitFeatures(product?.features ?? []), [product]);

  let body;
  if (error) body = <div className="state error" role="alert">The product could not be loaded. <Link to="/">Back to catalog</Link></div>;
  else if (product === undefined) body = <div className="state" aria-busy="true">Loading product…</div>;
  else if (product === null) body = <div className="state">This product is not available. <Link to="/">Back to catalog</Link></div>;
  else {
    const p = product;
    const pct = discountPct(p);
    const enquiry = `Hello Wider Universal, I would like a quotation for ${p.brand} ${p.model} (SKU ${p.sku}).`;
    const specRows: Spec[] = [...p.specs, ...split.rows];
    const showDescription = p.description && p.features.length === 0;
    body = (
      <article className="product-detail">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to="/">Catalog</Link> <span aria-hidden="true">/</span>{' '}
          <Link to={`/?brand=${encodeURIComponent(p.brand)}#catalog`}>{p.brand}</Link>
          {p.category && (
            <>
              {' '}<span aria-hidden="true">/</span>{' '}
              <Link to={`/?brand=${encodeURIComponent(p.brand)}&category=${encodeURIComponent(p.category)}#catalog`}>{p.category}</Link>
            </>
          )}
        </nav>
        <div className="detail-grid">
          <div className="detail-media">
            <ProductImage product={p} />
            {pct != null && <span className="offer-badge">-{pct}%</span>}
          </div>
          <div className="detail-summary">
            <p className="brand">{p.brand}</p>
            <h1>{p.name}</h1>
            <dl className="ids">
              <div><dt>Model</dt><dd><code>{p.model}</code></dd></div>
              {p.sku !== p.model && <div><dt>SKU</dt><dd><code>{p.sku}</code></dd></div>}
              {p.category && <div><dt>Category</dt><dd>{p.category}</dd></div>}
            </dl>
            <div className="buy-box">
              <PriceBlock product={p} large />
              {activeOffer(p) && (p.offerText || p.offerEnd) && (
                <div className="offer-box">
                  {p.offerText && <p>{p.offerText}</p>}
                  {p.offerEnd && <p className="small">Offer valid until {p.offerEnd.toDate().toLocaleDateString('en-GB')}</p>}
                </div>
              )}
              {config.catalog.showStock && <StockBadge product={p} />}
              <div className="detail-actions">
                <QuoteButton product={p} />
                {whatsappHref(config, enquiry) && (
                  <a className="btn btn-whatsapp" href={whatsappHref(config, enquiry)!} target="_blank" rel="noopener noreferrer">Enquire on WhatsApp</a>
                )}
                {config.contact.email && <a className="btn btn-outline" href={`mailto:${config.contact.email}?subject=${encodeURIComponent(`Quotation request: ${p.model}`)}&body=${encodeURIComponent(enquiry)}`}>Email sales</a>}
                {p.datasheetUrl && <a className="btn btn-outline" href={p.datasheetUrl} target="_blank" rel="noopener noreferrer">Datasheet</a>}
              </div>
              {config.contact.phone && (
                <p className="muted small">Prices in SAR. Call <a href={`tel:${config.contact.phone.replace(/[^+0-9]/g, '')}`}>{config.contact.phone}</a> for project quantities.</p>
              )}
            </div>
          </div>
        </div>

        <div className="detail-sections">
          <section className="detail-section">
            <h2>Technical specifications</h2>
            {specRows.length ? (
              <table className="spec-table">
                <tbody>
                  {specRows.map((s, i) => (
                    <tr key={i}>
                      <th scope="row">{s.label || '—'}</th>
                      <td>{s.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">A detailed specification sheet is available on request from our sales team.</p>
            )}
          </section>
          {(split.bullets.length > 0 || showDescription) && (
            <section className="detail-section">
              <h2>Key features</h2>
              {split.bullets.length > 0 ? (
                <ul className="features">{split.bullets.map((f, i) => <li key={i}>{f}</li>)}</ul>
              ) : (
                <p className="pre">{p.description}</p>
              )}
            </section>
          )}
        </div>

        {related.length > 0 && (
          <section className="detail-section">
            <h2>Related products</h2>
            <div className="grid">
              {related.map((r) => <ProductCard key={r.id} product={r} showStock={config.catalog.showStock} />)}
            </div>
          </section>
        )}
      </article>
    );
  }

  return (
    <PublicShell>
      <div className="container">{body}</div>
    </PublicShell>
  );
}
