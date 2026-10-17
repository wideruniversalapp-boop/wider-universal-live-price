import { useState } from 'react';
import { Link } from 'react-router-dom';
import { publishIndex } from '../../lib/catalogIndex';
import { activeOffer } from '../../lib/format';
import { useAdminData } from './AdminLayout';
import { missingInfo } from './missing';

export default function Dashboard() {
  const { products, loading } = useAdminData();
  const [indexMsg, setIndexMsg] = useState<string | null>(null);
  const rebuild = () =>
    publishIndex(products)
      .then((r) => setIndexMsg(r.written ? `Public catalog index rebuilt (${r.count} products).` : `Public catalog index is already up to date (${r.count} products).`))
      .catch((e) => setIndexMsg(`Rebuild failed: ${e.message}`));
  if (loading) return <div className="page-state">Loading dashboard…</div>;

  const active = products.filter((p) => p.status === 'published');
  const stat = [
    { label: 'Active (published) products', value: active.length, to: '/admin/products?status=published' },
    { label: 'Draft products', value: products.filter((p) => p.status === 'draft').length, to: '/admin/products?status=draft' },
    { label: 'Archived products', value: products.filter((p) => p.status === 'archived').length, to: '/admin/products?status=archived' },
    { label: 'In stock', value: active.filter((p) => p.stockStatus === 'in_stock').length, to: '/admin/products?stock=in_stock' },
    { label: 'Low stock', value: active.filter((p) => p.stockStatus === 'low_stock').length, to: '/admin/products?stock=low_stock' },
    { label: 'Out of stock', value: active.filter((p) => p.stockStatus === 'out_of_stock').length, to: '/admin/products?stock=out_of_stock' },
    { label: 'Promotional products', value: active.filter((p) => activeOffer(p)).length, to: '/admin/products?flag=offer' },
    { label: 'Without selling price', value: active.filter((p) => p.price == null).length, to: '/admin/products?flag=no-price' },
    { label: 'Missing important information', value: products.filter((p) => p.status !== 'archived' && missingInfo(p).length > 0).length, to: '/admin/products?flag=missing' },
  ];

  return (
    <div>
      <h1>Dashboard</h1>
      <p className="muted">Live counts from the database ({products.length.toLocaleString()} product records).</p>
      <div className="stats">
        {stat.map((s) => (
          <Link key={s.label} to={s.to} className="stat">
            <span className="stat-value">{s.value.toLocaleString()}</span>
            <span className="stat-label">{s.label}</span>
          </Link>
        ))}
      </div>
      <h2>Quick actions</h2>
      <div className="row-gap">
        <Link className="btn btn-primary" to="/admin/products/new">Add product</Link>
        <Link className="btn" to="/admin/import">Import spreadsheet</Link>
        <Link className="btn" to="/admin/price-list">Generate PDF price list</Link>
        <button className="btn" onClick={rebuild}>Check public catalog index</button>
      </div>
      {indexMsg && <p className="alert" role="status">{indexMsg}</p>}
    </div>
  );
}
