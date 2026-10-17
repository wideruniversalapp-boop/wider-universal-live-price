import { Link } from 'react-router-dom';
import type { Product } from '../types';
import { activeOffer, discountPct, formatSar, productPriceDrop, STOCK_LABELS } from '../lib/format';

export function StockBadge({ product }: { product: Product }) {
  return <span className={`stock stock-${product.stockStatus}`}>{STOCK_LABELS[product.stockStatus]}</span>;
}

/** Never shows SAR 0.00 for a missing price: unpriced products ask for a quotation instead. */
export function PriceBlock({ product, large = false }: { product: Product; large?: boolean }) {
  const offer = activeOffer(product);
  const drop = productPriceDrop(product);
  if (product.price == null) {
    return (
      <div className={`price-block ${large ? 'large' : ''}`}>
        <span className="price on-request">Request a quotation</span>
      </div>
    );
  }
  return (
    <div className={`price-block ${large ? 'large' : ''}`}>
      {offer ? (
        <>
          <span className="price offer">{formatSar(product.offerPrice)}</span>
          <span className="price was"><span className="sr-only">Regular price </span>{formatSar(product.price)}</span>
        </>
      ) : drop ? (
        <>
          <span className="price">{formatSar(product.price)}</span>
          <span className="price was"><span className="sr-only">Previous price </span>{formatSar(drop.previous)}</span>
          <span className="row-drop">PRICE <span aria-hidden="true">↓</span><span className="sr-only">down</span> {drop.pct}%</span>
        </>
      ) : (
        <span className="price">{formatSar(product.price)}</span>
      )}
    </div>
  );
}

export function ProductImage({ product, className = '' }: { product: Product; className?: string }) {
  return product.imageUrl ? (
    <img className={className} src={product.imageUrl} alt={`${product.brand} ${product.model}`} loading="lazy" decoding="async" />
  ) : (
    <div className={`${className} img-placeholder`} role="img" aria-label="No image available">
      <span>{product.brand}</span>
    </div>
  );
}

export function ProductCard({ product, showStock }: { product: Product; showStock: boolean }) {
  const pct = discountPct(product);
  return (
    <article className="card product-card">
      <Link to={`/product/${product.id}`} className="card-link">
        <div className="card-media">
          <ProductImage product={product} />
          {pct != null && <span className="offer-badge">-{pct}%</span>}
        </div>
        <div className="card-body">
          <div className="card-meta">
            <span className="brand">{product.brand}</span>
          </div>
          <code className="model" title={product.model}>{product.model}</code>
          <h3>{product.name}</h3>
          <div className="card-foot">
            <PriceBlock product={product} />
            {showStock && <StockBadge product={product} />}
          </div>
          <span className="card-cta" aria-hidden="true">View details →</span>
        </div>
      </Link>
    </article>
  );
}
