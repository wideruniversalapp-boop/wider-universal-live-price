import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CONTACT_LIMITS,
  newId,
  publicBranches,
  validateDirectory,
  type Branch,
  type BranchContact,
  type ContactDirectory,
} from '../../lib/contacts';
import { fetchDirectory, publishDirectory } from '../../lib/contactsStore';
import { useSiteConfig } from '../../lib/siteConfigStore';
import { setUnsavedCheck } from '../../lib/unsaved';
import { BranchCard } from '../ContactPage';

function move<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const n = [...list];
  [n[i], n[j]] = [n[j], n[i]];
  return n;
}

const blankContact = (): BranchContact => ({ id: newId('c'), name: '', role: '', phone: '', email: '' });

export default function ContactsAdmin() {
  const { config } = useSiteConfig();
  const [published, setPublished] = useState<ContactDirectory | null>(null);
  const [draft, setDraft] = useState<ContactDirectory | null>(null);
  const [exists, setExists] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const load = () =>
    fetchDirectory()
      .then(({ directory, exists: ex }) => {
        setPublished(directory);
        setDraft(structuredClone(directory));
        setExists(ex);
      })
      .catch((e) => setMessage({ type: 'error', text: `Could not load contacts: ${e.message}` }));
  useEffect(() => { load(); }, []);

  const errors = useMemo(() => (draft ? validateDirectory(draft) : {}), [draft]);
  const dirty = !!draft && !!published && JSON.stringify(draft) !== JSON.stringify(published);
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

  if (!draft || !published) return <div className="page-state">{message?.text ?? 'Loading contacts…'}</div>;

  const err = (path: string) => (showErrors ? errors[path] : undefined);
  const setBranch = (i: number, patch: Partial<Branch>) =>
    setDraft({ ...draft, branches: draft.branches.map((b, k) => (k === i ? { ...b, ...patch } : b)) });
  const setContact = (i: number, j: number, patch: Partial<BranchContact>) =>
    setBranch(i, { contacts: draft.branches[i].contacts.map((c, k) => (k === j ? { ...c, ...patch } : c)) });

  const save = async () => {
    setShowErrors(true);
    const n = Object.keys(errors).length;
    if (n) {
      setMessage({ type: 'error', text: `Please fix ${n} highlighted field(s). Nothing was saved; the contact page still shows the last published details.` });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await publishDirectory(draft, exists ? published : null, note);
      setNote('');
      setShowErrors(false);
      await load();
      setMessage({ type: 'ok', text: 'Saved and published. The contact page shows these details now.' });
    } catch (e) {
      setMessage({ type: 'error', text: `Save failed: ${(e as Error).message}. The contact page still shows the last published details.` });
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (!dirty || confirm('Discard all unsaved changes?')) {
      setDraft(structuredClone(published));
      setShowErrors(false);
      setMessage(null);
    }
  };

  const field = (label: string, value: string, onChange: (v: string) => void, path: string, max: number, opts: { type?: string; placeholder?: string; help?: string } = {}) => {
    const e = err(path);
    return (
      <label className={`field ${e ? 'has-error' : ''}`}>
        <span className="field-label">{label}</span>
        <input type={opts.type ?? 'text'} value={value} maxLength={max} placeholder={opts.placeholder} aria-invalid={!!e} onChange={(ev) => onChange(ev.target.value)} />
        {(e || opts.help) && <span className={e ? 'field-error' : 'muted small'}>{e ?? opts.help}</span>}
      </label>
    );
  };

  const preview = publicBranches(draft);

  return (
    <div className="settings-page contacts-admin">
      <div className="page-head">
        <h1>Contacts</h1>
        <span className={`pill ${dirty ? 'pill-draft' : 'pill-published'}`}>{dirty ? 'Unsaved changes' : exists ? 'Published' : 'Not published yet'}</span>
      </div>
      <p className="muted">Branches and sales contacts shown on the public <a href="/contact" target="_blank" rel="noopener noreferrer">Contact page</a>. Changes go live after <strong>Save and publish</strong>. Every save is recorded in Website settings → Change history.</p>
      {message && <div className={`alert ${message.type === 'error' ? 'error' : 'ok'}`} role="status">{message.text}</div>}

      <section className="panel settings-panel">
        <h2>Page text</h2>
        {field('Page heading', draft.title, (v) => setDraft({ ...draft, title: v }), 'title', CONTACT_LIMITS.title)}
        <label className={`field ${err('intro') ? 'has-error' : ''}`}>
          <span className="field-label">Introduction (optional)</span>
          <textarea rows={3} value={draft.intro} maxLength={CONTACT_LIMITS.intro} onChange={(e) => setDraft({ ...draft, intro: e.target.value })} />
          {err('intro') && <span className="field-error">{err('intro')}</span>}
        </label>
      </section>

      {draft.branches.map((b, i) => (
        <section className={`panel settings-panel branch-editor ${b.active ? '' : 'inactive'}`} key={b.id} aria-label={`Branch ${b.name || i + 1}`}>
          <div className="branch-editor-head">
            <h2>{b.name || 'New branch'} {!b.active && <span className="pill pill-archived">Hidden</span>}</h2>
            <div className="row-gap">
              <button type="button" className="btn btn-xs" disabled={i === 0} onClick={() => setDraft({ ...draft, branches: move(draft.branches, i, -1) })} aria-label="Move branch up">↑</button>
              <button type="button" className="btn btn-xs" disabled={i === draft.branches.length - 1} onClick={() => setDraft({ ...draft, branches: move(draft.branches, i, 1) })} aria-label="Move branch down">↓</button>
              <label className="toggle compact">
                <input type="checkbox" checked={b.active} onChange={(e) => setBranch(i, { active: e.target.checked })} />
                <span>Show on website</span>
              </label>
              <button type="button" className="btn btn-xs btn-danger" onClick={() => {
                if (confirm(`Delete the ${b.name || 'new'} branch and its ${b.contacts.length} contact(s)? You can untick "Show on website" instead to hide it temporarily.`))
                  setDraft({ ...draft, branches: draft.branches.filter((_, k) => k !== i) });
              }}>Delete branch</button>
            </div>
          </div>
          <div className="two">
            {field('Branch name', b.name, (v) => setBranch(i, { name: v }), `branches.${i}.name`, CONTACT_LIMITS.branchName, { placeholder: 'Jeddah Branch' })}
            {field('Location (optional)', b.location, (v) => setBranch(i, { location: v }), `branches.${i}.location`, CONTACT_LIMITS.location, { placeholder: 'Jeddah, Saudi Arabia' })}
          </div>
          {err(`branches.${i}.contacts`) && <span className="field-error">{err(`branches.${i}.contacts`)}</span>}
          {b.contacts.map((c, j) => (
            <fieldset className="contact-editor" key={c.id}>
              <legend>Contact {j + 1}</legend>
              <div className="contact-editor-grid">
                {field('Name', c.name, (v) => setContact(i, j, { name: v }), `branches.${i}.contacts.${j}.name`, CONTACT_LIMITS.name)}
                {field('Role (optional)', c.role, (v) => setContact(i, j, { role: v }), `branches.${i}.contacts.${j}.role`, CONTACT_LIMITS.role, { placeholder: 'e.g. Sales' })}
                {field('Telephone', c.phone, (v) => setContact(i, j, { phone: v }), `branches.${i}.contacts.${j}.phone`, CONTACT_LIMITS.phone, { type: 'tel', placeholder: '+966 51 121 1028' })}
                {field('Email', c.email, (v) => setContact(i, j, { email: v }), `branches.${i}.contacts.${j}.email`, CONTACT_LIMITS.email, { type: 'email', placeholder: 'name@wideruniversal.com' })}
              </div>
              <div className="row-gap">
                <button type="button" className="btn btn-xs" disabled={j === 0} onClick={() => setBranch(i, { contacts: move(b.contacts, j, -1) })}>Move up</button>
                <button type="button" className="btn btn-xs" disabled={j === b.contacts.length - 1} onClick={() => setBranch(i, { contacts: move(b.contacts, j, 1) })}>Move down</button>
                <button type="button" className="btn btn-xs" onClick={() => {
                  if (confirm(`Remove ${c.name || 'this contact'} from ${b.name || 'this branch'}?`)) setBranch(i, { contacts: b.contacts.filter((_, k) => k !== j) });
                }}>Remove contact</button>
              </div>
            </fieldset>
          ))}
          {b.contacts.length < CONTACT_LIMITS.contactsPerBranch && (
            <button type="button" className="btn btn-sm" onClick={() => setBranch(i, { contacts: [...b.contacts, blankContact()] })}>Add contact to this branch</button>
          )}
        </section>
      ))}

      {draft.branches.length < CONTACT_LIMITS.branches && (
        <button type="button" className="btn" onClick={() => setDraft({ ...draft, branches: [...draft.branches, { id: newId('b'), name: '', location: '', active: true, contacts: [blankContact()] }] })}>
          Add branch
        </button>
      )}

      <section className="panel settings-preview" aria-label="Preview">
        <h2>Preview</h2>
        <p className="muted small">Visible branches as they will appear on the Contact page. Hidden branches and contacts with invalid details are not shown.</p>
        {preview.length ? (
          <div className="branch-grid" ref={(el) => { if (el) el.inert = true; }}>
            {preview.map((b) => <BranchCard key={b.id} branch={b} companyName={config.company.name} />)}
          </div>
        ) : <p className="muted">No visible branches.</p>}
      </section>

      <div className="settings-actions">
        <input className="note-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Optional note for the change history" aria-label="Change note" />
        <button className="btn" onClick={cancel} disabled={!dirty || busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save and publish'}</button>
      </div>
    </div>
  );
}
