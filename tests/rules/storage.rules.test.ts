import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, it } from 'vitest';

let env: RulesTestEnvironment;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-wider-rules',
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), 'products/p1/a.png'), png, { contentType: 'image/png' });
    await uploadBytes(ref(ctx.storage(), 'private/x.txt'), png, { contentType: 'text/plain' });
  });
});
afterAll(async () => env?.cleanup());

const admin = () => env.authenticatedContext('admin1', { admin: true }).storage();
const user = () => env.authenticatedContext('user1').storage();
const anon = () => env.unauthenticatedContext().storage();

describe('storage rules', () => {
  it('serves product images publicly', async () => {
    await assertSucceeds(getBytes(ref(anon(), 'products/p1/a.png')));
  });
  it('denies reads outside public folders', async () => {
    await assertFails(getBytes(ref(anon(), 'private/x.txt')));
  });
  it('denies uploads from anonymous and non-admin users', async () => {
    await assertFails(uploadBytes(ref(anon(), 'products/p1/b.png'), png, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(user(), 'products/p1/b.png'), png, { contentType: 'image/png' }));
  });
  it('allows administrators to upload images only', async () => {
    await assertSucceeds(uploadBytes(ref(admin(), 'products/p1/c.png'), png, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(admin(), 'products/p1/evil.html'), png, { contentType: 'text/html' }));
    await assertFails(uploadBytes(ref(admin(), 'products/p1/big.png'), new Uint8Array(6 * 1024 * 1024), { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(admin(), 'anywhere/c.png'), png, { contentType: 'image/png' }));
  });
});

describe('logo uploads (branding/)', () => {
  let n = 0;
  const name = (ext = 'png') => `branding/logo-${Date.now()}${n++}.${ext}`;
  it('allows administrators to upload new PNG/JPEG/WebP logos only', async () => {
    await assertSucceeds(uploadBytes(ref(admin(), name()), png, { contentType: 'image/png' }));
    await assertSucceeds(uploadBytes(ref(admin(), name('webp')), png, { contentType: 'image/webp' }));
    await assertSucceeds(uploadBytes(ref(admin(), name('jpg')), png, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(admin(), name('svg')), png, { contentType: 'image/svg+xml' }));
    await assertFails(uploadBytes(ref(admin(), name()), png, { contentType: 'image/svg+xml' }));
    await assertFails(uploadBytes(ref(admin(), name()), png, { contentType: 'text/html' }));
    await assertFails(uploadBytes(ref(admin(), 'branding/anything.png'), png, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(admin(), name()), new Uint8Array(2 * 1024 * 1024 + 1), { contentType: 'image/png' }));
  });
  it('never overwrites an existing logo file', async () => {
    const p = name();
    await assertSucceeds(uploadBytes(ref(admin(), p), png, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(admin(), p), png, { contentType: 'image/png' }));
  });
  it('denies anonymous and non-admin uploads and deletions; logos are publicly readable', async () => {
    const p = name();
    await assertFails(uploadBytes(ref(anon(), p), png, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(user(), p), png, { contentType: 'image/png' }));
    await assertSucceeds(uploadBytes(ref(admin(), p), png, { contentType: 'image/png' }));
    await assertSucceeds(getBytes(ref(anon(), p)));
    await assertFails(deleteObject(ref(user(), p)));
    await assertFails(deleteObject(ref(anon(), p)));
    await assertSucceeds(deleteObject(ref(admin(), p)));
  });
});
