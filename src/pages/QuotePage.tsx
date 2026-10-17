import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicShell } from '../components/Layout';
import { mailHref, publicBranches, type Branch } from '../lib/contacts';
import { fetchDirectory } from '../lib/contactsStore';
import { formatSar } from '../lib/format';
import { buildMessage, MAILTO_SAFE_LENGTH, mailtoQuote, totals, whatsappTo, type QuoteCustomer } from '../lib/quote';
import { useQuote } from '../lib/quoteStore';
import { useSiteConfig } from '../lib/siteConfigStore';

const CUSTOMER_KEY = 'wu-quote-customer-v1';

function loadCustomer(): QuoteCustomer {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOMER_KEY) ?? '{}');
    return { name: String(v.name ?? ''), company: String(v.company ?? ''), phone: String(v.phone ?? ''), notes: '' };
  } catch {
    return { name: '', company: '', phone: '', notes: '' };
  }
}

export default function QuotePage() {
  const { config } = useSiteConfig();
  const quote = useQuote();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [target, setTarget] = useState('');
  const [customer, setCustomer] = useState<QuoteCustomer>(loadCustomer);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = `Quote list | ${config.company.name}`;
    fetchDirectory()
      .then((r) => setBranches(publicBranches(r.directory)))
      .catch(() => setBranches([]));
    return () => {
      document.title = `${config.company.name} | Product Catalog`;
    };
  }, [config.company.name]);

  useEffect(() => {
    try {
      const { notes: _n, ...keep } = customer;
      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(keep));
    } catch {
      /* convenience only */
    }
  }, [customer]);

  const contacts = useMemo(
    () => (branches ?? []).flatMap((b) => b.contacts.map((c) => ({ key: `${b.id}:${c.id}`, branch: b.name, ...c }))),
    [branches],
  );
  const chosen = contacts.find((c) => c.key === target) ?? contacts[0];
  const t = totals(quote.items);
  const message = buildMessage(quote.items, customer, chosen?.branch ?? '', config.company.name);
  const wa = chosen?.phone ? whatsappTo(chosen.phone, message) : null;
  const mail = chosen?.email ? mailtoQuote(chosen.email, `Quotation request — ${quote.items.length} item(s)`, message) : null;
  const mailTooLong = !!mail && mail.length > MAILTO_SAFE_LENGTH;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <PublicShell>
      <section className="contact-hero">
        <div className="container">
          <p className="eyebrow-dark">Quote list</p>
          <h1>Request a quotation</h1>
          <p className="contact-intro">Review the products and quantities, then send the list to your nearest branch by WhatsApp or email. Prices shown are current list prices; the branch confirms the final quotation.</p>
        </div>
      </section>

      <section className="container quote-body">
        {quote.items.length === 0 ? (
          <div className="state empty">
            <h2>Your quote list is empty</h2>
            <p>Open a product in the catalog and choose “Add to quote list”.</p>
            <Link className="btn btn-primary" to="/">Browse the catalog</Link>
          </div>
        ) : (
          <div className="quote-grid">
            <div className="quote-items">
              <div className="group-head">
                <h2><span className="group-mark" aria-hidden="true" />YOUR PRODUCTS</h2>
                <span className="group-count">{quote.items.length} item{quote.items.length === 1 ? '' : 's'} · {t.units} unit{t.units === 1 ? '' : 's'}</span>
              </div>
              <ul className="quote-list">
                {quote.items.map((i) => (
                  <li key={i.id} className="quote-item">
                    <div className="quote-item-main">
                      <Link to={`/product/${i.id}`} className="row-model">{i.model}</Link>
                      <span className="row-brand">{i.brand}</span>
                      <span className="quote-item-name">{i.name}</span>
                    </div>
                    <div className="qty-ctrl" role="group" aria-label={`Quantity for ${i.model}`}>
                      <button type="button" aria-label="Decrease quantity" onClick={() => quote.setQty(i.id, i.qty - 1)} disabled={i.qty <= 1}>−</button>
                      <input type="number" min={1} max={9999} value={i.qty} aria-label={`Quantity for ${i.model}`} onChange={(e) => quote.setQty(i.id, Number(e.target.value) || 1)} />
                      <button type="button" aria-label="Increase quantity" onClick={() => quote.setQty(i.id, i.qty + 1)}>+</button>
                    </div>
                    <div className="quote-item-price">
                      {i.unitPrice == null ? <span className="muted small">On request</span> : (
                        <>
                          <strong>{formatSar(i.unitPrice * i.qty)}</strong>
                          <span className="muted small">{formatSar(i.unitPrice)} each</span>
                        </>
                      )}
                    </div>
                    <button type="button" className="link-button remove" onClick={() => quote.remove(i.id)} aria-label={`Remove ${i.model}`}>Remove</button>
                  </li>
                ))}
              </ul>
              <div className="quote-total">
                <span>List total{t.onRequest ? ` (+ ${t.onRequest} item${t.onRequest === 1 ? '' : 's'} on request)` : ''}</span>
                <strong>{formatSar(t.priced)}</strong>
              </div>
              <div className="row-gap">
                <Link className="btn" to="/">Add more products</Link>
                <button type="button" className="btn" onClick={() => confirm('Remove all products from your quote list?') && quote.clear()}>Clear list</button>
              </div>
            </div>

            <aside className="quote-send" aria-label="Send your request">
              <h2>Send to a branch</h2>
              {!branches ? <p className="muted">Loading branches…</p> : contacts.length === 0 ? (
                <p className="muted">Branch contacts are being updated. {config.contact.email && <>Email <a href={mailHref(config.contact.email)}>{config.contact.email}</a>.</>}</p>
              ) : (
                <label className="field">
                  <span className="field-label">Branch and contact</span>
                  <select value={chosen?.key ?? ''} onChange={(e) => setTarget(e.target.value)}>
                    {contacts.map((c) => <option key={c.key} value={c.key}>{c.branch} — {c.name}</option>)}
                  </select>
                </label>
              )}
              <fieldset className="quote-customer">
                <legend>Your details (optional)</legend>
                <label className="field"><span className="field-label">Name</span><input value={customer.name} maxLength={80} autoComplete="name" onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></label>
                <label className="field"><span className="field-label">Company</span><input value={customer.company} maxLength={120} autoComplete="organization" onChange={(e) => setCustomer({ ...customer, company: e.target.value })} /></label>
                <label className="field"><span className="field-label">Phone</span><input type="tel" value={customer.phone} maxLength={30} autoComplete="tel" onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} /></label>
                <label className="field"><span className="field-label">Notes</span><textarea rows={3} value={customer.notes} maxLength={600} placeholder="Delivery city, project name, timeline…" onChange={(e) => setCustomer({ ...customer, notes: e.target.value })} /></label>
              </fieldset>
              <div className="quote-actions">
                {wa && <a className="btn btn-primary btn-block" href={wa} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>}
                {mail && !mailTooLong && <a className="btn btn-outline btn-block" href={mail}>Send by email</a>}
                <button type="button" className="btn btn-block" onClick={copy}>{copied ? 'Copied ✓' : 'Copy request text'}</button>
              </div>
              {mailTooLong && chosen?.email && (
                <p className="muted small">This list is too long for an email link. Copy the request and paste it into an email to <a href={mailHref(chosen.email)}>{chosen.email}</a>.</p>
              )}
              <p className="muted small">Your list and details stay in this browser. Nothing is sent until you choose WhatsApp or email.</p>
            </aside>
          </div>
        )}
      </section>
    </PublicShell>
  );
}
