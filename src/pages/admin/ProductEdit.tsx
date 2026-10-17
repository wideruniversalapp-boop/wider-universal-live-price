import { doc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { auth, db, storage } from '../../firebase';
import { uniqueSorted } from '../../lib/catalogFilter';
import { formatSar, normalizeSku, productPriceDrop, STOCK_LABELS } from '../../lib/format';
import { PRICE_DROP_DAYS } from '../../lib/priceDrop';
import { blankProduct, newProductId } from '../../lib/importer';
import { commitProductWrites, deleteProduct, fetchHistory, fetchSource, productToInput } from '../../lib/products';
import type { ChangeSet, ProductInput, ProductSource, Spec, StockStatus } from '../../types';
import { useAdminData } from './AdminLayout';

function toDateInput(t: Timestamp | null): string {
  return t ? t.toDate().toISOString().slice(0, 10) : '';
}
function fromDateInput(s: string, endOfDay = false): Timestamp | null {
  if (!s) return null;
  return Timestamp.fromDate(new Date(`${s}T${endOfDay ? '23:59:59' : '00:00:00'}`));
}
function numOrNull(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export default function ProductEdit() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const { products, loading } = useAdminData();
  const existing = useMemo(() => products.find((p) => p.id === id) ?? null, [products, id]);
  const [form, setForm] = useState<ProductInput | null>(isNew ? blankProduct('') : null);
  const [priceText, setPriceText] = useState({ price: '', offer: '', qty: '' });
  const [featuresText, setFeaturesText] = useState('');
  const [source, setSource] = useState<ProductSource | null>(null);
  const [history, setHistory] = useState<ChangeSet[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  // Load the record once; later snapshot updates do not overwrite unsaved edits.
  useEffect(() => {
    if (isNew || !existing || form) return;
    const input = productToInput(existing);
    setForm(input);
    setPriceText({ price: input.price?.toString() ?? '', offer: input.offerPrice?.toString() ?? '', qty: input.stockQty?.toString() ?? '' });
    setFeaturesText(input.features.join('\n'));
  }, [existing, isNew, form]);

  useEffect(() => {
    if (!id) return;
    fetchSource(id).then((s) => { setSource(s); setReviewNote(s?.reviewNotes ?? ''); }).catch(() => setSource(null));
    fetchHistory(id).then(setHistory).catch(() => setHistory([]));
  }, [id, existing?.lastChangeId]);

  const brands = useMemo(() => uniqueSorted(products.map((p) => p.brand)), [products]);
  const categories = useMemo(() => uniqueSorted(products.map((p) => p.category)), [products]);

  if (loading) return <div className="page-state">Loading…</div>;
  if (!isNew && !existing) return <div className="page-state">Product not found. <Link to="/admin/products">Back</Link></div>;
  if (!form) return <div className="page-state">Loading…</div>;

  const upd = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) => setForm({ ...form, [k]: v });
  const setSpec = (i: number, patch: Partial<Spec>) => upd('specs', form.specs.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const validate = (f: ProductInput): string | null => {
    if (!f.sku.trim()) return 'SKU is required.';
    if (!f.name.trim()) return 'Name is required.';
    if (!f.brand.trim()) return 'Brand is required.';
    const clash = products.find((p) => p.id !== id && normalizeSku(p.sku) === normalizeSku(f.sku));
    if (clash) return `SKU ${f.sku} is already used by ${clash.model} (${clash.id}).`;
    if (Number.isNaN(f.price) || (f.price != null && f.price < 0)) return 'Price must be a non-negative number.';
    if (Number.isNaN(f.offerPrice) || (f.offerPrice != null && f.offerPrice < 0)) return 'Offer price must be a non-negative number.';
    if (f.offerPrice != null && f.price == null) return 'An offer price needs a regular price.';
    if (f.offerPrice != null && f.price != null && f.offerPrice >= f.price) return 'Offer price must be lower than the regular price.';
    if (Number.isNaN(f.stockQty) || (f.stockQty != null && (!Number.isInteger(f.stockQty) || f.stockQty < 0))) return 'Stock quantity must be a whole number ≥ 0.';
    if (f.offerStart && f.offerEnd && f.offerStart.toMillis() > f.offerEnd.toMillis()) return 'Offer start must be before the offer end.';
    for (const u of [f.datasheetUrl, f.sourceUrl]) if (u && !/^https?:\/\//i.test(u)) return `Invalid URL: ${u}`;
    return null;
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const next: ProductInput = {
      ...form,
      sku: form.sku.trim(),
      model: form.model.trim(),
      name: form.name.trim(),
      brand: form.brand.trim(),
      category: form.category.trim(),
      price: numOrNull(priceText.price),
      offerPrice: numOrNull(priceText.offer),
      stockQty: numOrNull(priceText.qty),
      features: featuresText.split('\n').map((s) => s.trim()).filter(Boolean),
      specs: form.specs.filter((s) => s.value.trim() || s.label.trim()),
    };
    const err = validate(next);
    if (err) return setMessage({ type: 'error', text: err });
    setBusy(true);
    setMessage(null);
    try {
      const pid = id ?? newProductId(next.sku, new Set(products.map((p) => p.id)));
      await commitProductWrites([{ id: pid, before: existing, after: next }], isNew ? 'create' : 'manual');
      setForm(next);
      setMessage({ type: 'ok', text: 'Saved. The public catalog reflects the change immediately.' });
      if (isNew) navigate(`/admin/products/${pid}`, { replace: true });
    } catch (e2) {
      setMessage({ type: 'error', text: `Save failed: ${(e2 as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (file: File) => {
    if (!id) return setMessage({ type: 'error', text: 'Save the product before uploading an image.' });
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return setMessage({ type: 'error', text: 'Use a PNG, JPEG, WebP or GIF image.' });
    if (file.size > 5 * 1024 * 1024) return setMessage({ type: 'error', text: 'Image must be smaller than 5 MB.' });
    setBusy(true);
    try {
      const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
      const path = `products/${id}/${Date.now()}.${ext}`;
      const r = ref(storage, path);
      await uploadBytes(r, file, { contentType: file.type, cacheControl: 'public,max-age=31536000' });
      const url = await getDownloadURL(r);
      const oldPath = form.imagePath;
      const next = { ...form, imageUrl: url, imagePath: path };
      await commitProductWrites([{ id, before: existing, after: { ...productToInput(existing!), imageUrl: url, imagePath: path } }], 'manual');
      setForm(next);
      if (oldPath && oldPath !== path) await deleteObject(ref(storage, oldPath)).catch(() => undefined);
      setMessage({ type: 'ok', text: 'Image updated.' });
    } catch (e) {
      setMessage({ type: 'error', text: `Upload failed: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    if (!confirm(`Permanently delete ${existing.model}? Consider archiving instead — archived products keep their history.`)) return;
    setBusy(true);
    try {
      await deleteProduct(existing.id);
      if (existing.imagePath) await deleteObject(ref(storage, existing.imagePath)).catch(() => undefined);
      navigate('/admin/products');
    } catch (e) {
      setMessage({ type: 'error', text: `Delete failed: ${(e as Error).message}` });
      setBusy(false);
    }
  };

  const saveReview = async (verification: string) => {
    if (!id || !source) return;
    try {
      await updateDoc(doc(db, 'productSources', id), {
        verification,
        reviewNotes: reviewNote,
        reviewedBy: auth.currentUser!.uid,
        reviewedAt: serverTimestamp(),
      });
      setSource({ ...source, verification, reviewNotes: reviewNote });
      setMessage({ type: 'ok', text: 'Verification status saved.' });
    } catch (e) {
      setMessage({ type: 'error', text: `Could not save review: ${(e as Error).message}` });
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>{isNew ? 'Add product' : `Edit ${existing?.model}`}</h1>
        <div className="row-gap">
          {existing?.status === 'published' && <a className="btn btn-sm" href={`/product/${existing.id}`} target="_blank" rel="noopener noreferrer">View public page ↗</a>}
          <Link className="btn btn-sm" to="/admin/products">Back to list</Link>
        </div>
      </div>
      {message && <div className={`alert ${message.type === 'error' ? 'error' : 'ok'}`}>{message.text}</div>}

      <form className="edit-grid" onSubmit={save}>
        <fieldset>
          <legend>Identification</legend>
          <label>SKU *<input required value={form.sku} onChange={(e) => upd('sku', e.target.value)} /></label>
          <label>Model number<input value={form.model} onChange={(e) => upd('model', e.target.value)} /></label>
          <label>Name *<input required value={form.name} onChange={(e) => upd('name', e.target.value)} /></label>
          <label>Brand *
            <input required list="brand-list" value={form.brand} onChange={(e) => upd('brand', e.target.value)} />
            <datalist id="brand-list">{brands.map((b) => <option key={b} value={b} />)}</datalist>
          </label>
          <label>Category
            <input list="cat-list" value={form.category} onChange={(e) => upd('category', e.target.value)} />
            <datalist id="cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label>Subcategory<input value={form.subcategory} onChange={(e) => upd('subcategory', e.target.value)} /></label>
          <label>Visibility
            <select value={form.status} onChange={(e) => upd('status', e.target.value as ProductInput['status'])}>
              <option value="published">Published (visible to public)</option>
              <option value="draft">Draft (hidden)</option>
              <option value="archived">Archived (hidden)</option>
            </select>
          </label>
          <label>Sort order<input type="number" value={form.sortOrder} onChange={(e) => upd('sortOrder', Number(e.target.value) || 0)} /></label>
        </fieldset>

        <fieldset>
          <legend>Wider Universal pricing (SAR)</legend>
          <label>Selling price<input inputMode="decimal" placeholder="blank = price on request" value={priceText.price} onChange={(e) => setPriceText({ ...priceText, price: e.target.value })} /></label>
          {(() => {
            const drop = existing ? productPriceDrop({ ...existing, previousPrice: form.previousPrice }) : null;
            const lowered = existing?.price != null && numOrNull(priceText.price) != null && (numOrNull(priceText.price) as number) < existing.price;
            return drop ? (
              <p className="drop-note">
                Showing <strong>PRICE ↓ {drop.pct}%</strong> (was {formatSar(drop.previous)}) until {drop.until.toLocaleDateString('en-GB')}.{' '}
                <button type="button" className="link-button" onClick={() => upd('previousPrice', null)}>Remove tag</button>
              </p>
            ) : lowered ? (
              <p className="drop-note">Saving this lower price shows a “PRICE ↓” tag in the catalog for {PRICE_DROP_DAYS} days.</p>
            ) : null;
          })()}
          <label>Promotional price<input inputMode="decimal" placeholder="blank = no offer" value={priceText.offer} onChange={(e) => setPriceText({ ...priceText, offer: e.target.value })} /></label>
          <div className="two">
            <label>Offer starts<input type="date" value={toDateInput(form.offerStart)} onChange={(e) => upd('offerStart', fromDateInput(e.target.value))} /></label>
            <label>Offer ends<input type="date" value={toDateInput(form.offerEnd)} onChange={(e) => upd('offerEnd', fromDateInput(e.target.value, true))} /></label>
          </div>
          <label>Offer text<input value={form.offerText} onChange={(e) => upd('offerText', e.target.value)} placeholder="e.g. Minimum order 5 pcs" /></label>
          <legend className="sub">Availability</legend>
          <label>Stock status
            <select value={form.stockStatus} onChange={(e) => upd('stockStatus', e.target.value as StockStatus)}>
              {Object.entries(STOCK_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Stock quantity (optional)<input inputMode="numeric" value={priceText.qty} onChange={(e) => setPriceText({ ...priceText, qty: e.target.value })} /></label>
        </fieldset>

        <fieldset className="wide">
          <legend>Description &amp; features</legend>
          <label>Description<textarea rows={4} value={form.description} onChange={(e) => upd('description', e.target.value)} /></label>
          <label>Feature lines (one per line)<textarea rows={6} value={featuresText} onChange={(e) => setFeaturesText(e.target.value)} /></label>
        </fieldset>

        <fieldset className="wide">
          <legend>Technical specifications</legend>
          <table className="spec-edit">
            <thead><tr><th>Label</th><th>Value</th><th>Source</th><th>Source URL</th><th /></tr></thead>
            <tbody>
              {form.specs.map((s, i) => (
                <tr key={i}>
                  <td><input value={s.label} onChange={(e) => setSpec(i, { label: e.target.value })} placeholder="Resolution" /></td>
                  <td><input value={s.value} onChange={(e) => setSpec(i, { value: e.target.value })} placeholder="8 MP (3840 × 2160)" /></td>
                  <td><input value={s.source ?? ''} onChange={(e) => setSpec(i, { source: e.target.value })} placeholder="manufacturer datasheet" /></td>
                  <td><input value={s.sourceUrl ?? ''} onChange={(e) => setSpec(i, { sourceUrl: e.target.value })} placeholder="https://" /></td>
                  <td><button type="button" className="btn btn-sm" onClick={() => upd('specs', form.specs.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn-sm" onClick={() => upd('specs', [...form.specs, { label: '', value: '', source: '', sourceUrl: '' }])}>Add specification</button>
          <label>Datasheet URL<input value={form.datasheetUrl} onChange={(e) => upd('datasheetUrl', e.target.value)} placeholder="https://" /></label>
          <label>Internal reference URL (not shown publicly)<input value={form.sourceUrl} onChange={(e) => upd('sourceUrl', e.target.value)} placeholder="https://" /></label>
        </fieldset>

        <div className="form-actions wide">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create product' : 'Save changes'}</button>
          {!isNew && <button type="button" className="btn btn-danger" disabled={busy} onClick={remove}>Delete permanently</button>}
        </div>
      </form>

      {!isNew && (
        <div className="edit-grid">
          <fieldset>
            <legend>Image</legend>
            {form.imageUrl ? <img className="edit-image" src={form.imageUrl} alt="" /> : <p className="muted">No image.</p>}
            <label className="btn btn-sm file-btn">
              {form.imageUrl ? 'Replace image' : 'Upload image'}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} />
            </label>
          </fieldset>

          <fieldset>
            <legend>Source &amp; verification (admin only)</legend>
            {source ? (
              <>
                <p className="muted small">Reference data captured from {source.system} on {source.extractedAt?.slice(0, 10)}. Never shown publicly.</p>
                <dl className="kv">
                  <dt>Source model (exact)</dt><dd><code>{source.modelExact}</code></dd>
                  <dt>Source price</dt><dd>{formatSar(source.price)} {source.discountPct ? `(-${source.discountPct}%, regular ${formatSar(source.regularPriceComputed)})` : ''}</dd>
                  {source.pdfListPrice != null && (
                    <>
                      <dt>PDF list price</dt>
                      <dd>
                        {formatSar(source.pdfListPrice)} <span className="muted small">(“{source.pdfPriceText}”)</span>
                      </dd>
                      <dt>PDF reference</dt>
                      <dd className="small">
                        {source.pdfFile}, page {source.pdfPage}, row {source.pdfRow}
                        <br />
                        <span className={`pill ${source.pdfMatchStatus === 'EXACT_MATCH' ? 'pill-published' : 'pill-draft'}`}>{source.pdfMatchStatus}</span>{' '}
                        <span className="muted">{source.pdfMatchMethod}</span>
                      </dd>
                    </>
                  )}
                  <dt>Source category</dt><dd>{source.category} / {source.subcategory}</dd>
                  {source.offerDescription && (<><dt>Source offer</dt><dd>{source.offerDescription}</dd></>)}
                  <dt>Issues</dt><dd>{source.issues?.length ? source.issues.join(', ') : 'none'}</dd>
                  <dt>Verification</dt><dd><strong>{source.verification}</strong></dd>
                </dl>
                <label>Review notes<textarea rows={2} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} /></label>
                <div className="row-gap">
                  <button type="button" className="btn btn-sm" onClick={() => saveReview('VERIFIED')}>Mark verified</button>
                  <button type="button" className="btn btn-sm" onClick={() => saveReview('REQUIRES VERIFICATION')}>Requires verification</button>
                </div>
              </>
            ) : (
              <p className="muted">Created manually — no source record.</p>
            )}
          </fieldset>

          <fieldset className="wide">
            <legend>Change history</legend>
            {history.length === 0 ? <p className="muted">No recorded changes.</p> : (
              <table className="data-table compact">
                <thead><tr><th>When</th><th>Who</th><th>Type</th><th>Field</th><th>From</th><th>To</th></tr></thead>
                <tbody>
                  {history.flatMap((h) =>
                    h.changes.filter((c) => c.productId === id).map((c, i) => (
                      <tr key={`${h.id}-${i}`}>
                        <td>{h.at?.toDate().toLocaleString('en-GB')}</td>
                        <td>{h.byEmail}</td>
                        <td>{h.reason}</td>
                        <td>{c.field}</td>
                        <td className="clip">{String(c.from ?? '—')}</td>
                        <td className="clip">{String(c.to ?? '—')}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            )}
          </fieldset>
        </div>
      )}
    </div>
  );
}
