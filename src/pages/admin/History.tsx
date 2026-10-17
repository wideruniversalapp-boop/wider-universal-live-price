import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchRecentHistory } from '../../lib/products';
import type { ChangeSet } from '../../types';

const PRICE_STOCK = new Set(['price', 'offerPrice', 'offerStart', 'offerEnd', 'stockStatus', 'stockQty', 'status']);

export default function History() {
  const [sets, setSets] = useState<ChangeSet[] | null>(null);
  const [onlyPriceStock, setOnlyPriceStock] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRecentHistory(100).then(setSets).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h1>Audit history</h1>
      <p className="muted">Every product change is recorded with the administrator and server time. Records cannot be edited or deleted.</p>
      <label className="check"><input type="checkbox" checked={onlyPriceStock} onChange={(e) => setOnlyPriceStock(e.target.checked)} /> Price, offer, stock and visibility changes only</label>
      {error && <div className="alert error">{error}</div>}
      {!sets && !error && <div className="page-state">Loading…</div>}
      {sets && (
        <div className="table-wrap">
          <table className="data-table compact">
            <thead><tr><th>When</th><th>Administrator</th><th>Type</th><th>SKU</th><th>Field</th><th>From</th><th>To</th></tr></thead>
            <tbody>
              {sets.flatMap((h) =>
                h.changes
                  .filter((c) => !onlyPriceStock || PRICE_STOCK.has(c.field))
                  .slice(0, 300)
                  .map((c, i) => (
                    <tr key={`${h.id}-${i}`}>
                      <td>{h.at?.toDate().toLocaleString('en-GB')}</td>
                      <td>{h.byEmail}</td>
                      <td>{h.reason}</td>
                      <td><Link to={`/admin/products/${c.productId}`}><code>{c.sku}</code></Link></td>
                      <td>{c.field}</td>
                      <td className="clip">{String(c.from ?? '—')}</td>
                      <td className="clip">{String(c.to ?? '—')}</td>
                    </tr>
                  )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
