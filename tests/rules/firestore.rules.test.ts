/**
 * Firestore Security Rules tests. Run with: npm run test:rules
 * (starts the Firestore and Storage emulators via `firebase emulators:exec`).
 */
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch, type Firestore } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { DEFAULT_SITE_CONFIG } from '../../src/lib/siteConfig';

let env: RulesTestEnvironment;

const baseProduct = (over: Record<string, unknown> = {}) => ({
  sku: 'DH-1', model: 'DH-1', name: 'Camera', brand: 'Dahua', category: 'CCTV', subcategory: '', description: '',
  features: [], specs: [], imageUrl: null, imagePath: null, datasheetUrl: '', sourceUrl: '',
  price: 100, offerPrice: null, offerStart: null, offerEnd: null, offerText: '',
  stockStatus: 'in_stock', stockQty: null, status: 'published', searchText: 'camera', sortOrder: 0,
  updatedBy: 'seed', lastChangeId: 'seed',
  ...over,
});

const admin = () => env.authenticatedContext('admin1', { admin: true, email: 'admin@example.test' }).firestore();
const otherAdmin = () => env.authenticatedContext('admin2', { admin: true }).firestore();
const user = () => env.authenticatedContext('user1', { email: 'user@example.test' }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

/** Writes a product change the way the app does: change-set + product in one batch. */
function auditedWrite(db: Firestore, ids: string[], data: (id: string) => Record<string, unknown>, by = 'admin1', mode: 'update' | 'set' = 'update') {
  const batch = writeBatch(db);
  const h = doc(collection(db, 'priceHistory'));
  batch.set(h, { by, byEmail: 'x', at: serverTimestamp(), reason: 'manual', importJobId: null, productIds: ids, changes: [] });
  for (const id of ids) {
    const payload = { ...data(id), updatedAt: serverTimestamp(), updatedBy: 'admin1', lastChangeId: h.id };
    if (mode === 'set') batch.set(doc(db, 'products', id), payload);
    else batch.update(doc(db, 'products', id), payload);
  }
  return batch.commit();
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-wider-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'products', 'pub'), baseProduct());
    await setDoc(doc(db, 'products', 'draft'), baseProduct({ sku: 'DR-1', status: 'draft' }));
    await setDoc(doc(db, 'productSources', 'pub'), { price: 95, verification: 'OK', issues: [] });
    await setDoc(doc(db, 'priceHistory', 'h1'), { by: 'admin1', productIds: ['pub'], changes: [] });
    await setDoc(doc(db, 'settings', 'public'), { companyName: 'WU' });
    await setDoc(doc(db, 'users', 'user1'), { role: 'none' });
    await setDoc(doc(db, 'importJobs', 'j1'), { by: 'admin1' });
  });
});

describe('public access', () => {
  it('can read published products and query them by status', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'products', 'pub')));
    await assertSucceeds(getDocs(query(collection(anon(), 'products'), where('status', '==', 'published'))));
  });
  it('cannot read unpublished products or list the whole collection', async () => {
    await assertFails(getDoc(doc(anon(), 'products', 'draft')));
    await assertFails(getDocs(collection(anon(), 'products')));
    await assertFails(getDocs(query(collection(user(), 'products'), where('status', '==', 'draft'))));
  });
  it('cannot read source prices, audit history, import jobs or other users', async () => {
    await assertFails(getDoc(doc(anon(), 'productSources', 'pub')));
    await assertFails(getDoc(doc(user(), 'productSources', 'pub')));
    await assertFails(getDoc(doc(user(), 'priceHistory', 'h1')));
    await assertFails(getDoc(doc(user(), 'importJobs', 'j1')));
    await assertFails(getDoc(doc(anon(), 'users', 'user1')));
    await assertSucceeds(getDoc(doc(user(), 'users', 'user1')));
  });
  it('can read public settings, brands and categories but not write them', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'settings', 'public')));
    await assertSucceeds(getDocs(collection(anon(), 'brands')));
    await assertFails(setDoc(doc(user(), 'settings', 'public'), { companyName: 'Hacked' }));
    await assertFails(setDoc(doc(user(), 'brands', 'x'), { name: 'x', order: 0 }));
    await assertFails(getDoc(doc(anon(), 'settings', 'private')));
  });
});

describe('unauthorized writes and privilege escalation', () => {
  it('rejects product writes from anonymous and non-admin users, even with a change set', async () => {
    await assertFails(updateDoc(doc(anon(), 'products', 'pub'), { price: 1 }));
    await assertFails(auditedWrite(user(), ['pub'], () => ({ price: 1 }), 'user1'));
    await assertFails(deleteDoc(doc(user(), 'products', 'pub')));
    await assertFails(setDoc(doc(user(), 'products', 'new'), baseProduct()));
  });
  it('rejects users granting themselves a role', async () => {
    await assertFails(setDoc(doc(user(), 'users', 'user1'), { role: 'admin' }));
    await assertFails(updateDoc(doc(user(), 'users', 'user1'), { role: 'admin' }));
  });
  it('rejects a claim other than admin === true', async () => {
    const fake = env.authenticatedContext('u9', { admin: 'true', role: 'admin' }).firestore();
    await assertFails(auditedWrite(fake, ['pub'], () => ({ price: 1 }), 'u9'));
    await assertFails(getDoc(doc(fake, 'productSources', 'pub')));
  });
});

describe('administrator writes', () => {
  it('allows audited price changes', async () => {
    await assertSucceeds(auditedWrite(admin(), ['pub'], () => ({ price: 120, offerPrice: 110, previousPrice: 100, priceChangedAt: serverTimestamp() })));
  });
  it('rejects price or stock changes without an audit change set', async () => {
    await assertFails(updateDoc(doc(admin(), 'products', 'pub'), { price: 120, updatedAt: serverTimestamp(), updatedBy: 'admin1' }));
    await assertFails(updateDoc(doc(admin(), 'products', 'pub'), { stockStatus: 'out_of_stock', updatedAt: serverTimestamp(), updatedBy: 'admin1', lastChangeId: 'h1' }));
  });
  it('rejects a change set attributed to another administrator', async () => {
    await assertFails(auditedWrite(admin(), ['pub'], () => ({ price: 130 }), 'admin2'));
    await assertFails(auditedWrite(otherAdmin(), ['pub'], () => ({ price: 130 }), 'admin1'));
  });
  it('rejects a change set that does not list the product', async () => {
    const db = admin();
    const batch = writeBatch(db);
    const h = doc(collection(db, 'priceHistory'));
    batch.set(h, { by: 'admin1', byEmail: 'x', at: serverTimestamp(), reason: 'manual', productIds: ['draft'], changes: [] });
    batch.update(doc(db, 'products', 'pub'), { price: 5, updatedAt: serverTimestamp(), updatedBy: 'admin1', lastChangeId: h.id });
    await assertFails(batch.commit());
  });
  it('allows non-price edits without a change set', async () => {
    await assertSucceeds(updateDoc(doc(admin(), 'products', 'pub'), { name: 'Renamed', updatedAt: serverTimestamp(), updatedBy: 'admin1' }));
  });
  it('validates product data', async () => {
    await assertFails(auditedWrite(admin(), ['pub'], () => ({ offerPrice: 100 }))); // offer must be < price
    await assertFails(auditedWrite(admin(), ['pub'], () => ({ price: -1 })));
    await assertFails(auditedWrite(admin(), ['pub'], () => ({ stockStatus: 'plenty' })));
    await assertFails(updateDoc(doc(admin(), 'products', 'pub'), { status: 'live', updatedAt: serverTimestamp(), updatedBy: 'admin1' }));
    await assertFails(updateDoc(doc(admin(), 'products', 'pub'), { sourcePrice: 95, updatedAt: serverTimestamp(), updatedBy: 'admin1' }));
    await assertFails(updateDoc(doc(admin(), 'products', 'pub'), { name: 'x', updatedAt: serverTimestamp(), updatedBy: 'someone-else' }));
  });
  it('creates products only with an audit change set', async () => {
    await assertFails(setDoc(doc(admin(), 'products', 'n1'), { ...baseProduct(), updatedAt: serverTimestamp(), updatedBy: 'admin1' }));
    await assertSucceeds(auditedWrite(admin(), ['n1'], () => baseProduct({ sku: 'N-1' }), 'admin1', 'set'));
  });
  it('commits a 200-product batch with a single change set', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `bulk${i}`);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const b = writeBatch(ctx.firestore());
      ids.forEach((id) => b.set(doc(ctx.firestore(), 'products', id), baseProduct({ sku: id })));
      await b.commit();
    });
    await assertSucceeds(auditedWrite(admin(), ids, () => ({ price: 99, previousPrice: 100, priceChangedAt: serverTimestamp(), stockStatus: 'low_stock' })));
  });
  it('can read source data and update only review fields', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'productSources', 'pub')));
    await assertSucceeds(updateDoc(doc(admin(), 'productSources', 'pub'), { verification: 'VERIFIED', reviewNotes: 'ok', reviewedBy: 'admin1', reviewedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(admin(), 'productSources', 'pub'), { price: 1, reviewedBy: 'admin1', reviewedAt: serverTimestamp() }));
  });
  it('keeps the audit history append-only', async () => {
    await assertFails(updateDoc(doc(admin(), 'priceHistory', 'h1'), { changes: [] }));
    await assertFails(deleteDoc(doc(admin(), 'priceHistory', 'h1')));
    await assertFails(setDoc(doc(admin(), 'priceHistory', 'forged'), { by: 'admin1', at: new Date(), reason: 'manual', productIds: ['pub'], changes: [] }));
  });
  it('can manage settings, taxonomy and import jobs', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'settings', 'public'), { companyName: 'WIDER' }));
    await assertSucceeds(setDoc(doc(admin(), 'brands', 'dahua'), { name: 'Dahua', order: 0 }));
    await assertSucceeds(setDoc(doc(admin(), 'importJobs', 'j2'), { by: 'admin1', status: 'committing' }));
    await assertFails(setDoc(doc(admin(), 'importJobs', 'j3'), { by: 'admin2' }));
    await assertFails(deleteDoc(doc(admin(), 'importJobs', 'j1')));
  });
});

describe('public catalog index', () => {
  it('is publicly readable and writable only by administrators with the expected shape', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'catalogIndex', 'part-0'), { hash: 'h', items: [] }));
    await assertSucceeds(setDoc(doc(admin(), 'catalogIndex', 'meta'), { hash: 'h', parts: 1, count: 0, updatedAt: 1 }));
    await assertSucceeds(getDoc(doc(anon(), 'catalogIndex', 'meta')));
    await assertSucceeds(getDoc(doc(anon(), 'catalogIndex', 'part-0')));
    await assertFails(setDoc(doc(user(), 'catalogIndex', 'part-0'), { hash: 'x', items: [] }));
    await assertFails(setDoc(doc(anon(), 'catalogIndex', 'meta'), { hash: 'x', parts: 1, count: 0, updatedAt: 1 }));
    await assertFails(setDoc(doc(admin(), 'catalogIndex', 'meta'), { hash: 'h', parts: 1, count: 0, updatedAt: 1, sourcePrices: [] }));
    await assertFails(setDoc(doc(admin(), 'catalogIndex', 'other'), { hash: 'h', items: [] }));
    await assertSucceeds(deleteDoc(doc(admin(), 'catalogIndex', 'part-0')));
  });
});

describe('website settings (settings/site)', () => {
  /** Publishes the way the app does: config + settingsHistory record in one batch. */
  function publish(db: Firestore, cfg: Record<string, unknown>, uid = 'admin1', historyBy = uid) {
    const batch = writeBatch(db);
    const h = doc(collection(db, 'settingsHistory'));
    batch.set(h, { by: historyBy, byEmail: 'a@x.test', at: serverTimestamp(), changed: ['company.name'], before: null, after: cfg, note: '' });
    batch.set(doc(db, 'settings', 'site'), { ...cfg, updatedAt: serverTimestamp(), updatedBy: uid, updatedByEmail: 'a@x.test', lastChangeId: h.id });
    return batch.commit();
  }
  const cfg = () => structuredClone(DEFAULT_SITE_CONFIG) as unknown as Record<string, Record<string, unknown>>;

  it('is publicly readable', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'settings', 'site'), { ...cfg(), lastChangeId: 'x' }));
    await assertSucceeds(getDoc(doc(anon(), 'settings', 'site')));
  });

  it('can be published by an administrator with an audit record', async () => {
    await assertSucceeds(publish(admin(), cfg()));
  });

  it('cannot be written by anonymous or non-admin users, even with a history record', async () => {
    await assertFails(publish(anon(), cfg(), 'anon'));
    await assertFails(publish(user(), cfg(), 'user1'));
    await assertFails(setDoc(doc(user(), 'settings', 'site'), cfg()));
  });

  it('requires the matching history record from the same administrator', async () => {
    await assertFails(setDoc(doc(admin(), 'settings', 'site'), { ...cfg(), updatedAt: serverTimestamp(), updatedBy: 'admin1', updatedByEmail: '', lastChangeId: 'missing' }));
    await assertFails(publish(admin(), cfg(), 'admin1', 'admin2'));
  });

  it('rejects invalid configurations', async () => {
    const bad: ((c: Record<string, Record<string, unknown>>) => void)[] = [
      (c) => (c.company.mainWebsiteUrl = 'http://wideruniversal.com/'),
      (c) => (c.company.mainWebsiteUrl = 'javascript:alert(1)'),
      (c) => (c.company.logoPath = 'https://evil.example/x.png'),
      (c) => (c.company.evil = 'x'),
      (c) => delete c.pdf.footerText,
      (c) => (c.header.navLinks = Array.from({ length: 9 }, () => ({ label: 'x', url: '/' }))),
      (c) => (c.contact.whatsapp = '+966 55'),
      (c) => (c.catalog.showStock = 'yes'),
      (c) => (c.catalog.layout = 'grid'),
      (c) => (c.catalog.wideMinWidth = 1000),
      (c) => (c.catalog.visitorLayoutSwitch = 'yes'),
      (c) => (c.company.description = 'x'.repeat(2001)),
      (c) => (c.pages.heroTitle = ''),
      (c) => (c.contact.email = 'not an email'),
      (c) => (c.company.mainWebsiteUrl = 'https://x.com/"><script>'),
      (c) => (c.footer.social = 'x'),
    ];
    for (const mutate of bad) {
      const c = cfg();
      mutate(c);
      await assertFails(publish(admin(), c));
    }
  });

  it('cannot be deleted, and other settings documents are closed', async () => {
    await assertSucceeds(publish(admin(), cfg()));
    await assertFails(deleteDoc(doc(admin(), 'settings', 'site')));
    await assertFails(setDoc(doc(admin(), 'settings', 'anything'), { a: 1 }));
    await assertFails(getDoc(doc(anon(), 'settings', 'anything')));
  });

  it('keeps settings history private and append-only', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'settingsHistory', 's1'), { by: 'admin1' }));
    await assertFails(getDoc(doc(anon(), 'settingsHistory', 's1')));
    await assertFails(getDoc(doc(user(), 'settingsHistory', 's1')));
    await assertSucceeds(getDoc(doc(admin(), 'settingsHistory', 's1')));
    await assertFails(updateDoc(doc(admin(), 'settingsHistory', 's1'), { note: 'x' }));
    await assertFails(deleteDoc(doc(admin(), 'settingsHistory', 's1')));
  });

  it('restricts legacy settings/public to its known fields', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'settings', 'public'), { companyName: 'WU', phone: '1' }));
    await assertFails(setDoc(doc(admin(), 'settings', 'public'), { companyName: 'WU', script: '<x>' }));
  });
});

describe('contact directory (contactDirectory/published)', () => {
  const dir = () => ({
    version: 1,
    title: 'Contact our sales team',
    intro: '',
    branches: [{ id: 'jeddah', name: 'Jeddah Branch', location: '', active: true, contacts: [{ id: 'c1', name: 'Rauf', role: '', phone: '+966 51 121 1028', email: 'Salesjeddah@wideruniversal.com' }] }],
  });
  function publish(db: Firestore, data: Record<string, unknown>, uid = 'admin1', historyBy = uid, id = 'published') {
    const batch = writeBatch(db);
    const h = doc(collection(db, 'settingsHistory'));
    batch.set(h, { by: historyBy, byEmail: 'a@x.test', at: serverTimestamp(), changed: ['contacts'], before: null, after: { contactDirectory: data }, note: '' });
    batch.set(doc(db, 'contactDirectory', id), { ...data, updatedAt: serverTimestamp(), updatedBy: uid, updatedByEmail: 'a@x.test', lastChangeId: h.id });
    return batch.commit();
  }

  it('is publicly readable', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'contactDirectory', 'published'), dir()));
    await assertSucceeds(getDoc(doc(anon(), 'contactDirectory', 'published')));
  });
  it('can be published by an administrator with an audit record', async () => {
    await assertSucceeds(publish(admin(), dir()));
  });
  it('cannot be changed by anonymous or non-admin users', async () => {
    await assertFails(publish(anon(), dir(), 'anon'));
    await assertFails(publish(user(), dir(), 'user1'));
    await assertFails(setDoc(doc(user(), 'contactDirectory', 'published'), dir()));
  });
  it('requires the audit record, valid shape, and cannot be deleted', async () => {
    await assertFails(setDoc(doc(admin(), 'contactDirectory', 'published'), { ...dir(), updatedAt: serverTimestamp(), updatedBy: 'admin1', updatedByEmail: '', lastChangeId: 'none' }));
    await assertFails(publish(admin(), dir(), 'admin1', 'admin2'));
    await assertFails(publish(admin(), { ...dir(), title: '' }));
    await assertFails(publish(admin(), { ...dir(), extra: true }));
    await assertFails(publish(admin(), { ...dir(), branches: 'x' }));
    await assertFails(publish(admin(), { ...dir(), branches: Array.from({ length: 21 }, () => dir().branches[0]) }));
    await assertFails(publish(admin(), dir(), 'admin1', 'admin1', 'draft'));
    await assertSucceeds(publish(admin(), dir()));
    await assertFails(deleteDoc(doc(admin(), 'contactDirectory', 'published')));
  });
});

describe('brand spotlight fields', () => {
  it('lets administrators set headline, subtitle and a banner in the brand folder', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'brands', 'imou'), { name: 'Imou', order: 1, headline: 'Imou WiFi Cameras', subtitle: 'Smart home security', bannerPath: 'brands/imou/banner-1.webp' }));
    await assertSucceeds(setDoc(doc(admin(), 'brands', 'ajax'), { name: 'Ajax', order: 2 }));
  });
  it('rejects banners outside the brand folder, unknown fields, long text and non-admin writes', async () => {
    await assertFails(setDoc(doc(admin(), 'brands', 'imou'), { name: 'Imou', order: 1, bannerPath: 'brands/other/x.png' }));
    await assertFails(setDoc(doc(admin(), 'brands', 'imou'), { name: 'Imou', order: 1, bannerPath: 'https://evil.example/x.png' }));
    await assertFails(setDoc(doc(admin(), 'brands', 'imou'), { name: 'Imou', order: 1, script: 'x' }));
    await assertFails(setDoc(doc(admin(), 'brands', 'imou'), { name: 'Imou', order: 1, headline: 'x'.repeat(121) }));
    await assertFails(setDoc(doc(user(), 'brands', 'imou'), { name: 'Imou', order: 1, headline: 'x' }));
  });
});

describe('price-drop integrity', () => {
  it('records the real previous price when the price is lowered', async () => {
    await assertSucceeds(auditedWrite(admin(), ['pub'], () => ({ price: 90, previousPrice: 100, priceChangedAt: serverTimestamp() })));
  });
  it('rejects an invented previous price or timestamp', async () => {
    await assertFails(auditedWrite(admin(), ['pub'], () => ({ price: 90, previousPrice: 150, priceChangedAt: serverTimestamp() })));
    await assertFails(auditedWrite(admin(), ['pub'], () => ({ price: 90, previousPrice: 100, priceChangedAt: new Date('2026-01-01') })));
    await assertFails(auditedWrite(admin(), ['pub'], () => ({ price: 90 })));
  });
  it('does not allow adding a drop tag without a price change, but allows removing one', async () => {
    await assertFails(auditedWrite(admin(), ['pub'], () => ({ previousPrice: 200 })));
    await assertSucceeds(auditedWrite(admin(), ['pub'], () => ({ price: 90, previousPrice: 100, priceChangedAt: serverTimestamp() })));
    await assertSucceeds(auditedWrite(admin(), ['pub'], () => ({ previousPrice: null })));
  });
  it('starts new products without history', async () => {
    await assertFails(auditedWrite(admin(), ['n2'], () => baseProduct({ sku: 'N-2', previousPrice: 500 }), 'admin1', 'set'));
    await assertSucceeds(auditedWrite(admin(), ['n3'], () => baseProduct({ sku: 'N-3', previousPrice: null, priceChangedAt: null }), 'admin1', 'set'));
  });
});
