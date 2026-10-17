import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PublicShell } from '../components/Layout';
import { useSiteConfig } from '../lib/siteConfigStore';

export default function NotFound() {
  const { config } = useSiteConfig();
  useEffect(() => {
    document.title = `Page not found | ${config.company.name}`;
    return () => {
      document.title = `${config.company.name} | Product Catalog`;
    };
  }, [config.company.name]);

  return (
    <PublicShell>
      <div className="page-state">
        <h1>Page not found</h1>
        <p className="muted">The page you are looking for does not exist or has moved.</p>
        <Link className="btn btn-primary" to="/">Go to catalog</Link>
      </div>
    </PublicShell>
  );
}
