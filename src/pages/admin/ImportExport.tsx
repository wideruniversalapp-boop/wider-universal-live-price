import { addDoc, collection, doc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { auth, db } from '../../firebase';
import { planImport, productToRow, TEMPLATE_COLUMNS, type ImportPlan, type PlannedRow } from '../../lib/importer';
import { commitProductWrites, fetchAllSources, productToInput, toProduct, type ProductWrite } from '../../lib/products';
import { exportRows, readSpreadsheet } from '../../lib/sheets';
import type { ImportJob, Product } from '../../types';
import { useAdminData } from './AdminLayout';

const CHUNK = 150;

export default function ImportExport() {
  const { products } = useAdminData();
  const [fileName, setFileName] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [view, setView] = useState<PlannedRow['action'] | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [jobs, setJobs] = useState<ImportJob[]>([]);

  const loadJobs = () =>
    getDocs(query(collection(db, 'importJobs'), orderBy('createdAt', 'desc'), limit(20)))
      .then((s) => setJobs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ImportJob, 'id'>) }))))
      .catch(() => setJobs([]));
  useEffect(() => { loadJobs(); }, []);

  const onFile = async (file: File) => {
    setMessage(null);
    setPlan(null);
    setFileName(file.name);
    try {
      const rows = await readSpreadsheet(file);
      if (!rows.length) throw new Error('The file has no data rows.');
      setPlan(planImport(rows, products));
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message });
    }
  };

  const visible = useMemo(() => (plan ? plan.rows.filter((r) => view === 'all' || r.action === view) : []), [plan, view]);

  const commit = async () => {
    if (!plan) return;
    const actionable = plan.rows.filter((r) => r.action === 'create' || r.action === 'update');
    if (!actionable.length) return setMessage({ type: 'error', text: 'Nothing to import.' });
    if (!confirm(`Import ${plan.counts.create} new and ${plan.counts.update} updated products? Rows with errors (${plan.counts.error}) are not imported.`)) return;
    const user = auth.currentUser!;
    setBusy('Recording import job');
    let jobId = '';
    try {
      const jobRef = await addDoc(collection(db, 'importJobs'), {
        by: user.uid,
        byEmail: user.email ?? '',
        fileName,
        createdAt: serverTimestamp(),
        status: 'committing',
        created: plan.counts.create,
        updated: plan.counts.update,
        skipped: plan.counts.skip,
        failed: plan.counts.error,
        errors: plan.rows.filter((r) => r.action === 'error').slice(0, 500).map((r) => ({ row: r.row, sku: r.sku, message: r.errors.join('; ') })),
        changeSetIds: [],
      });
      jobId = jobRef.id;
      // Recovery data: the state of every touched product before the import.
      for (let i = 0; i < actionable.length; i += CHUNK) {
        const batch = writeBatch(db);
        batch.set(doc(collection(db, 'importJobs', jobId, 'chunks')), {
          items: actionable.slice(i, i + CHUNK).map((r) => ({ id: r.id, before: r.before ? productToInput(r.before) : null })),
        });
        await batch.commit();
      }
      const writes: ProductWrite[] = actionable.map((r) => ({ id: r.id!, before: r.before ?? null, after: r.after! }));
      const ids = await commitProductWrites(writes, 'import', jobId, (d, t) => setBusy(`Writing products ${d}/${t}`));
      await updateDoc(jobRef, { status: 'completed', changeSetIds: ids });
      setMessage({ type: 'ok', text: `Import complete: ${plan.counts.create} created, ${plan.counts.update} updated, ${plan.counts.skip} unchanged, ${plan.counts.error} failed.` });
      setPlan(null);
    } catch (e) {
      if (jobId) await updateDoc(doc(db, 'importJobs', jobId), { status: 'failed' }).catch(() => undefined);
      setMessage({ type: 'error', text: `Import stopped: ${(e as Error).message}. Completed batches were saved; use Revert on the job to undo them.` });
    } finally {
      setBusy(null);
      loadJobs();
    }
  };

  const revert = async (job: ImportJob) => {
    if (!confirm(`Revert import "${job.fileName}"? Updated products return to their previous values; products it created are archived.`)) return;
    setBusy('Reverting');
    try {
      const chunks = await getDocs(collection(db, 'importJobs', job.id, 'chunks'));
      const current = new Map(products.map((p) => [p.id, p]));
      const writes: ProductWrite[] = [];
      chunks.docs.forEach((c) =>
        (c.data().items as { id: string; before: Product | null }[]).forEach((it) => {
          const now = current.get(it.id);
          if (!now) return;
          writes.push({
            id: it.id,
            before: now,
            after: it.before ? productToInput(toProduct(it.id, it.before)) : { ...productToInput(now), status: 'archived' },
          });
        }),
      );
      await commitProductWrites(writes, 'revert', job.id, (d, t) => setBusy(`Reverting ${d}/${t}`));
      await updateDoc(doc(db, 'importJobs', job.id), { status: 'reverted' });
      setMessage({ type: 'ok', text: `Reverted ${writes.length} product(s).` });
    } catch (e) {
      setMessage({ type: 'error', text: `Revert failed: ${(e as Error).message}` });
    } finally {
      setBusy(null);
      loadJobs();
    }
  };

  const exportAll = async (format: 'xlsx' | 'csv', withSource: boolean) => {
    const rows: Record<string, unknown>[] = products.map(productToRow);
    const cols: string[] = [...TEMPLATE_COLUMNS, 'status', 'id'];
    products.forEach((p, i) => Object.assign(rows[i], { status: p.status, id: p.id }));
    if (withSource) {
      setBusy('Loading source data');
      const src = await fetchAllSources().finally(() => setBusy(null));
      cols.push('reference_source_price_sar', 'reference_source_model', 'reference_extracted_at', 'verification', 'pdf_list_price_sar', 'pdf_reference', 'pdf_match_status');
      products.forEach((p, i) => {
        const s = src.get(p.id);
        Object.assign(rows[i], {
          reference_source_price_sar: s?.price ?? '',
          reference_source_model: s?.modelExact ?? '',
          reference_extracted_at: s?.extractedAt ?? '',
          verification: s?.verification ?? '',
          pdf_list_price_sar: s?.pdfListPrice ?? '',
          pdf_reference: s?.pdfFile ? `${s.pdfFile} p.${s.pdfPage} #${s.pdfRow}` : '',
          pdf_match_status: s?.pdfMatchStatus ?? '',
        });
      });
    }
    exportRows(rows, cols, `wider-universal-catalog-${new Date().toISOString().slice(0, 10)}${withSource ? '-internal' : ''}`, format);
  };

  return (
    <div>
      <h1>Import / export</h1>
      {message && <div className={`alert ${message.type === 'error' ? 'error' : 'ok'}`}>{message.text}</div>}
      {busy && <div className="alert">{busy}…</div>}

      <section className="panel">
        <h2>1. Template</h2>
        <p className="muted">
          Columns: <code>{TEMPLATE_COLUMNS.join(', ')}</code>. Rows are matched to existing products by SKU (spaces ignored, case-insensitive).
          Blank cells keep the current value. <code>specifications</code> uses <code>Label: value; Label: value</code>.
          <code>stock_status</code>: in_stock, low_stock, out_of_stock, on_request. <code>active</code>: true/false. An <code>offer_price_sar</code> of 0 removes the offer.
        </p>
        <div className="row-gap">
          <button className="btn btn-sm" onClick={() => exportRows([], [...TEMPLATE_COLUMNS], 'wider-universal-import-template', 'xlsx')}>Download template (Excel)</button>
          <button className="btn btn-sm" onClick={() => exportRows([], [...TEMPLATE_COLUMNS], 'wider-universal-import-template', 'csv')}>Download template (CSV)</button>
        </div>
      </section>

      <section className="panel">
        <h2>2. Upload and preview</h2>
        <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} disabled={!!busy} />
        {plan && (
          <>
            <div className="stats small-stats">
              {(['create', 'update', 'skip', 'error'] as const).map((k) => (
                <button key={k} className={`stat ${view === k ? 'active' : ''}`} onClick={() => setView(view === k ? 'all' : k)}>
                  <span className="stat-value">{plan.counts[k]}</span>
                  <span className="stat-label">{{ create: 'New', update: 'Updates', skip: 'Unchanged', error: 'Errors' }[k]}</span>
                </button>
              ))}
            </div>
            {plan.unknownColumns.length > 0 && <div className="alert">Ignored columns: {plan.unknownColumns.join(', ')}</div>}
            {plan.missingColumns.length > 0 && <div className="alert error">Missing required column: {plan.missingColumns.join(', ')}</div>}
            <div className="table-wrap">
              <table className="data-table compact">
                <thead><tr><th>Row</th><th>SKU</th><th>Action</th><th>Details</th></tr></thead>
                <tbody>
                  {visible.slice(0, 500).map((r) => (
                    <tr key={r.row} className={`row-${r.action}`}>
                      <td>{r.row}</td>
                      <td><code>{r.sku}</code></td>
                      <td>{r.action}</td>
                      <td>{r.action === 'error' ? r.errors.join('; ') : r.changedFields.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visible.length > 500 && <p className="muted small">Showing first 500 of {visible.length} rows.</p>}
            <div className="row-gap">
              <button className="btn btn-primary" disabled={!!busy || plan.counts.create + plan.counts.update === 0} onClick={commit}>
                Import {plan.counts.create + plan.counts.update} product(s)
              </button>
              <button className="btn" onClick={() => setPlan(null)}>Cancel</button>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Export catalog</h2>
        <div className="row-gap">
          <button className="btn btn-sm" onClick={() => exportAll('xlsx', false)}>Full catalog (Excel)</button>
          <button className="btn btn-sm" onClick={() => exportAll('csv', false)}>Full catalog (CSV)</button>
          <button className="btn btn-sm" onClick={() => exportAll('xlsx', true)}>Internal export with source reference prices (Excel)</button>
        </div>
        <p className="muted small">Filtered or selected exports are available on the Products page. The internal export contains reference prices — do not share it with customers.</p>
      </section>

      {jobs.some((j) => j.type === 'pdf-price') && (
        <section className="panel">
          <h2>PDF price import — rows needing review</h2>
          <p className="muted small">
            Prices read from supplier PDFs are matched to products by SKU / model (see <code>PDF_PRICE_IMPORT_GUIDE.md</code>).
            Only exact and verified matches are applied. The rows below were not applied; set these prices manually after checking the PDF.
          </p>
          {jobs.filter((j) => j.type === 'pdf-price').slice(0, 1).map((j) =>
            j.review?.length ? (
              <div className="table-wrap" key={j.id}>
                <table className="data-table compact">
                  <thead><tr><th>Status</th><th>Model (PDF)</th><th>PDF price</th><th>PDF file / page / row</th><th>Product</th><th>Why</th></tr></thead>
                  <tbody>
                    {j.review.map((r, i) => (
                      <tr key={i}>
                        <td><span className="pill pill-draft">{r.status}</span></td>
                        <td><code>{r.model}</code></td>
                        <td>{r.priceText}</td>
                        <td className="small">{r.file}<br />p.{r.page} #{r.row}</td>
                        <td>{r.productId ? <Link to={`/admin/products/${r.productId}`}>Open product</Link> : '—'}</td>
                        <td className="small">{r.warnings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p key={j.id}>All PDF rows were matched and applied.</p>
            ),
          )}
        </section>
      )}

      <section className="panel">
        <h2>Import history</h2>
        <table className="data-table compact">
          <thead><tr><th>When</th><th>File</th><th>By</th><th>Created</th><th>Updated</th><th>Unchanged</th><th>Failed</th><th>Status</th><th /></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{j.createdAt?.toDate().toLocaleString('en-GB')}</td>
                <td className="clip" title={j.fileName}>{j.type === 'pdf-price' ? <span className="pill pill-published">PDF</span> : null} {j.fileName}</td>
                <td>{j.byEmail}</td>
                <td>{j.created}</td>
                <td>{j.updated}</td>
                <td>{j.skipped}</td>
                <td title={j.errors?.map((e) => `row ${e.row}: ${e.message}`).join('\n')}>{j.failed}</td>
                <td>{j.status}{j.referenceOnly ? ' (reference prices only)' : ''}</td>
                <td>{(j.status === 'completed' || j.status === 'failed') && <button className="btn btn-xs" disabled={!!busy} onClick={() => revert(j)}>Revert</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
