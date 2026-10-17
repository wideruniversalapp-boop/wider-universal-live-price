import { Link } from 'react-router-dom';
import { formatSar } from '../lib/format';
import { totals } from '../lib/quote';
import { useQuote } from '../lib/quoteStore';

/** Always-visible quote list beside the catalog on wide screens. */
export function QuoteColumn() {
  const quote = useQuote();
  const t = totals(quote.items);
  return (
    <aside className="wide-quote" aria-label="Quote list">
      <div className="wide-quote-head">
        <h2>Quote list</h2>
        <span className="group-count">{quote.items.length} item{quote.items.length === 1 ? '' : 's'}</span>
      </div>
      {quote.items.length === 0 ? (
        <p className="muted small">Choose “+ Add to quote” on any product. Your list stays in this browser until you send it to a branch.</p>
      ) : (
        <>
          <ul className="wide-quote-list">
            {quote.items.map((i) => (
              <li key={i.id}>
                <div className="wq-top">
                  <Link to={`/product/${i.id}`} className="wq-model">{i.model}</Link>
                  <button type="button" className="wq-remove" aria-label={`Remove ${i.model}`} onClick={() => quote.remove(i.id)}>×</button>
                </div>
                <div className="wq-bottom">
                  <div className="qty-ctrl small" role="group" aria-label={`Quantity for ${i.model}`}>
                    <button type="button" aria-label="Decrease quantity" disabled={i.qty <= 1} onClick={() => quote.setQty(i.id, i.qty - 1)}>−</button>
                    <input type="number" min={1} max={9999} value={i.qty} aria-label={`Quantity for ${i.model}`} onChange={(e) => quote.setQty(i.id, Number(e.target.value) || 1)} />
                    <button type="button" aria-label="Increase quantity" onClick={() => quote.setQty(i.id, i.qty + 1)}>+</button>
                  </div>
                  <span className="wq-price">{i.unitPrice == null ? 'On request' : formatSar(i.unitPrice * i.qty)}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="wide-quote-total">
            <span>List total{t.onRequest ? ` (+${t.onRequest} on request)` : ''}</span>
            <strong>{formatSar(t.priced)}</strong>
          </div>
          <Link className="btn btn-primary btn-block" to="/quote">Review &amp; send to a branch</Link>
          <span className="muted small">Sent by WhatsApp or email to the branch you choose.</span>
        </>
      )}
      <div className="wide-quote-note">
        <strong>Project pricing</strong>
        <span>Bulk quantities? Our branches reply with a formal quotation.</span>
        <Link to="/contact">Contact sales →</Link>
      </div>
    </aside>
  );
}
