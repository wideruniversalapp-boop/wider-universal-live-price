import { doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { useEffect, useRef, useState } from 'react';
import { db, storage } from '../../firebase';
import { logoUrl } from '../../lib/siteConfigStore';
import type { Brand } from '../../types';

const MAX_BYTES = 5 * 1024 * 1024;
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;

async function sniff(file: File): Promise<'png' | 'jpg' | 'webp' | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'webp';
  return null;
}

/** Headline, subtitle and banner image shown when a brand is selected on the catalog home. */
export default function BrandSpotlightEditor({ brands, onSaved }: { brands: Brand[]; onSaved: () => void }) {
  const [id, setId] = useState('');
  const brand = brands.find((b) => b.id === id) ?? brands[0];
  const [headline, setHeadline] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [bannerPath, setBannerPath] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!brand) return;
    setHeadline(brand.headline ?? '');
    setSubtitle(brand.subtitle ?? '');
    setBannerPath(brand.bannerPath ?? '');
    setPreview(null);
    setMessage(null);
  }, [brand?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when another brand is chosen

  if (!brand) return null;
  const dirty = headline !== (brand.headline ?? '') || subtitle !== (brand.subtitle ?? '') || bannerPath !== (brand.bannerPath ?? '');

  const upload = async (f: File) => {
    setMessage(null);
    try {
      if (f.size > MAX_BYTES) throw new Error('The banner must be smaller than 5 MB.');
      const kind = await sniff(f);
      if (!kind) throw new Error('Only PNG, JPEG or WebP images are accepted.');
      const bmp = await createImageBitmap(f).catch(() => {
        throw new Error('The image could not be read.');
      });
      if (bmp.width < 600) throw new Error(`The banner is ${bmp.width}px wide; use at least 600px (1200px or more recommended).`);
      setBusy(true);
      const path = `brands/${brand.id}/banner-${Date.now()}.${kind}`;
      await uploadBytes(ref(storage, path), f, { contentType: MIME[kind], cacheControl: 'public,max-age=31536000' });
      setBannerPath(path);
      setPreview(URL.createObjectURL(f));
      setMessage({ type: 'ok', text: 'Banner uploaded. Click Save to show it on the website.' });
    } catch (e) {
      setMessage({ type: 'error', text: `Banner not changed: ${(e as Error).message}` });
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };

  const save = async () => {
    if (headline.length > 120 || subtitle.length > 300) return setMessage({ type: 'error', text: 'Headline max 120 and subtitle max 300 characters.' });
    if (/<\s*\/?\s*[a-z!]/i.test(headline + subtitle)) return setMessage({ type: 'error', text: 'HTML is not allowed.' });
    setBusy(true);
    try {
      await updateDoc(doc(db, 'brands', brand.id), { headline: headline.trim(), subtitle: subtitle.trim(), bannerPath });
      setMessage({ type: 'ok', text: `Saved. The ${brand.name} spotlight on the catalog is updated.` });
      onSaved();
    } catch (e) {
      setMessage({ type: 'error', text: `Save failed: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const shown = preview ?? (bannerPath ? logoUrl(bannerPath) : null);

  return (
    <section className="panel settings-panel">
      <h2>Brand spotlight</h2>
      <p className="muted small">Shown at the top of the catalog when a visitor selects a brand. Leave empty to use the brand name and a picture strip of its products.</p>
      <label className="field">
        <span className="field-label">Brand</span>
        <select value={brand.id} onChange={(e) => setId(e.target.value)}>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Headline (optional)</span>
        <input value={headline} maxLength={120} placeholder={`${brand.name} products`} onChange={(e) => setHeadline(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Subtitle (optional)</span>
        <textarea rows={2} value={subtitle} maxLength={300} onChange={(e) => setSubtitle(e.target.value)} />
      </label>
      <div className="field">
        <span className="field-label">Banner image (optional)</span>
        {shown ? <img className="banner-preview" src={shown} alt={`${brand.name} banner preview`} /> : <p className="muted small">No banner — product pictures are shown instead.</p>}
        <div className="row-gap">
          <label className="btn btn-sm file-btn">
            Upload banner…
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          {bannerPath && <button type="button" className="btn btn-sm" onClick={() => { setBannerPath(''); setPreview(null); }}>Remove banner</button>}
        </div>
        <p className="muted small">PNG, JPEG or WebP, up to 5 MB, landscape, at least 600px wide.</p>
      </div>
      {message && <div className={`alert ${message.type === 'error' ? 'error' : 'ok'}`} role="status">{message.text}</div>}
      <div className="row-gap">
        <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </section>
  );
}
