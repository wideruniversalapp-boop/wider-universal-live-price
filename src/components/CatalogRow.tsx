import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { activeOffer, formatSar, productPriceDrop, splitFeatures, STOCK_LABELS } from '../lib/format';
import { fetchProduct } from '../lib/products';
import { whatsappHref, type SiteConfig } from '../lib/siteConfig';
import { useQuote } from '../lib/quoteStore';
import type { Product, Spec } from '../types';

function RowPrice({ product, large = false }: { product: Product; large?: boolean }) {
  if (product.price == null) return <span className={`row-price on-request ${large ? 'large' : ''}`}>Price on request</span>;
  if (activeOffer(product))
    return (
      <span className={`row-price ${large ? 'large' : ''}`}>
        <span className="now">{formatSar(product.offerPrice)}</span>
        <span className="was"><span className="sr-only">Regular price </span>{formatSar(product.price)}</span>
      </span>
    );
  const drop = productPriceDrop(product);
  if (drop)
    return (
      <span className={`row-price ${large ? 'large' : ''}`}>
        <span className="now">{formatSar(product.price)}</span>
        <span className="was"><span className="sr-only">Previous price </span>{formatSar(drop.previous)}</span>
      </span>
    );
  return <span className={`row-price ${large ? 'large' : ''}`}><span className="now">{formatSar(product.price)}</span></span>;
}

export function DropTag({ product }: { product: Product }) {
  const drop = productPriceDrop(product);
  return drop ? (
    <span className="row-drop" title={`Price reduced from ${formatSar(drop.previous)}`}>
      PRICE <span aria-hidden="true">↓</span><span className="sr-only">down</span> {drop.pct}%
    </span>
  ) : null;
}

export function QuoteButton({ product, qty = 1, block = false }: { product: Product; qty?: number; block?: boolean }) {
  const quote = useQuote();
  const inList = quote.has(product.id);
  return (
    <button type="button" className={`btn ${inList ? 'btn-outline' : 'btn-primary'} ${block ? 'btn-block' : ''}`} onClick={() => quote.add(product, qty)}>
      {inList ? `Add ${qty} more to quote list` : 'Add to quote list'}
    </button>
  );
}

/** One catalog row; clicking it opens specifications and quote actions in place. */
export function CatalogRow({ product, config, open, onToggle, wide = false }: { product: Product; config: SiteConfig; open: boolean; onToggle: () => void; wide?: boolean }) {
  const [full, setFull] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const quote = useQuote();
  const inList = quote.items.find((i) => i.id === product.id);
  const showStock = config.catalog.showStock;

  useEffect(() => {
    if (open && !full) fetchProduct(product.id).then((p) => setFull(p ?? product)).catch(() => setFull(product));
  }, [open, full, product]);

  const p = full ?? product;
  const split = splitFeatures(p.features);
  const specs: Spec[] = [...p.specs, ...split.rows];
  const enquiry = whatsappHref(config, `Hello ${config.company.name}, I would like a quotation for ${p.brand} ${p.model} (SKU ${p.sku}).`);
  const panelId = `row-panel-${product.id}`;

  return (
    <article className={`catalog-row ${open ? 'open' : ''} ${wide ? 'wide' : ''} ${wide && !showStock ? 'no-stock' : ''}`}>
      <div className="row-line">
      <button type="button" className="row-head" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <span className="row-thumb">{product.imageUrl ? <img src={product.imageUrl} alt="" loading="lazy" decoding="async" /> : null}</span>
        {wide ? (
          <>
            <span className="row-modelcol">
              <code className="row-model">{product.model}</code>
              <span className="row-tags">
                <span className="row-brand">{product.brand}</span>
                {activeOffer(product) && <span className="row-offer">OFFER</span>}
                <DropTag product={product} />
              </span>
            </span>
            <span className="row-name">{product.name}</span>
          </>
        ) : (
          <span className="row-main">
            <span className="row-tags">
              <code className="row-model">{product.model}</code>
              <span className="row-brand">{product.brand}</span>
              {activeOffer(product) && <span className="row-offer">OFFER</span>}
              <DropTag product={product} />
              {inList && <span className="row-inquote">In quote × {inList.qty}</span>}
            </span>
            <span className="row-name">{product.name}</span>
          </span>
        )}
        {showStock && (
          <span className="row-stock">
            <span className={`dot dot-${product.stockStatus}`} aria-hidden="true" />
            {STOCK_LABELS[product.stockStatus]}
          </span>
        )}
        <RowPrice product={product} />
        <span className="row-chevron" aria-hidden="true">›</span>
      </button>
      {wide && (
        <span className="row-quick">
          <button
            type="button"
            className={`btn btn-sm ${inList ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => quote.add(product, 1)}
            aria-label={inList ? `In quote list (${inList.qty}). Add one more ${product.model}` : `Add ${product.model} to quote list`}
          >
            {inList ? <>✓ In quote × {inList.qty}</> : '+ Add to quote'}
          </button>
        </span>
      )}
      </div>

      {open && (
        <div className="row-panel" id={panelId}>
          <div className="row-media">
            <div className="row-media-img">{p.imageUrl ? <img src={p.imageUrl} alt={`${p.brand} ${p.model}`} /> : <span className="muted small">No image</span>}</div>
            <div className="row-links">
              {p.datasheetUrl && <a href={p.datasheetUrl} target="_blank" rel="noopener noreferrer">Datasheet ↗</a>}
              <Link to={`/product/${p.id}`}>Open product page</Link>
            </div>
          </div>

          <div className="row-specs">
            <h3>Key specifications</h3>
            {!full ? (
              <p className="muted">Loading…</p>
            ) : specs.length ? (
              <dl className="spec-list">
                {specs.slice(0, 10).map((s, i) => (
                  <div key={i}>
                    <dt>{s.label || '—'}</dt>
                    <dd>{s.value}</dd>
                  </div>
                ))}
              </dl>
            ) : split.bullets.length ? (
              <ul className="features">{split.bullets.slice(0, 8).map((f, i) => <li key={i}>{f}</li>)}</ul>
            ) : p.description ? (
              <p className="pre">{p.description}</p>
            ) : (
              <p className="muted">Specifications available on request.</p>
            )}
          </div>

          <div className="row-buy">
            <span className="buy-label">Your price</span>
            <RowPrice product={p} large />
            <span className="muted small">Model {p.model}{p.sku !== p.model && <> · SKU {p.sku}</>}</span>
            <div className="qty">
              <label htmlFor={`qty-${p.id}`}>Quantity</label>
              <div className="qty-ctrl">
                <button type="button" aria-label="Decrease quantity" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
                <input id={`qty-${p.id}`} type="number" min={1} max={9999} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(9999, Number(e.target.value) || 1)))} />
                <button type="button" aria-label="Increase quantity" onClick={() => setQty((q) => Math.min(9999, q + 1))}>+</button>
              </div>
            </div>
            <QuoteButton product={p} qty={qty} block />
            {enquiry && <a className="btn btn-outline btn-block" href={enquiry} target="_blank" rel="noopener noreferrer">Enquire on WhatsApp</a>}
          </div>
        </div>
      )}
    </article>
  );
}
