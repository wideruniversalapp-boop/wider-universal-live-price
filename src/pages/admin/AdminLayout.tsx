import { signOut } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useOutletContext } from 'react-router-dom';
import { auth } from '../../firebase';
import { useAuth } from '../../lib/auth';
import { publishIndex } from '../../lib/catalogIndex';
import { CompanyLogo, useSiteConfig } from '../../lib/siteConfigStore';
import { confirmLeave } from '../../lib/unsaved';
import { watchAllProducts } from '../../lib/products';
import type { Product } from '../../types';

export interface AdminData {
  products: Product[];
  loading: boolean;
  error: string | null;
}

export const useAdminData = () => useOutletContext<AdminData>();

export default function AdminLayout() {
  const { user } = useAuth();
  const { config } = useSiteConfig();
  useEffect(() => {
    document.title = `Administration | ${config.company.name}`;
    return () => {
      document.title = `${config.company.name} | Product Catalog`;
    };
  }, [config.company.name]);

  // Sign out after 30 minutes without keyboard, mouse or touch activity.
  useEffect(() => {
    const IDLE_MS = 30 * 60 * 1000;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const events = ['mousemove', 'keydown', 'pointerdown', 'scroll', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - last > IDLE_MS) {
        try {
          sessionStorage.setItem('signout-reason', 'idle');
        } catch {
          /* message only */
        }
        signOut(auth);
      }
    }, 30 * 1000);
    return () => {
      clearInterval(t);
      events.forEach((ev) => window.removeEventListener(ev, bump));
    };
  }, []);
  const [data, setData] = useState<AdminData>({ products: [], loading: true, error: null });
  const [menu, setMenu] = useState(false);

  useEffect(
    () =>
      watchAllProducts(
        (products) => setData({ products, loading: false, error: null }),
        (e) => setData((d) => ({ ...d, loading: false, error: e.message })),
      ),
    [],
  );

  // Keep the public catalog index in step with the products this dashboard sees.
  // publishIndex() compares a hash first, so unchanged data causes no write.
  const [indexState, setIndexState] = useState<string | null>(null);
  const [indexPending, setIndexPending] = useState(false);
  useEffect(() => {
    if (data.loading || data.error) return;
    setIndexPending(true);
    const t = setTimeout(() => {
      publishIndex(data.products)
        .then((r) => setIndexState(r.written ? `Public catalog updated (${r.count} products)` : null))
        .catch((e) => setIndexState(`Public catalog index not updated: ${e.message}`))
        .finally(() => setIndexPending(false));
    }, 400);
    return () => clearTimeout(t);
  }, [data]);
  // Warn before leaving while the public catalog has not caught up with a change yet.
  useEffect(() => {
    if (!indexPending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [indexPending]);

  const links = [
    ['/admin', 'Dashboard'],
    ['/admin/products', 'Products'],
    ['/admin/taxonomy', 'Brands & categories'],
    ['/admin/import', 'Import / export'],
    ['/admin/price-list', 'PDF price list'],
    ['/admin/history', 'Audit history'],
    ['/admin/contacts', 'Contacts'],
    ['/admin/settings', 'Website settings'],
  ];

  return (
    <div className="admin">
      <aside className={`admin-nav ${menu ? 'open' : ''}`}>
        <div className="admin-brand">
          <span className="admin-logo-tile"><CompanyLogo config={config} className="admin-logo" /></span>
          <span>{config.company.name}<br /><small>Administration</small></span>
          <button className="menu-toggle" onClick={() => setMenu(!menu)} aria-label="Toggle menu">☰</button>
        </div>
        <nav onClick={() => setMenu(false)}>
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/admin'} onClick={(e) => { if (!confirmLeave()) e.preventDefault(); }}>{label}</NavLink>
          ))}
          <a href="/" target="_blank" rel="noopener noreferrer">View public site ↗</a>
        </nav>
        <div className="admin-user">
          <span title={user?.email ?? ''}>{user?.email}</span>
          <button className="btn btn-sm" onClick={() => confirmLeave() && signOut(auth)}>Sign out</button>
        </div>
      </aside>
      <section className="admin-main">
        {data.error && <div className="alert error">Could not load products: {data.error}</div>}
        {indexState && <div className={`alert ${indexState.startsWith('Public catalog index not') ? 'error' : 'ok'} small`} role="status">{indexState}</div>}
        <Outlet context={data} />
      </section>
    </div>
  );
}
