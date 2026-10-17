import { useId, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { fetchBrands } from '../lib/products';
import { isExternal, isHttpsUrl, isSafeLinkUrl, renderCopyright, splitCompanyName, whatsappHref, type NavLink, type SiteConfig } from '../lib/siteConfig';
import { CompanyLogo, useSiteConfig } from '../lib/siteConfigStore';
import { useQuote } from '../lib/quoteStore';

/** Renders an admin-configured link: same-site paths use the router, https links open in a new tab. */
export function ConfigLink({ link, className, onClick }: { link: NavLink; className?: string; onClick?: () => void }) {
  // Defence in depth: never render a link that is not https:// or a same-site path.
  if (!link?.label || typeof link.url !== 'string' || !isSafeLinkUrl(link.url)) return null;
  if (isExternal(link.url))
    return (
      <a className={className} href={link.url} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        {link.label}
      </a>
    );
  if (link.url.startsWith('#'))
    return (
      <a className={className} href={link.url} onClick={onClick}>
        {link.label}
      </a>
    );
  return (
    <Link className={className} to={link.url} onClick={onClick}>
      {link.label}
    </Link>
  );
}

export function Logo({ config, light = false, showName = true }: { config: SiteConfig; light?: boolean; showName?: boolean }) {
  const [primary, secondary] = splitCompanyName(config.company.name);
  return (
    <Link to="/" className={`logo ${light ? 'logo-light' : ''}`} aria-label={`${config.company.name} — catalog home`}>
      <CompanyLogo config={config} className="logo-img" />
      {showName && (
        <span className="wordmark" aria-hidden="true">
          <span className="wordmark-primary">{primary}</span>
          {secondary && <span className="wordmark-secondary">{secondary}</span>}
        </span>
      )}
    </Link>
  );
}

function HeaderSearch({ onDone }: { onDone?: () => void }) {
  const inputId = useId();
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(q.trim() ? `/?q=${encodeURIComponent(q.trim())}#catalog` : '/');
    onDone?.();
  };
  return (
    <form className="header-search" role="search" onSubmit={submit}>
      <label className="sr-only" htmlFor={inputId}>Search products</label>
      <input id={inputId} type="search" placeholder="Search model, SKU or name…" value={q} onChange={(e) => setQ(e.target.value)} />
      <button className="btn btn-sm btn-primary" type="submit">Search</button>
    </form>
  );
}

export function SiteHeader({ config, showSearch = true, slot }: { config: SiteConfig; showSearch?: boolean; slot?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const h = config.header;
  const { pathname } = useLocation();
  const quote = useQuote();
  return (
    <header className="site-header">
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="container header-row">
        {h.showLogo || h.showCompanyName ? (
          h.showLogo ? <Logo config={config} showName={h.showCompanyName} /> : (
            <Link to="/" className="logo"><span className="wordmark"><span className="wordmark-primary">{config.company.name}</span></span></Link>
          )
        ) : <Link to="/" className="sr-only">{config.company.name}</Link>}
        {slot ? <div className="header-slot">{slot}</div> : showSearch && <div className="header-search-wrap"><HeaderSearch /></div>}
        <button className="menu-toggle" aria-expanded={open} aria-controls="site-nav" aria-label="Menu" onClick={() => setOpen(!open)}>
          <span aria-hidden="true">☰</span>
        </button>
        <nav id="site-nav" className={open ? 'open' : ''} aria-label="Main">
          {showSearch && <div className="mobile-only"><HeaderSearch onDone={() => setOpen(false)} /></div>}
          {h.navLinks.map((l) => (
            <ConfigLink
              key={`${l.label}-${l.url}`}
              link={l}
              className={`nav-link ${l.url === pathname ? 'active' : ''}`}
              onClick={() => setOpen(false)}
            />
          ))}
          <Link to="/quote" className={`nav-link quote-link ${pathname === '/quote' ? 'active' : ''}`} onClick={() => setOpen(false)}>
            Quote list{quote.items.length > 0 && <span className="quote-count" aria-label={`${quote.items.length} items`}>{quote.items.length}</span>}
          </Link>
          {h.showMainWebsite && isHttpsUrl(config.company.mainWebsiteUrl) && (
            <a className="btn btn-sm btn-primary main-site-btn" href={config.company.mainWebsiteUrl} target="_blank" rel="noopener noreferrer">
              {h.mainWebsiteLabel}
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
                <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter({ config }: { config: SiteConfig }) {
  const f = config.footer;
  const [brands, setBrands] = useState<string[]>([]);
  useEffect(() => {
    if (!f.showBrandLinks) return;
    fetchBrands().then((b) => setBrands(b.map((x) => x.name))).catch(() => setBrands([]));
  }, [f.showBrandLinks]);
  const wa = whatsappHref(config, 'Hello Wider Universal, I have a product enquiry.');
  const c = config.contact;
  return (
    <footer className="site-footer" id="contact">
      <div className="container footer-grid">
        <div className="footer-brand">
          {f.showLogo && (
            <div className="footer-logo-tile">
              <CompanyLogo config={config} className="footer-logo" />
            </div>
          )}
          <p className="footer-company">{config.company.name}</p>
          {f.description && <p className="muted-light pre">{f.description}</p>}
          {f.showMainWebsite && isHttpsUrl(config.company.mainWebsiteUrl) && (
            <a className="footer-main-site" href={config.company.mainWebsiteUrl} target="_blank" rel="noopener noreferrer">
              {f.mainWebsiteLabel} <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
        <div>
          <h2 className="footer-h">{config.pages.contactTitle || 'Contact'}</h2>
          {config.pages.contactText && <p className="muted-light pre">{config.pages.contactText}</p>}
          <ul className="plain">
            {c.address && <li>{c.address}</li>}
            {c.phone && <li><a href={`tel:${c.phone.replace(/[^+0-9]/g, '')}`}>{c.phone}</a></li>}
            {c.email && <li><a href={`mailto:${c.email}`}>{c.email}</a></li>}
            {wa && <li><a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a></li>}
            <li><Link to="/contact" className="footer-strong-link">All branch contacts →</Link></li>
          </ul>
        </div>
        {(f.links.length > 0 || brands.length > 0) && (
          <div>
            <h2 className="footer-h">Catalog</h2>
            <ul className="plain">
              {f.links.map((l) => <li key={`${l.label}-${l.url}`}><ConfigLink link={l} /></li>)}
              {brands.map((b) => (
                <li key={b}><Link to={`/?brand=${encodeURIComponent(b)}#catalog`}>{b}</Link></li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="container copyright">
        <span>{renderCopyright(config)}</span>
        {f.social.length > 0 && (
          <span className="social">
            {f.social.filter((s) => isHttpsUrl(s.url)).map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a>
            ))}
          </span>
        )}
      </div>
    </footer>
  );
}

/** Floating summary of the visitor's quote list (hidden on the quote page itself). */
function QuoteBar() {
  const quote = useQuote();
  const { pathname } = useLocation();
  if (!quote.items.length || pathname === '/quote') return null;
  const units = quote.items.reduce((n, i) => n + i.qty, 0);
  return (
    <div className="quote-bar" role="region" aria-label="Quote list">
      <span className="quote-bar-text">
        <strong>Quote list · {quote.items.length} item{quote.items.length === 1 ? '' : 's'}</strong>
        <span>{units} unit{units === 1 ? '' : 's'} · send to your nearest branch</span>
      </span>
      <Link className="btn btn-sm quote-bar-btn" to="/quote">Review &amp; send</Link>
    </div>
  );
}

export function PublicShell({
  children,
  showHeaderSearch = true,
  headerSlot,
  hideQuoteBar = false,
  wide = false,
}: {
  children: ReactNode;
  showHeaderSearch?: boolean;
  /** Content for the middle of the header (the wide catalog puts its search there). */
  headerSlot?: ReactNode;
  /** Hide the floating quote bar (the wide catalog shows a quote list column instead). */
  hideQuoteBar?: boolean;
  /** Full-width header to match the wide catalog layout. */
  wide?: boolean;
}) {
  const { config } = useSiteConfig();
  return (
    <div className={`public ${wide ? 'is-wide' : ''}`}>
      <SiteHeader config={config} showSearch={showHeaderSearch} slot={headerSlot} />
      <main id="main" tabIndex={-1}>{children}</main>
      <SiteFooter config={config} />
      {!hideQuoteBar && <QuoteBar />}
    </div>
  );
}
