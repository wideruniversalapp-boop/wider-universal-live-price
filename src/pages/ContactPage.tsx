import { useEffect, useState } from 'react';
import { PublicShell } from '../components/Layout';
import { mailHref, publicBranches, telHref, type Branch, type ContactDirectory } from '../lib/contacts';
import { fetchDirectory } from '../lib/contactsStore';
import { useSiteConfig } from '../lib/siteConfigStore';

const Icon = {
  pin: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M6.6 3.5h2.6l1.4 4-2 1.4a11 11 0 0 0 6.5 6.5l1.4-2 4 1.4v2.6a1.6 1.6 0 0 1-1.7 1.6A16.6 16.6 0 0 1 5 5.2a1.6 1.6 0 0 1 1.6-1.7Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
  mail: (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="m4 6.5 8 6.2 8-6.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
};

export function BranchCard({ branch, companyName }: { branch: Branch; companyName: string }) {
  return (
    <article className="branch-card" aria-labelledby={`branch-${branch.id}`}>
      <header className="branch-head">
        <span className="branch-icon">{Icon.pin}</span>
        <div>
          <h2 id={`branch-${branch.id}`}>{branch.name}</h2>
          {branch.location && <p className="branch-location">{branch.location}</p>}
        </div>
      </header>
      {branch.contacts.map((c) => (
        <div className="branch-contact" key={c.id}>
          <p className="contact-name">{c.name}</p>
          {c.role && <p className="contact-role">{c.role}</p>}
          <dl className="contact-lines">
            {c.phone && (
              <div>
                <dt>{Icon.phone}<span className="sr-only">Telephone</span></dt>
                <dd className="contact-value">{c.phone}</dd>
              </div>
            )}
            {c.email && (
              <div>
                <dt>{Icon.mail}<span className="sr-only">Email</span></dt>
                <dd className="contact-value">{c.email}</dd>
              </div>
            )}
          </dl>
          <div className="contact-actions">
            {c.phone && (
              <a className="btn btn-primary" href={telHref(c.phone)} aria-label={`Call ${c.name}, ${branch.name}`}>
                {Icon.phone} Call
              </a>
            )}
            {c.email && (
              <a className="btn btn-outline" href={mailHref(c.email, `Enquiry for ${companyName} — ${branch.name}`)} aria-label={`Email ${c.name}, ${branch.name}`}>
                {Icon.mail} Email
              </a>
            )}
          </div>
        </div>
      ))}
    </article>
  );
}

export default function ContactPage() {
  const { config } = useSiteConfig();
  const [directory, setDirectory] = useState<ContactDirectory | null>(null);
  const [error, setError] = useState(false);

  const load = () => {
    setError(false);
    fetchDirectory()
      .then((r) => setDirectory(r.directory))
      .catch(() => setError(true));
  };
  useEffect(load, []);
  useEffect(() => {
    document.title = `Contact | ${config.company.name}`;
    return () => {
      document.title = `${config.company.name} | Product Catalog`;
    };
  }, [config.company.name]);

  const branches = directory ? publicBranches(directory) : [];

  return (
    <PublicShell>
      <section className="contact-hero">
        <div className="container">
          <p className="eyebrow-dark">Contact</p>
          <h1>{directory?.title ?? 'Contact our sales team'}</h1>
          {directory?.intro && <p className="contact-intro pre">{directory.intro}</p>}
        </div>
      </section>
      <section className="container contact-body" aria-label="Branches">
        {error && (
          <div className="state error" role="alert">
            <p>Contact details could not be loaded. Please try again.</p>
            <button className="btn" onClick={load}>Retry</button>
          </div>
        )}
        {!error && !directory && (
          <div className="branch-grid" aria-busy="true">
            {[0, 1, 2].map((i) => <div key={i} className="branch-card skeleton-card" />)}
          </div>
        )}
        {directory && branches.length === 0 && !error && (
          <div className="state">
            <p>Branch contact details are being updated.</p>
            {config.contact.email && <p>Please email <a href={mailHref(config.contact.email)}>{config.contact.email}</a>.</p>}
          </div>
        )}
        {branches.length > 0 && (
          <div className="branch-grid">
            {branches.map((b) => <BranchCard key={b.id} branch={b} companyName={config.company.name} />)}
          </div>
        )}
      </section>
    </PublicShell>
  );
}
