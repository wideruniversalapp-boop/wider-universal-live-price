import { collection, doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { normalizeDirectory, validateDirectory, type ContactDirectory } from './contacts';

export const DIRECTORY_DOC = doc(db, 'contactDirectory', 'published');

export async function fetchDirectory(): Promise<{ directory: ContactDirectory; exists: boolean }> {
  const snap = await getDoc(DIRECTORY_DOC);
  return { directory: normalizeDirectory(snap.exists() ? snap.data() : null), exists: snap.exists() };
}

function summarize(before: ContactDirectory | null, after: ContactDirectory): string[] {
  if (!before) return ['contacts (initial)'];
  const out: string[] = [];
  if (before.title !== after.title) out.push('contacts.title');
  if (before.intro !== after.intro) out.push('contacts.intro');
  const names = (d: ContactDirectory) => d.branches.map((b) => b.id);
  if (JSON.stringify(names(before)) !== JSON.stringify(names(after))) out.push('contacts.branches (added/removed/reordered)');
  for (const b of after.branches) {
    const old = before.branches.find((x) => x.id === b.id);
    if (old && JSON.stringify(old) !== JSON.stringify(b)) out.push(`contacts.branch ${b.name}`);
  }
  return out.length ? out : ['contacts'];
}

/**
 * Publishes the directory together with an audit record in `settingsHistory`, in one batch.
 * Firestore rules require the matching history record from the same administrator.
 */
export async function publishDirectory(next: ContactDirectory, previous: ContactDirectory | null, note = ''): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  const errors = validateDirectory(next);
  if (Object.keys(errors).length) throw new Error(`Fix ${Object.keys(errors).length} field(s) before saving.`);
  const clean: ContactDirectory = {
    version: (previous?.version ?? 0) + 1,
    title: next.title.trim(),
    intro: next.intro.trim(),
    branches: next.branches.map((b) => ({
      id: b.id,
      name: b.name.trim(),
      location: b.location.trim(),
      active: b.active,
      contacts: b.contacts.map((c) => ({ id: c.id, name: c.name.trim(), role: c.role.trim(), phone: c.phone.trim(), email: c.email.trim() })),
    })),
  };
  const batch = writeBatch(db);
  const hist = doc(collection(db, 'settingsHistory'));
  batch.set(hist, {
    by: user.uid,
    byEmail: user.email ?? '',
    at: serverTimestamp(),
    changed: summarize(previous, clean),
    before: previous ? { contactDirectory: previous } : null,
    after: { contactDirectory: clean },
    note: note.slice(0, 200),
  });
  batch.set(DIRECTORY_DOC, {
    ...clean,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedByEmail: user.email ?? '',
    lastChangeId: hist.id,
  });
  await batch.commit();
}
