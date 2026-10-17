import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { Product } from '../types';
import { activeOffer, STOCK_LABELS } from './format';
import { DEFAULT_LOGO_PDF_PATH, type SiteConfig } from './siteConfig';

export interface PriceListOptions {
  title?: string;
  includeStock: boolean;
  includeFeatures: boolean;
  /** Restrict to these categories (empty = all). */
  categories?: string[];
  /** Restrict to these brands (empty = all). */
  brands?: string[];
}

/** Logo already rasterised to PNG, with its pixel size so the aspect ratio is preserved. */
export interface PdfLogo {
  dataUrl: string;
  width: number;
  height: number;
}

const NAVY: [number, number, number] = [11, 42, 91];
const GREY: [number, number, number] = [90, 99, 115];
const HEADER_H = 34; // mm reserved at the top of every page
const FOOTER_H = 16;

function money(v: number | null): string {
  return v == null ? 'On request' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Builds the price list from public catalog records and the published site configuration.
 * The `Product` type carries Wider Universal selling prices only; reference/source prices
 * live in an admin-only collection and are never passed here.
 */
export function buildPriceList(products: Product[], config: SiteConfig, opts: PriceListOptions, logo: PdfLogo | null = null): jsPDF {
  const list = products
    .filter((p) => p.status === 'published')
    .filter((p) => !opts.categories?.length || opts.categories.includes(p.category))
    .filter((p) => !opts.brands?.length || opts.brands.includes(p.brand))
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.category.localeCompare(b.category) || a.model.localeCompare(b.model));

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  pdf.setProperties({ title: `${config.company.name} — ${opts.title ?? config.pdf.title}`, author: config.company.name, creator: config.company.name });
  const generated = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const left = 14;
  const right = pageW - 14;
  const title = opts.title ?? config.pdf.title;
  const tagline = config.pdf.tagline || config.company.tagline;
  const contactLine = [config.contact.address, config.contact.phone, config.contact.email].filter(Boolean).join('  |  ');

  const header = () => {
    let x = left;
    if (config.pdf.showLogo && logo) {
      const h = 20;
      const w = Math.min(40, (logo.width / logo.height) * h);
      const hh = (logo.height / logo.width) * w; // keep aspect ratio
      pdf.addImage(logo.dataUrl, 'PNG', left, 7 + (h - hh) / 2, w, hh, 'company-logo', 'FAST');
      x = left + w + 5;
    }
    const textW = right - 58 - x;
    pdf.setTextColor(...NAVY);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12.5);
    pdf.text(pdf.splitTextToSize(config.company.name, textW)[0], x, 12.5);
    let y = 17;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(...GREY);
    if (tagline) {
      pdf.text(pdf.splitTextToSize(tagline, textW)[0], x, y);
      y += 4;
    }
    if (config.pdf.showContact && contactLine) {
      pdf.text(pdf.splitTextToSize(contactLine, textW)[0], x, y);
      y += 4;
    }
    if (config.pdf.showWebsite) {
      pdf.setTextColor(...NAVY);
      pdf.textWithLink(config.company.mainWebsiteUrl, x, y, { url: config.company.mainWebsiteUrl });
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(...NAVY);
    pdf.text(pdf.splitTextToSize(title, 56)[0], right, 12.5, { align: 'right' });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(...GREY);
    pdf.text(`Generated ${generated}`, right, 17, { align: 'right' });
    pdf.setDrawColor(...NAVY);
    pdf.setLineWidth(0.4);
    pdf.line(left, HEADER_H - 3, right, HEADER_H - 3);
  };

  const head = ['Brand', 'Model / SKU', 'Product', 'Price (SAR)', 'Offer (SAR)'];
  if (opts.includeStock) head.push('Availability');

  let lastGroup = '';
  const body: (string | { content: string; colSpan: number; styles: object })[][] = [];
  for (const p of list) {
    const group = `${p.brand} — ${p.category || 'Uncategorised'}`;
    if (group !== lastGroup) {
      body.push([{ content: group, colSpan: head.length, styles: { fillColor: [232, 237, 245], textColor: NAVY, fontStyle: 'bold' } }]);
      lastGroup = group;
    }
    let name = p.name;
    if (opts.includeFeatures && p.features.length) name += '\n• ' + p.features.slice(0, 4).join('\n• ');
    const row = [
      p.brand,
      p.model === p.sku || !p.sku ? p.model : `${p.model}\n${p.sku}`,
      name,
      money(p.price),
      activeOffer(p) ? money(p.offerPrice) : '',
    ];
    if (opts.includeStock) row.push(STOCK_LABELS[p.stockStatus]);
    body.push(row);
  }

  autoTable(pdf, {
    head: [head],
    body,
    startY: HEADER_H,
    margin: { top: HEADER_H, left, right: 14, bottom: FOOTER_H + 2 },
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.6, valign: 'top', overflow: 'linebreak' },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 249, 251] },
    rowPageBreak: 'avoid',
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 38, fontStyle: 'bold' },
      3: { cellWidth: 20, halign: 'right' },
      4: { cellWidth: 20, halign: 'right', textColor: [21, 128, 61] },
      ...(opts.includeStock ? { 5: { cellWidth: 22 } } : {}),
    },
    didDrawPage: () => header(),
  });

  if (!list.length) {
    pdf.setPage(1);
    pdf.setFontSize(11);
    pdf.setTextColor(...GREY);
    pdf.text('No products match the selected options.', left, HEADER_H + 20);
  }

  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setDrawColor(217, 223, 232);
    pdf.setLineWidth(0.2);
    pdf.line(left, pageH - FOOTER_H + 2, right, pageH - FOOTER_H + 2);
    pdf.setFontSize(7.5);
    pdf.setTextColor(120, 128, 140);
    const note = config.pdf.footerText ? pdf.splitTextToSize(config.pdf.footerText, right - left - 40) : [];
    note.slice(0, 2).forEach((line: string, n: number) => pdf.text(line, left, pageH - FOOTER_H + 6.5 + n * 3.4));
    pdf.text(`Page ${i} of ${pages}`, right, pageH - FOOTER_H + 6.5, { align: 'right' });
    if (config.pdf.showWebsite) {
      pdf.setTextColor(...NAVY);
      pdf.textWithLink(`${config.company.name} · ${config.company.mainWebsiteUrl}`, left, pageH - 4.5, { url: config.company.mainWebsiteUrl });
    }
  }
  return pdf;
}

// ---------------------------------------------------------------- logo loading (browser only)
async function rasterise(url: string): Promise<PdfLogo> {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (!/^image\/(png|jpeg|webp)$/.test(blob.type)) throw new Error(`Unsupported logo type ${blob.type}`);
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

/**
 * Loads the published logo for the PDF. Falls back to the bundled official logo if the
 * configured file cannot be fetched (e.g. Storage CORS not configured); returns a warning.
 */
export async function loadPdfLogo(url: string, isDefault: boolean): Promise<{ logo: PdfLogo | null; warning: string | null }> {
  try {
    return { logo: await rasterise(isDefault ? DEFAULT_LOGO_PDF_PATH : url), warning: null };
  } catch (e) {
    if (isDefault) return { logo: null, warning: `Logo could not be loaded (${(e as Error).message}).` };
    try {
      return { logo: await rasterise(DEFAULT_LOGO_PDF_PATH), warning: `The uploaded logo could not be loaded for the PDF (${(e as Error).message}); the default logo was used. See DEPLOYMENT.md → Storage CORS.` };
    } catch {
      return { logo: null, warning: 'No logo could be loaded; the PDF was generated without it.' };
    }
  }
}

export async function downloadPriceList(products: Product[], config: SiteConfig, opts: PriceListOptions): Promise<string | null> {
  const { logoUrl } = await import('./siteConfigStore');
  const { DEFAULT_LOGO_PATH } = await import('./siteConfig');
  const { logo, warning } = config.pdf.showLogo
    ? await loadPdfLogo(logoUrl(config.company.logoPath), config.company.logoPath === DEFAULT_LOGO_PATH)
    : { logo: null, warning: null };
  const pdf = buildPriceList(products, config, opts, logo);
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = config.company.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Price-List';
  pdf.save(`${safeName}-Price-List-${stamp}.pdf`);
  return warning;
}
