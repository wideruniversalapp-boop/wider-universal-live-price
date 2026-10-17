/**
 * Branch contact directory shown on the public /contact page.
 *
 * Stored as one published Firestore document (`contactDirectory/published`) that
 * administrators edit in Admin → Contacts. This module is Firebase-free (types,
 * validation, link helpers) so it is shared by the page, the editor and the tests.
 * Contact details are data — nothing here or in the page components hard-codes them.
 */

export interface BranchContact {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string;
}

export interface Branch {
  id: string;
  name: string;
  location: string;
  active: boolean;
  contacts: BranchContact[];
}

export interface ContactDirectory {
  version: number;
  title: string;
  intro: string;
  branches: Branch[];
}

export const CONTACT_LIMITS = {
  title: 120,
  intro: 600,
  branchName: 80,
  location: 80,
  name: 80,
  role: 80,
  phone: 24,
  email: 120,
  branches: 20,
  contactsPerBranch: 10,
} as const;

/** Empty directory used only when nothing has been published yet (no contact data in code). */
export const EMPTY_DIRECTORY: ContactDirectory = {
  version: 0,
  title: 'Contact our sales team',
  intro: '',
  branches: [],
};

export const PHONE_RE = /^\+?[0-9(][0-9 ()-]{5,22}$/;
export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function isValidPhone(p: string): boolean {
  return PHONE_RE.test(p.trim()) && p.replace(/\D/g, '').length >= 7 && p.replace(/\D/g, '').length <= 15;
}

export function isValidEmail(e: string): boolean {
  return e.length <= CONTACT_LIMITS.email && EMAIL_RE.test(e.trim());
}

/** "+966 51 121 1028" → "tel:+966511211028" */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  return `tel:${digits.startsWith('+') ? '+' + digits.slice(1).replace(/\+/g, '') : digits.replace(/\+/g, '')}`;
}

export function mailHref(email: string, subject?: string): string {
  return `mailto:${email.trim()}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export type DirectoryErrors = Record<string, string>;

const hasTags = (s: string) => /<\s*\/?\s*[a-z!]/i.test(s);

/** Field paths such as "branches.0.contacts.1.email". */
export function validateDirectory(d: ContactDirectory): DirectoryErrors {
  const e: DirectoryErrors = {};
  const text = (path: string, v: string, max: number, required: boolean) => {
    if (typeof v !== 'string') e[path] = 'Must be text.';
    else if (required && !v.trim()) e[path] = 'Required.';
    else if (v.length > max) e[path] = `At most ${max} characters.`;
    else if (hasTags(v)) e[path] = 'HTML is not allowed.';
  };
  text('title', d.title, CONTACT_LIMITS.title, true);
  text('intro', d.intro, CONTACT_LIMITS.intro, false);
  if (d.branches.length > CONTACT_LIMITS.branches) e.branches = `At most ${CONTACT_LIMITS.branches} branches.`;
  const ids = new Set<string>();
  d.branches.forEach((b, i) => {
    const p = `branches.${i}`;
    if (!b.id || ids.has(b.id)) e[`${p}.id`] = 'Duplicate branch.';
    ids.add(b.id);
    text(`${p}.name`, b.name, CONTACT_LIMITS.branchName, true);
    text(`${p}.location`, b.location, CONTACT_LIMITS.location, false);
    if (b.active && b.contacts.length === 0) e[`${p}.contacts`] = 'An active branch needs at least one contact.';
    if (b.contacts.length > CONTACT_LIMITS.contactsPerBranch) e[`${p}.contacts`] = `At most ${CONTACT_LIMITS.contactsPerBranch} contacts per branch.`;
    b.contacts.forEach((c, j) => {
      const q = `${p}.contacts.${j}`;
      text(`${q}.name`, c.name, CONTACT_LIMITS.name, true);
      text(`${q}.role`, c.role, CONTACT_LIMITS.role, false);
      if (!c.phone.trim() && !c.email.trim()) e[`${q}.phone`] = 'Enter a telephone number or an email address.';
      if (c.phone.trim() && !isValidPhone(c.phone)) e[`${q}.phone`] = 'Use digits with country code, e.g. +966 51 121 1028.';
      if (c.email.trim() && !isValidEmail(c.email)) e[`${q}.email`] = 'Enter a valid email address.';
    });
  });
  return e;
}

/** Defensive read: drops malformed entries so a damaged document never breaks the page. */
export function normalizeDirectory(raw: unknown): ContactDirectory {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const branches = Array.isArray(r.branches) ? r.branches : [];
  return {
    version: typeof r.version === 'number' ? r.version : 0,
    title: str(r.title, CONTACT_LIMITS.title) || EMPTY_DIRECTORY.title,
    intro: str(r.intro, CONTACT_LIMITS.intro),
    branches: branches
      .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
      .slice(0, CONTACT_LIMITS.branches)
      .map((b, i) => ({
        id: str(b.id, 60) || `branch-${i}`,
        name: str(b.name, CONTACT_LIMITS.branchName),
        location: str(b.location, CONTACT_LIMITS.location),
        active: b.active !== false,
        contacts: (Array.isArray(b.contacts) ? b.contacts : [])
          .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
          .slice(0, CONTACT_LIMITS.contactsPerBranch)
          .map((c, j) => ({
            id: str(c.id, 60) || `contact-${i}-${j}`,
            name: str(c.name, CONTACT_LIMITS.name),
            role: str(c.role, CONTACT_LIMITS.role),
            phone: str(c.phone, CONTACT_LIMITS.phone),
            email: str(c.email, CONTACT_LIMITS.email),
          })),
      })),
  };
}

/** Branches and contacts safe to show publicly: active, named, with valid details only. */
export function publicBranches(d: ContactDirectory): Branch[] {
  return d.branches
    .filter((b) => b.active && b.name.trim() && !hasTags(b.name))
    .map((b) => ({
      ...b,
      contacts: b.contacts
        .filter((c) => c.name.trim() && !hasTags(c.name))
        .map((c) => ({ ...c, phone: isValidPhone(c.phone) ? c.phone.trim() : '', email: isValidEmail(c.email) ? c.email.trim() : '' }))
        .filter((c) => c.phone || c.email),
    }))
    .filter((b) => b.contacts.length > 0);
}
