/**
 * Central company branding and website content configuration.
 *
 * One published document (`settings/site`) drives the header, footer, page texts and the
 * PDF price list. This module is Firebase-free (validation, defaults, normalisation) so it
 * is shared by the UI, the admin editor and the unit tests. The same constraints are
 * enforced server-side in firestore.rules (`validSiteConfig`).
 *
 * All values are plain text or structured fields — never HTML. Text is rendered by React
 * (escaped); links are restricted to https URLs or same-site paths.
 */

export interface NavLink {
  label: string;
  url: string;
}

export interface SiteConfig {
  version: number;
  company: {
    name: string;
    tagline: string;
    description: string;
    mainWebsiteUrl: string;
    /** Bundled asset (`/brand/...`) or uploaded Storage object (`branding/...`). */
    logoPath: string;
    logoAlt: string;
  };
  contact: {
    phone: string;
    whatsapp: string;
    email: string;
    address: string;
  };
  header: {
    showLogo: boolean;
    showCompanyName: boolean;
    showMainWebsite: boolean;
    mainWebsiteLabel: string;
    showWhatsApp: boolean;
    whatsappLabel: string;
    navLinks: NavLink[];
  };
  footer: {
    showLogo: boolean;
    description: string;
    showMainWebsite: boolean;
    mainWebsiteLabel: string;
    links: NavLink[];
    showBrandLinks: boolean;
    copyright: string;
    social: NavLink[];
  };
  pages: {
    heroEyebrow: string;
    heroTitle: string;
    heroText: string;
    catalogIntro: string;
    aboutTitle: string;
    aboutText: string;
    contactTitle: string;
    contactText: string;
  };
  catalog: {
    showStock: boolean;
    lowStockThreshold: number;
    /** 'auto': wide three-column layout on screens at least `wideMinWidth` px; 'standard': centred layout everywhere. */
    layout: CatalogLayout;
    wideMinWidth: WideWidth;
    /** Let visitors on wide screens switch between the wide and standard layouts (remembered in their browser). */
    visitorLayoutSwitch: boolean;
  };
  pdf: {
    showLogo: boolean;
    title: string;
    tagline: string;
    footerText: string;
    showContact: boolean;
    showWebsite: boolean;
  };
}

export type CatalogLayout = 'auto' | 'standard';
export const WIDE_WIDTHS = [1440, 1600, 1920] as const;
export type WideWidth = (typeof WIDE_WIDTHS)[number];

export interface PublishedSiteConfig extends SiteConfig {
  updatedAt?: { toDate(): Date } | null;
  updatedBy?: string;
  updatedByEmail?: string;
  lastChangeId?: string;
}

export const DEFAULT_LOGO_PATH = '/brand/wider-universal-emblem-320.webp';
/** Higher-resolution bundled logo used for PDFs when the default logo is selected. */
export const DEFAULT_LOGO_PDF_PATH = '/brand/wider-universal-emblem.png';

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  version: 1,
  company: {
    name: 'WIDER UNIVERSAL TRADING COMPANY',
    tagline: '',
    description: 'Security, surveillance, networking and power solutions for projects across Saudi Arabia.',
    mainWebsiteUrl: 'https://wideruniversal.com/',
    logoPath: DEFAULT_LOGO_PATH,
    logoAlt: 'Wider Universal Trading Company logo',
  },
  contact: {
    phone: '+966 55 482 2231',
    whatsapp: '966554822231',
    email: 'sales@theuniversaltrading.com',
    address: 'Riyadh, Saudi Arabia',
  },
  header: {
    showLogo: true,
    showCompanyName: true,
    showMainWebsite: true,
    mainWebsiteLabel: 'Main Website',
    /** Retained for stored-config compatibility; the header no longer shows a WhatsApp button. */
    showWhatsApp: false,
    whatsappLabel: 'WhatsApp',
    navLinks: [
      { label: 'Catalog', url: '/' },
      { label: 'Offers', url: '/?offers=1#catalog' },
      { label: 'Contact', url: '/contact' },
    ],
  },
  footer: {
    showLogo: true,
    description: 'Security, surveillance, networking and power solutions for projects across Saudi Arabia.',
    showMainWebsite: true,
    mainWebsiteLabel: 'Visit our main website',
    links: [
      { label: 'Product catalog', url: '/' },
      { label: 'Current offers', url: '/?offers=1#catalog' },
    ],
    showBrandLinks: true,
    copyright: '© {year} WIDER UNIVERSAL TRADING COMPANY. All rights reserved.',
    social: [],
  },
  pages: {
    heroEyebrow: 'Product catalog & price list',
    heroTitle: 'Security, surveillance & networking products',
    heroText: 'Current prices in SAR. Search by product name, model number or SKU.',
    catalogIntro: '',
    aboutTitle: '',
    aboutText: '',
    contactTitle: 'Contact',
    contactText: '',
  },
  catalog: {
    showStock: true,
    lowStockThreshold: 5,
    layout: 'auto',
    wideMinWidth: 1600,
    visitorLayoutSwitch: false,
  },
  pdf: {
    showLogo: true,
    title: 'Price List',
    tagline: '',
    footerText: 'Prices in SAR and subject to change without notice. Contact our sales team for project pricing.',
    showContact: true,
    showWebsite: true,
  },
};

// ---------------------------------------------------------------- limits (mirrored in firestore.rules)
export const LIMITS = {
  short: 40,
  name: 120,
  line: 160,
  url: 300,
  medium: 600,
  long: 2000,
  navLinks: 8,
  footerLinks: 8,
  social: 6,
} as const;

export const HTTPS_URL_RE = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?(\/[^\s"'<>\\]*)?$/;
export const INTERNAL_URL_RE = /^(\/([^/\s"'<>\\][^\s"'<>\\]*)?|\/|#[A-Za-z0-9_-]+)$/;
export const LOGO_PATH_RE = /^(\/brand\/[A-Za-z0-9._-]+|branding\/[A-Za-z0-9._-]+)$/;

export function isHttpsUrl(u: string): boolean {
  if (!HTTPS_URL_RE.test(u)) return false;
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Same-site path ("/", "/?offers=1", "#contact") or https URL. Rejects javascript:, data:, //host, http:. */
export function isSafeLinkUrl(u: string): boolean {
  return INTERNAL_URL_RE.test(u) || isHttpsUrl(u);
}

export function isExternal(u: string): boolean {
  return u.startsWith('https://');
}

export type ConfigErrors = Record<string, string>;

/** Validates a complete config. Keys of the result are field paths such as "company.mainWebsiteUrl". */
export function validateSiteConfig(c: SiteConfig): ConfigErrors {
  const e: ConfigErrors = {};
  const text = (path: string, v: unknown, max: number, required = false) => {
    if (typeof v !== 'string') e[path] = 'Must be text.';
    else if (required && !v.trim()) e[path] = 'Required.';
    else if (v.length > max) e[path] = `At most ${max} characters (currently ${v.length}).`;
    else if (/[<>]/.test(v) && /<\s*\/?\s*[a-z!]/i.test(v)) e[path] = 'HTML tags are not allowed.';
  };
  const bool = (path: string, v: unknown) => {
    if (typeof v !== 'boolean') e[path] = 'Must be on or off.';
  };
  const links = (path: string, l: unknown, max: number) => {
    if (!Array.isArray(l)) return void (e[path] = 'Invalid list.');
    if (l.length > max) e[path] = `At most ${max} links.`;
    l.forEach((x, i) => {
      text(`${path}.${i}.label`, x?.label, LIMITS.short, true);
      if (typeof x?.url !== 'string' || !isSafeLinkUrl(x.url) || x.url.length > LIMITS.url)
        e[`${path}.${i}.url`] = 'Use a page path such as /?offers=1, a section like #contact, or a full https:// address.';
    });
  };

  text('company.name', c.company.name, LIMITS.name, true);
  text('company.tagline', c.company.tagline, LIMITS.line);
  text('company.description', c.company.description, LIMITS.long);
  if (!isHttpsUrl(c.company.mainWebsiteUrl) || c.company.mainWebsiteUrl.length > LIMITS.url)
    e['company.mainWebsiteUrl'] = 'Enter a full https:// address, e.g. https://wideruniversal.com/';
  if (!LOGO_PATH_RE.test(c.company.logoPath)) e['company.logoPath'] = 'Invalid logo file.';
  text('company.logoAlt', c.company.logoAlt, LIMITS.line, true);

  text('contact.phone', c.contact.phone, LIMITS.short);
  if (typeof c.contact.phone === 'string' && c.contact.phone && !/^[+0-9 ()-]{6,40}$/.test(c.contact.phone))
    e['contact.phone'] = 'Use digits, spaces, + ( ) and - only.';
  if (typeof c.contact.whatsapp !== 'string' || !/^[0-9]{0,20}$/.test(c.contact.whatsapp))
    e['contact.whatsapp'] = 'Digits only, with country code (e.g. 966554822231).';
  text('contact.email', c.contact.email, LIMITS.name);
  if (typeof c.contact.email === 'string' && c.contact.email && !/^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(c.contact.email))
    e['contact.email'] = 'Enter a valid email address.';
  text('contact.address', c.contact.address, LIMITS.medium);

  bool('header.showLogo', c.header.showLogo);
  bool('header.showCompanyName', c.header.showCompanyName);
  bool('header.showMainWebsite', c.header.showMainWebsite);
  text('header.mainWebsiteLabel', c.header.mainWebsiteLabel, LIMITS.short, true);
  bool('header.showWhatsApp', c.header.showWhatsApp);
  text('header.whatsappLabel', c.header.whatsappLabel, LIMITS.short, true);
  links('header.navLinks', c.header.navLinks, LIMITS.navLinks);

  bool('footer.showLogo', c.footer.showLogo);
  text('footer.description', c.footer.description, LIMITS.long);
  bool('footer.showMainWebsite', c.footer.showMainWebsite);
  text('footer.mainWebsiteLabel', c.footer.mainWebsiteLabel, LIMITS.short, true);
  links('footer.links', c.footer.links, LIMITS.footerLinks);
  bool('footer.showBrandLinks', c.footer.showBrandLinks);
  text('footer.copyright', c.footer.copyright, LIMITS.line);
  links('footer.social', c.footer.social, LIMITS.social);
  (c.footer.social ?? []).forEach((s, i) => {
    if (s && typeof s.url === 'string' && !isHttpsUrl(s.url)) e[`footer.social.${i}.url`] = 'Social links must be full https:// addresses.';
  });

  text('pages.heroEyebrow', c.pages.heroEyebrow, LIMITS.name);
  text('pages.heroTitle', c.pages.heroTitle, LIMITS.line, true);
  text('pages.heroText', c.pages.heroText, LIMITS.medium);
  text('pages.catalogIntro', c.pages.catalogIntro, LIMITS.medium);
  text('pages.aboutTitle', c.pages.aboutTitle, LIMITS.name);
  text('pages.aboutText', c.pages.aboutText, LIMITS.long);
  text('pages.contactTitle', c.pages.contactTitle, LIMITS.name);
  text('pages.contactText', c.pages.contactText, LIMITS.long);

  bool('catalog.showStock', c.catalog.showStock);
  if (!Number.isInteger(c.catalog.lowStockThreshold) || c.catalog.lowStockThreshold < 0 || c.catalog.lowStockThreshold > 100000)
    e['catalog.lowStockThreshold'] = 'Whole number between 0 and 100000.';
  if (c.catalog.layout !== 'auto' && c.catalog.layout !== 'standard') e['catalog.layout'] = 'Choose a layout.';
  if (!(WIDE_WIDTHS as readonly number[]).includes(c.catalog.wideMinWidth)) e['catalog.wideMinWidth'] = 'Choose 1440, 1600 or 1920.';
  bool('catalog.visitorLayoutSwitch', c.catalog.visitorLayoutSwitch);

  bool('pdf.showLogo', c.pdf.showLogo);
  text('pdf.title', c.pdf.title, LIMITS.name, true);
  text('pdf.tagline', c.pdf.tagline, LIMITS.line);
  text('pdf.footerText', c.pdf.footerText, LIMITS.url);
  bool('pdf.showContact', c.pdf.showContact);
  bool('pdf.showWebsite', c.pdf.showWebsite);
  return e;
}

type Legacy = Partial<{ companyName: string; phone: string; whatsapp: string; email: string; address: string; showStock: boolean; lowStockThreshold: number; priceListNote: string }>;

/**
 * Builds a complete, valid config from whatever is stored. Every section is merged over the
 * defaults, and any field that fails validation falls back to its default, so a damaged or
 * older document can never break the public site.
 */
export function normalizeSiteConfig(raw: unknown, legacy?: Legacy | null): SiteConfig {
  const d = structuredClone(DEFAULT_SITE_CONFIG);
  if (legacy) {
    if (legacy.companyName) d.company.name = legacy.companyName;
    if (legacy.phone) d.contact.phone = legacy.phone;
    if (legacy.whatsapp) d.contact.whatsapp = legacy.whatsapp;
    if (legacy.email) d.contact.email = legacy.email;
    if (legacy.address) d.contact.address = legacy.address;
    if (typeof legacy.showStock === 'boolean') d.catalog.showStock = legacy.showStock;
    if (typeof legacy.lowStockThreshold === 'number') d.catalog.lowStockThreshold = legacy.lowStockThreshold;
    if (legacy.priceListNote) d.pdf.footerText = legacy.priceListNote;
  }
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Record<string, unknown>>;
  const merged = structuredClone(d) as unknown as Record<string, Record<string, unknown>>;
  for (const section of Object.keys(d) as (keyof SiteConfig)[]) {
    if (section === 'version') {
      if (typeof (r as Record<string, unknown>).version === 'number') (merged as Record<string, unknown>).version = (r as Record<string, unknown>).version;
      continue;
    }
    const src = r[section];
    if (src && typeof src === 'object') {
      for (const k of Object.keys(merged[section])) if (k in src) merged[section][k] = structuredClone(src[k]);
    }
  }
  const cfg = merged as unknown as SiteConfig;
  const errors = validateSiteConfig(cfg);
  for (const path of Object.keys(errors)) {
    const [section, field] = path.split('.') as [keyof SiteConfig, string];
    if (section === 'version') continue;
    (cfg[section] as Record<string, unknown>)[field] = structuredClone((d[section] as Record<string, unknown>)[field]);
  }
  return cfg;
}

/** Replaces {year} in admin-entered copyright text. */
export function renderCopyright(c: SiteConfig, now = new Date()): string {
  return (c.footer.copyright || `© {year} ${c.company.name}`).replace(/\{year\}/g, String(now.getFullYear()));
}

export function whatsappHref(c: SiteConfig, text: string): string | null {
  return c.contact.whatsapp ? `https://wa.me/${c.contact.whatsapp}?text=${encodeURIComponent(text)}` : null;
}

/** Field paths whose values differ between two configs (for the audit trail). */
export function changedPaths(a: SiteConfig, b: SiteConfig): string[] {
  const out: string[] = [];
  for (const s of Object.keys(b) as (keyof SiteConfig)[]) {
    if (s === 'version') continue;
    for (const k of Object.keys(b[s] as object)) {
      if (JSON.stringify((a[s] as Record<string, unknown>)?.[k]) !== JSON.stringify((b[s] as Record<string, unknown>)[k])) out.push(`${s}.${k}`);
    }
  }
  return out;
}

/** Splits "WIDER UNIVERSAL TRADING COMPANY" into a primary line and a descriptor line. */
export function splitCompanyName(name: string): [string, string] {
  const m = name.trim().match(/^(.*?)\s+((?:TRADING|TRADE|GENERAL TRADING|GROUP|HOLDING)\b.*)$/i);
  return m && m[1] ? [m[1], m[2]] : [name.trim(), ''];
}
