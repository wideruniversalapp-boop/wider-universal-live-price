import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ref, uploadBytes } from 'firebase/storage';
import { storage } from '../../firebase';
import { SiteFooter, SiteHeader } from '../../components/Layout';
import { useAuth } from '../../lib/auth';
import {
  DEFAULT_LOGO_PATH,
  DEFAULT_SITE_CONFIG,
  LIMITS,
  validateSiteConfig,
  type NavLink,
  type SiteConfig,
} from '../../lib/siteConfig';
import {
  fetchAdminUsers,
  fetchSettingsHistory,
  fetchSiteConfig,
  logoUrl,
  publishSiteConfig,
  useSiteConfig,
  type SettingsChange,
} from '../../lib/siteConfigStore';
import { setUnsavedCheck } from '../../lib/unsaved';
import { useAdminData } from './AdminLayout';

type Tab = 'branding' | 'header' | 'footer' | 'pages' | 'contact' | 'pdf' | 'history' | 'security';
const TABS: [Tab, string][] = [
  ['branding', 'Company branding'],
  ['header', 'Header'],
  ['footer', 'Footer'],
  ['pages', 'Page content'],
  ['contact', 'Contact information'],
  ['pdf', 'PDF branding'],
  ['history', 'Change history'],
  ['security', 'Security & access'],
];

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Checks the file signature, not just the extension or reported type. */
async function sniffImage(file: File): Promise<'png' | 'jpg' | 'webp' | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'webp';
  return null;
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;

function get(c: SiteConfig, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], c);
}
function set(c: SiteConfig, path: string, value: unknown): SiteConfig {
  const next = structuredClone(c);
  const keys = path.split('.');
  let o = next as unknown as Record<string, unknown>;
  keys.slice(0, -1).forEach((k) => (o = o[k] as Record<string, unknown>));
  o[keys[keys.length - 1]] = value;
  return next;
}


interface FormApi {
  draft: SiteConfig;
  upd: (path: string, value: unknown) => void;
  err: (path: string) => string | undefined;
}
const FormCtx = createContext<FormApi>(null as unknown as FormApi);

function Field({ path, label, help, max, multiline, type = 'text', placeholder }: { path: string; label: string; help?: string; max: number; multiline?: boolean; type?: string; placeholder?: string }) {
  const { draft, upd, err } = useContext(FormCtx);
  const v = String(get(draft, path) ?? '');
  const e = err(path);
  const id = `f-${path}`;
  return (
    <div className={`field ${e ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea id={id} rows={4} value={v} maxLength={max} placeholder={placeholder} aria-invalid={!!e} aria-describedby={`${id}-h`} onChange={(ev) => upd(path, ev.target.value)} />
      ) : (
        <input id={id} type={type} value={v} maxLength={max} placeholder={placeholder} aria-invalid={!!e} aria-describedby={`${id}-h`} onChange={(ev) => upd(path, ev.target.value)} />
      )}
      <div id={`${id}-h`} className="field-help">
        {e ? <span className="field-error">{e}</span> : help}
        <span className="count">{v.length}/{max}</span>
      </div>
    </div>
  );
}
function Toggle({ path, label, help }: { path: string; label: string; help?: string }) {
  const { draft, upd } = useContext(FormCtx);
  return (
    <label className="toggle">
      <input type="checkbox" checked={Boolean(get(draft, path))} onChange={(e) => upd(path, e.target.checked)} />
      <span>{label}{help && <small>{help}</small>}</span>
    </label>
  );
}
function Choice({ path, label, help, options }: { path: string; label: string; help?: string; options: { value: string | number; label: string }[] }) {
  const { draft, upd, err } = useContext(FormCtx);
  const v = get(draft, path) as string | number;
  const e = err(path);
  const id = `f-${path}`;
  return (
    <div className={`field ${e ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={String(v)}
        onChange={(ev) => {
          const opt = options.find((o) => String(o.value) === ev.target.value);
          if (opt) upd(path, opt.value);
        }}
      >
        {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
      <div className="field-help">{e ? <span className="field-error">{e}</span> : help}</div>
    </div>
  );
}

function Links({ path, label, help, max, httpsOnly }: { path: string; label: string; help: string; max: number; httpsOnly?: boolean }) {
  const { draft, upd, err } = useContext(FormCtx);
  const list = (get(draft, path) as NavLink[]) ?? [];
  const setList = (l: NavLink[]) => upd(path, l);
  return (
    <div className={`field ${err(path) ? 'has-error' : ''}`}>
      <span className="field-label">{label}</span>
      <p className="muted small">{help}</p>
      {list.map((l, i) => (
        <div className="link-row" key={i}>
          <input aria-label={`${label} ${i + 1} label`} value={l.label} maxLength={LIMITS.short} placeholder="Label" onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <input aria-label={`${label} ${i + 1} address`} value={l.url} maxLength={LIMITS.url} placeholder={httpsOnly ? 'https://…' : '/page, #section or https://…'} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, url: e.target.value.trim() } : x)))} />
          <button type="button" className="btn btn-xs" disabled={i === 0} onClick={() => { const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setList(n); }} aria-label="Move up">↑</button>
          <button type="button" className="btn btn-xs" onClick={() => setList(list.filter((_, j) => j !== i))}>Remove</button>
          {(err(`${path}.${i}.label`) || err(`${path}.${i}.url`)) && (
            <span className="field-error link-err">{err(`${path}.${i}.label`) ?? err(`${path}.${i}.url`)}</span>
          )}
        </div>
      ))}
      {list.length < max && <button type="button" className="btn btn-sm" onClick={() => setList([...list, { label: '', url: httpsOnly ? 'https://' : '/' }])}>Add link</button>}
      {err(path) && <span className="field-error">{err(path)}</span>}
    </div>
  );
}
function Section({ title, children, desc }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="panel settings-panel">
      <h2>{title}</h2>
      {desc && <p className="muted small">{desc}</p>}
      {children}
    </section>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const { products } = useAdminData();
  const site = useSiteConfig();
  const [published, setPublished] = useState<SiteConfig | null>(null);
  const [draft, setDraft] = useState<SiteConfig | null>(null);
  const [tab, setTab] = useState<Tab>('branding');
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [history, setHistory] = useState<SettingsChange[] | null>(null);
  const [admins, setAdmins] = useState<{ uid: string; email: string }[] | null>(null);
  const [claims, setClaims] = useState<Record<string, unknown> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = () =>
    fetchSiteConfig()
      .then((c) => {
        const { lastChangeId: _l, ...clean } = c;
        setPublished(clean);
        setDraft(structuredClone(clean));
      })
      .catch((e) => setMessage({ type: 'error', text: `Could not load settings: ${e.message}` }));
  useEffect(() => { load(); }, []);

  const errors = useMemo(() => (draft ? validateSiteConfig(draft) : {}), [draft]);
  const dirty = !!draft && !!published && JSON.stringify(draft) !== JSON.stringify(published);
  const errorCount = Object.keys(errors).length;

  // Unsaved-changes protection: admin navigation and closing the tab.
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    setUnsavedCheck(() => dirtyRef.current);
    const warn = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      setUnsavedCheck(null);
      window.removeEventListener('beforeunload', warn);
    };
  }, []);

  useEffect(() => {
    if (tab === 'history') fetchSettingsHistory().then(setHistory).catch((e) => setMessage({ type: 'error', text: e.message }));
    if (tab === 'security') {
      fetchAdminUsers().then(setAdmins).catch(() => setAdmins([]));
      user?.getIdTokenResult().then((t) => setClaims(t.claims)).catch(() => setClaims(null));
    }
  }, [tab, user]);

  if (!draft || !published) return <div className="page-state">{message ? message.text : 'Loading settings…'}</div>;

  const upd = (path: string, value: unknown) => setDraft(set(draft, path, value));
  const err = (path: string) => (showErrors || get(draft, path) !== get(published, path) ? errors[path] : undefined);

  const save = async () => {
    setShowErrors(true);
    if (errorCount) {
      setMessage({ type: 'error', text: `Please fix ${errorCount} highlighted field(s). Nothing was saved; the website still uses the last published settings.` });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await publishSiteConfig(draft, published, note);
      setNote('');
      setLogoPreview(null);
      await load();
      site.reload();
      setShowErrors(false);
      setMessage({ type: 'ok', text: 'Saved and published. The website and the next PDF price list use these settings now.' });
    } catch (e) {
      setMessage({ type: 'error', text: `Save failed: ${(e as Error).message}. The website still uses the last published settings.` });
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (!dirty || confirm('Discard all unsaved changes?')) {
      setDraft(structuredClone(published));
      setLogoPreview(null);
      setShowErrors(false);
      setMessage(null);
    }
  };

  const restoreDefaults = () => {
    if (!confirm('Load the default settings into the editor? This includes the default logo. Nothing changes on the website until you click "Save and publish".')) return;
    setDraft({ ...structuredClone(DEFAULT_SITE_CONFIG), version: draft.version });
    setMessage({ type: 'ok', text: 'Defaults loaded into the editor. Review them, then Save and publish — or Cancel to keep the current settings.' });
  };

  const onLogo = async (file: File) => {
    setMessage(null);
    try {
      if (file.size > MAX_LOGO_BYTES) throw new Error('The logo must be smaller than 2 MB.');
      const kind = await sniffImage(file);
      if (!kind) throw new Error('Only PNG, JPEG or WebP images are accepted (the file content was checked, not just its name).');
      const bmp = await createImageBitmap(file).catch(() => {
        throw new Error('The image could not be decoded. Please export it again as PNG.');
      });
      if (bmp.width < 64 || bmp.height < 64) throw new Error(`The image is too small (${bmp.width}×${bmp.height}); use at least 64×64 pixels, ideally 400 pixels or more.`);
      const path = `branding/logo-${Date.now()}.${kind}`;
      setBusy(true);
      await uploadBytes(ref(storage, path), file, { contentType: MIME[kind], cacheControl: 'public,max-age=31536000' });
      setLogoPreview(URL.createObjectURL(file));
      upd('company.logoPath', path);
      setMessage({ type: 'ok', text: `Logo uploaded (${bmp.width}×${bmp.height}). Check the preview, then click "Save and publish". Until then the current logo stays live.` });
    } catch (e) {
      setMessage({ type: 'error', text: `Logo not changed: ${(e as Error).message}` });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const samplePdf = async () => {
    const { downloadPriceList } = await import('../../lib/pdf');
    const sample = products.filter((p) => p.status === 'published').slice(0, 25);
    const warning = await downloadPriceList(sample, draft, { title: `${draft.pdf.title} (sample)`, includeStock: draft.catalog.showStock, includeFeatures: false });
    setMessage(warning ? { type: 'error', text: warning } : { type: 'ok', text: 'Sample PDF generated with the settings in the editor (25 products).' });
  };

  const currentLogo = logoPreview ?? logoUrl(draft.company.logoPath);

  return (
    <FormCtx.Provider value={{ draft, upd, err }}>
    <div className="settings-page">
      <div className="page-head">
        <h1>Website settings</h1>
        <span className={`pill ${dirty ? 'pill-draft' : 'pill-published'}`}>{dirty ? 'Unsaved changes' : 'Published'}</span>
      </div>
      <p className="muted">Company branding, header, footer, page texts and PDF branding. Changes go live when you click <strong>Save and publish</strong> — no code change or redeploy needed. Text is shown exactly as typed; HTML is not allowed.</p>

      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {label}
            {Object.keys(errors).some((p) => (k === 'contact' ? p.startsWith('contact.') : k === 'branding' ? p.startsWith('company.') : k === 'pages' ? p.startsWith('pages.') || p.startsWith('catalog.') : p.startsWith(`${k}.`))) && showErrors && <span className="tab-dot" aria-label="has errors" />}
          </button>
        ))}
      </div>

      {message && <div className={`alert ${message.type === 'error' ? 'error' : 'ok'}`} role="status">{message.text}</div>}

      {tab === 'branding' && (
        <Section title="Company branding" desc="Used in the header, footer, browser title and every PDF price list.">
          <Field path="company.name" label="Company name" max={LIMITS.name} />
          <Field path="company.tagline" label="Short tagline (optional)" max={LIMITS.line} help="Shown under the company name in PDFs." />
          <Field path="company.description" label="Company description" max={LIMITS.long} multiline help="General description of the company." />
          <Field path="company.mainWebsiteUrl" label="Main website address" type="url" max={LIMITS.url} help="Must start with https://. Linked from the header, footer and PDFs." placeholder="https://wideruniversal.com/" />
          <div className="field">
            <span className="field-label">Logo</span>
            <div className="logo-editor">
              <div className="logo-preview-tile"><img src={currentLogo} alt="Logo preview" /></div>
              <div>
                <p className="muted small">PNG, JPEG or WebP, up to 2 MB, at least 64×64 px (400 px+ recommended). SVG is not accepted. The new logo goes live only after <strong>Save and publish</strong>; if the upload fails, the current logo stays.</p>
                <div className="row-gap">
                  <label className="btn btn-sm file-btn">
                    Upload new logo…
                    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && onLogo(e.target.files[0])} />
                  </label>
                  {draft.company.logoPath !== DEFAULT_LOGO_PATH && (
                    <button type="button" className="btn btn-sm" onClick={() => { upd('company.logoPath', DEFAULT_LOGO_PATH); setLogoPreview(null); }}>Use the original Wider Universal logo</button>
                  )}
                </div>
                <p className="muted small">Current file: <code>{draft.company.logoPath}</code></p>
              </div>
            </div>
          </div>
          <Field path="company.logoAlt" label="Logo description for screen readers (alt text)" max={LIMITS.line} />
        </Section>
      )}

      {tab === 'header' && (
        <Section title="Header" desc="The bar at the top of every public page.">
          <Toggle path="header.showLogo" label="Show logo" />
          <Toggle path="header.showCompanyName" label="Show company name next to the logo" />
          <Toggle path="header.showMainWebsite" label="Show the Main Website button" help={`Opens ${draft.company.mainWebsiteUrl} in a new tab. The address is set under Company branding.`} />
          <Field path="header.mainWebsiteLabel" label="Main Website button label" max={LIMITS.short} />
          <Links path="header.navLinks" label="Navigation links" max={LIMITS.navLinks} help="Page paths such as / or /?offers=1#catalog, /contact for the branch contact page, page sections such as #catalog, or full https:// addresses (open in a new tab)." />
        </Section>
      )}

      {tab === 'footer' && (
        <Section title="Footer" desc="The navy section at the bottom of every public page.">
          <Toggle path="footer.showLogo" label="Show logo" />
          <Field path="footer.description" label="Footer description" max={LIMITS.long} multiline />
          <Toggle path="footer.showMainWebsite" label="Show the Main Website link" />
          <Field path="footer.mainWebsiteLabel" label="Main Website link label" max={LIMITS.short} />
          <Links path="footer.links" label="Footer links" max={LIMITS.footerLinks} help="Shown in the Catalog column." />
          <Toggle path="footer.showBrandLinks" label="List product brands in the footer" help="Taken from Brands & categories." />
          <Field path="footer.copyright" label="Copyright text" max={LIMITS.line} help="{year} is replaced with the current year." />
          <Links path="footer.social" label="Social media links (optional)" max={LIMITS.social} httpsOnly help="Only add verified company accounts. Full https:// addresses only." />
        </Section>
      )}

      {tab === 'pages' && (
        <Section title="Page content" desc="Texts on the catalog home page. Leave optional fields empty to hide them.">
          <Field path="pages.heroEyebrow" label="Small heading above the title (optional)" max={120} />
          <Field path="pages.heroTitle" label="Home page title" max={LIMITS.line} />
          <Field path="pages.heroText" label="Home page introduction" max={LIMITS.medium} multiline />
          <Field path="pages.catalogIntro" label="Catalog introduction (optional)" max={LIMITS.medium} multiline help="Shown above the search and filters." />
          <Field path="pages.aboutTitle" label="About section title (optional)" max={120} />
          <Field path="pages.aboutText" label="About section text (optional)" max={LIMITS.long} multiline help="Shown below the catalog when filled in." />
          <Toggle path="catalog.showStock" label="Show stock availability on the website and in PDFs" />
          <h3 className="settings-subhead">Catalog layout on wide screens</h3>
          <Choice
            path="catalog.layout"
            label="Layout"
            help="Automatic: wide screens get filters · products · quote list in three columns; smaller screens get the standard layout. Standard: the centred layout with the brand spotlight on every screen."
            options={[
              { value: 'auto', label: 'Automatic (wide layout on wide screens)' },
              { value: 'standard', label: 'Standard everywhere' },
            ]}
          />
          {draft.catalog.layout === 'auto' && (
            <>
              <Choice
                path="catalog.wideMinWidth"
                label="Use the wide layout on screens at least…"
                help="Typical sizes: 1440 px large laptops, 1600 px+ desktop monitors, 1920 px full-HD monitors."
                options={[
                  { value: 1440, label: '1,440 px wide' },
                  { value: 1600, label: '1,600 px wide (recommended)' },
                  { value: 1920, label: '1,920 px wide' },
                ]}
              />
              <Toggle
                path="catalog.visitorLayoutSwitch"
                label="Let visitors switch between Wide and Standard"
                help="Shows a small Wide / Standard switch above the products on wide screens. Each visitor's choice is remembered in their own browser only."
              />
            </>
          )}
        </Section>
      )}

      {tab === 'contact' && (
        <Section title="Contact information" desc="Shown in the footer, on product pages and in PDFs. Use only approved company details.">
          <Field path="contact.phone" label="Telephone" max={LIMITS.short} placeholder="+966 55 482 2231" />
          <Field path="contact.whatsapp" label="WhatsApp number" max={20} help="Digits only, including country code (e.g. 966554822231). Leave empty to hide WhatsApp buttons." />
          <Field path="contact.email" label="Email" type="email" max={LIMITS.name} />
          <Field path="contact.address" label="Address / location" max={LIMITS.medium} />
          <Field path="pages.contactTitle" label="Contact section heading" max={120} />
          <Field path="pages.contactText" label="Contact section text (optional)" max={LIMITS.long} multiline />
        </Section>
      )}

      {tab === 'pdf' && (
        <Section title="PDF branding" desc="Applied to every PDF price list (public download and admin generator). Company name, logo and website come from Company branding.">
          <Toggle path="pdf.showLogo" label="Show the logo" />
          <Field path="pdf.title" label="Default PDF title" max={120} />
          <Field path="pdf.tagline" label="PDF tagline (optional)" max={LIMITS.line} help="Leave empty to use the company tagline." />
          <Toggle path="pdf.showContact" label="Show contact details in the page header" />
          <Toggle path="pdf.showWebsite" label="Show the main website address" />
          <Field path="pdf.footerText" label="Footer text on every page" max={LIMITS.url} multiline />
          <button type="button" className="btn btn-sm" onClick={samplePdf} disabled={errorCount > 0}>Download a sample PDF with these settings</button>
        </Section>
      )}

      {tab === 'history' && (
        <Section title="Change history" desc="Every published change, with the administrator and time. Records cannot be edited or deleted.">
          {!history ? <p>Loading…</p> : history.length === 0 ? <p className="muted">No changes recorded yet.</p> : (
            <div className="table-wrap">
              <table className="data-table compact">
                <thead><tr><th>When</th><th>Administrator</th><th>Changed</th><th>Note</th><th /></tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td>{h.at?.toDate().toLocaleString('en-GB')}</td>
                      <td>{h.byEmail}</td>
                      <td className="small">{h.changed.join(', ')}</td>
                      <td className="small">{h.note}</td>
                      <td>
                        {'company' in (h.after ?? {}) ? (<>
                        <button type="button" className="btn btn-xs" onClick={() => {
                          if (confirm('Load this version into the editor? You can review it and then Save and publish.')) {
                            setDraft({ ...structuredClone(h.after), version: draft.version });
                            setTab('branding');
                          }
                        }}>Load this version</button>{' '}
                        {h.before && 'company' in h.before && (
                          <button type="button" className="btn btn-xs" onClick={() => {
                            if (confirm('Load the settings as they were before this change? You can review them and then Save and publish.')) {
                              setDraft({ ...structuredClone(h.before!), version: draft.version });
                              setTab('branding');
                            }
                          }}>Load version before this change</button>
                        )}
                        </>) : <span className="muted small">Contacts change — see Admin → Contacts</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {tab === 'security' && (
        <Section title="Security & access" desc="How administrator access is controlled.">
          <dl className="kv">
            <dt>Signed in as</dt><dd>{user?.email}</dd>
            <dt>Administrator claim</dt><dd>{claims?.admin === true ? 'Yes (verified server-side on every request)' : 'Checking…'}</dd>
            <dt>Session</dt><dd>Ends when the browser closes, after 30 minutes of inactivity, or on Sign out. Access is re-checked every 10 minutes.</dd>
          </dl>
          <h3>Administrators</h3>
          {!admins ? <p>Loading…</p> : (
            <ul className="plain">{admins.map((a) => <li key={a.uid}>{a.email || a.uid}</li>)}</ul>
          )}
          <p className="small muted">
            There is no public sign-up. To add or remove an administrator, the system owner creates the user in Firebase Authentication and runs
            <code> npm run set-admin -- --project &lt;id&gt; --email person@company.com</code> (add <code>--revoke</code> to remove access). Roles can only be granted server-side.
          </p>
          <h3>Recommendations</h3>
          <ul className="small">
            <li>Turn on multi-factor authentication for administrator accounts (Firebase Authentication with Identity Platform → SMS or TOTP second factor).</li>
            <li>Enable email enumeration protection and disable public sign-up in Firebase Authentication settings.</li>
            <li>Use a unique password of at least 12 characters; use “Forgot password?” on the sign-in page to reset it.</li>
          </ul>
        </Section>
      )}

      {tab !== 'history' && tab !== 'security' && (
        <section className="panel settings-preview" aria-label="Preview">
          <h2>Preview</h2>
          <p className="muted small">How the header and footer will look after publishing (links are inactive here).</p>
          <div className="preview-frame" ref={(el) => { if (el) el.inert = true; }}>
            <SiteHeader config={draft} showSearch={false} />
            <div className="preview-gap">…page content…</div>
            <SiteFooter config={draft} />
          </div>
        </section>
      )}

      <div className="settings-actions">
        <input className="note-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Optional note for the change history" aria-label="Change note" />
        <button className="btn" onClick={cancel} disabled={!dirty || busy}>Cancel</button>
        <button className="btn" onClick={restoreDefaults} disabled={busy}>Restore defaults…</button>
        <button className="btn btn-primary" onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save and publish'}</button>
      </div>
    </div>
    </FormCtx.Provider>
  );
}
