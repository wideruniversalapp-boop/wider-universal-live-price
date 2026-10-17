import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPriceList } from '../../src/lib/pdf';
import {
  changedPaths,
  DEFAULT_SITE_CONFIG,
  isSafeLinkUrl,
  normalizeSiteConfig,
  renderCopyright,
  validateSiteConfig,
  type SiteConfig,
} from '../../src/lib/siteConfig';
import { product } from './fixtures';

const clone = (): SiteConfig => structuredClone(DEFAULT_SITE_CONFIG);

describe('site config validation', () => {
  it('accepts the defaults, which point at the corporate website', () => {
    expect(validateSiteConfig(clone())).toEqual({});
    expect(DEFAULT_SITE_CONFIG.company.mainWebsiteUrl).toBe('https://wideruniversal.com/');
    expect(DEFAULT_SITE_CONFIG.header.showMainWebsite && DEFAULT_SITE_CONFIG.footer.showMainWebsite).toBe(true);
  });

  it('rejects unsafe or malformed URLs', () => {
    for (const bad of ['http://wideruniversal.com', 'javascript:alert(1)', 'https://', 'wideruniversal.com', 'https://x.com/"onmouseover=1', 'data:text/html,hi']) {
      const c = clone();
      c.company.mainWebsiteUrl = bad;
      expect(validateSiteConfig(c)['company.mainWebsiteUrl'], bad).toBeDefined();
    }
    expect(isSafeLinkUrl('/?offers=1#catalog')).toBe(true);
    expect(isSafeLinkUrl('#contact')).toBe(true);
    expect(isSafeLinkUrl('https://wideruniversal.com/about')).toBe(true);
    expect(isSafeLinkUrl('//evil.example')).toBe(false);
    expect(isSafeLinkUrl(`/${String.fromCharCode(92)}evil.example`)).toBe(false); // "/\evil.example"
    expect(isSafeLinkUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects HTML, over-long text, bad contacts, bad logo paths and too many links', () => {
    const c = clone();
    c.pages.heroTitle = '<script>alert(1)</script>';
    c.company.description = 'x'.repeat(2001);
    c.contact.whatsapp = '+966 55';
    c.contact.email = 'not-an-email';
    c.company.logoPath = 'https://evil.example/logo.png';
    c.header.navLinks = Array.from({ length: 9 }, (_, i) => ({ label: `L${i}`, url: '/' }));
    c.footer.social = [{ label: 'X', url: '/relative' }];
    const e = validateSiteConfig(c);
    expect(Object.keys(e).sort()).toEqual(
      ['company.description', 'company.logoPath', 'contact.email', 'contact.whatsapp', 'footer.social.0.url', 'header.navLinks', 'pages.heroTitle'].sort(),
    );
  });

  it('allows ordinary text with comparison signs', () => {
    const c = clone();
    c.pages.heroText = 'Cameras < 4MP and > 8MP in stock';
    expect(validateSiteConfig(c)).toEqual({});
  });
});

describe('normalizeSiteConfig', () => {
  it('fills missing sections from defaults and legacy settings', () => {
    const c = normalizeSiteConfig({ company: { name: 'X CO' } }, { phone: '+966 11 111 1111', priceListNote: 'Old note' });
    expect(c.company.name).toBe('X CO');
    expect(c.company.mainWebsiteUrl).toBe('https://wideruniversal.com/');
    expect(c.contact.phone).toBe('+966 11 111 1111');
    expect(c.pdf.footerText).toBe('Old note');
  });

  it('replaces invalid stored values with defaults instead of breaking the site', () => {
    const c = normalizeSiteConfig({ company: { mainWebsiteUrl: 'javascript:alert(1)', name: '' }, header: { navLinks: 'oops' } });
    expect(c.company.mainWebsiteUrl).toBe(DEFAULT_SITE_CONFIG.company.mainWebsiteUrl);
    expect(c.company.name).toBe(DEFAULT_SITE_CONFIG.company.name);
    expect(c.header.navLinks).toEqual(DEFAULT_SITE_CONFIG.header.navLinks);
    expect(validateSiteConfig(c)).toEqual({});
  });

  it('ignores unknown fields', () => {
    const c = normalizeSiteConfig({ company: { evil: '<script>' }, extra: { x: 1 } }) as unknown as Record<string, unknown>;
    expect('extra' in c).toBe(false);
    expect('evil' in (c.company as object)).toBe(false);
  });
});

describe('helpers', () => {
  it('renders {year} in the copyright and lists changed fields', () => {
    expect(renderCopyright(clone(), new Date('2027-01-01'))).toBe('© 2027 WIDER UNIVERSAL TRADING COMPANY. All rights reserved.');
    const b = clone();
    b.company.name = 'NEW';
    b.header.navLinks = [];
    expect(changedPaths(clone(), b)).toEqual(['company.name', 'header.navLinks']);
  });
});

describe('PDF branding', () => {
  const logoPng = readFileSync('public/brand/favicon-64.png');
  const logo = { dataUrl: `data:image/png;base64,${logoPng.toString('base64')}`, width: 64, height: 64 };
  const many = Array.from({ length: 120 }, (_, i) =>
    product({ id: `p${i}`, sku: `SKU-${i}`, model: `MODEL-${i}`, name: `Product ${i} with a deliberately long name that has to wrap inside the table cell`, price: 100 + i }),
  );

  it('puts logo, company name, website, contact and footer on every page of a multipage export', () => {
    const cfg = clone();
    cfg.pdf.footerText = 'Custom footer text';
    const pdf = buildPriceList(many, cfg, { includeStock: true, includeFeatures: false }, logo);
    const pages = pdf.getNumberOfPages();
    expect(pages).toBeGreaterThan(1);
    const text = new TextDecoder('latin1').decode(pdf.output('arraybuffer'));
    const count = (s: string) => text.split(s).length - 1;
    expect(count('(WIDER UNIVERSAL TRADING COMPANY)')).toBeGreaterThanOrEqual(pages);
    expect(count('https://wideruniversal.com/')).toBeGreaterThanOrEqual(pages);
    expect(count('Custom footer text')).toBe(pages);
    expect(text).toContain(`Page ${pages} of ${pages}`);
    expect(text).toContain('sales@theuniversaltrading.com');
    expect(text).toContain('/Subtype /Image');
    expect(text).toContain('/URI (https://wideruniversal.com/)');
  });

  it('follows the published settings and toggles', () => {
    const cfg = clone();
    cfg.company.name = 'RENAMED CO';
    cfg.company.mainWebsiteUrl = 'https://example.com/';
    cfg.pdf.showContact = false;
    cfg.pdf.showLogo = false;
    const pdf = buildPriceList(many.slice(0, 5), cfg, { includeStock: false, includeFeatures: false }, logo);
    const text = new TextDecoder('latin1').decode(pdf.output('arraybuffer'));
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(text).toContain('RENAMED CO');
    expect(text).toContain('https://example.com/');
    expect(text).not.toContain('sales@theuniversaltrading.com');
    expect(text).not.toContain('/Subtype /Image');
  });

  it('still generates without a logo', () => {
    const pdf = buildPriceList(many.slice(0, 3), clone(), { includeStock: false, includeFeatures: false }, null);
    expect(pdf.getNumberOfPages()).toBe(1);
  });
});

describe('catalog layout settings', () => {
  it('defaults to the automatic wide layout at 1600 px with the visitor switch off', () => {
    expect(DEFAULT_SITE_CONFIG.catalog).toMatchObject({ layout: 'auto', wideMinWidth: 1600, visitorLayoutSwitch: false });
  });
  it('accepts the allowed values and rejects others', () => {
    const ok = clone();
    ok.catalog.layout = 'standard';
    ok.catalog.wideMinWidth = 1920;
    ok.catalog.visitorLayoutSwitch = true;
    expect(validateSiteConfig(ok)).toEqual({});
    const bad = clone() as unknown as { catalog: Record<string, unknown> };
    bad.catalog.layout = 'grid';
    bad.catalog.wideMinWidth = 1000;
    bad.catalog.visitorLayoutSwitch = 'yes';
    expect(Object.keys(validateSiteConfig(bad as unknown as SiteConfig)).sort()).toEqual(['catalog.layout', 'catalog.visitorLayoutSwitch', 'catalog.wideMinWidth']);
  });
  it('fills the new fields for settings saved before they existed', () => {
    const c = normalizeSiteConfig({ catalog: { showStock: false, lowStockThreshold: 3 } });
    expect(c.catalog).toEqual({ showStock: false, lowStockThreshold: 3, layout: 'auto', wideMinWidth: 1600, visitorLayoutSwitch: false });
  });
});
