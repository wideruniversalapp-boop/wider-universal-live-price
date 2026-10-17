import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { auth, db, firebaseConfig } from '../firebase';
import {
  changedPaths,
  DEFAULT_LOGO_PATH,
  DEFAULT_SITE_CONFIG,
  normalizeSiteConfig,
  validateSiteConfig,
  type SiteConfig,
} from './siteConfig';

export const SITE_DOC = doc(db, 'settings', 'site');

/** Published config, normalised. Falls back to the legacy `settings/public` values, then defaults. */
export async function fetchSiteConfig(): Promise<SiteConfig & { lastChangeId?: string }> {
  const [site, legacy] = await Promise.all([
    getDoc(SITE_DOC).catch(() => null),
    getDoc(doc(db, 'settings', 'public')).catch(() => null),
  ]);
  const cfg = normalizeSiteConfig(site?.exists() ? site.data() : null, legacy?.exists() ? legacy.data() : null);
  return { ...cfg, lastChangeId: site?.exists() ? (site.data().lastChangeId as string) : undefined };
}

/** Public URL of a logo path (bundled asset or Storage object readable by everyone per storage.rules). */
export function logoUrl(path: string): string {
  if (path.startsWith('/')) return path;
  const enc = encodeURIComponent(path);
  const host = import.meta.env.VITE_USE_EMULATORS === 'true' ? 'http://127.0.0.1:9199' : 'https://firebasestorage.googleapis.com';
  return `${host}/v0/b/${firebaseConfig.storageBucket}/o/${enc}?alt=media`;
}

export interface SettingsChange {
  id: string;
  by: string;
  byEmail: string;
  at: Timestamp | null;
  changed: string[];
  before: SiteConfig | null;
  after: SiteConfig;
  note: string;
}

/**
 * Validates and publishes a new configuration together with an audit record, in one batch.
 * Firestore rules re-validate the document and require the matching history entry.
 */
export async function publishSiteConfig(next: SiteConfig, previous: SiteConfig | null, note = ''): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  const errors = validateSiteConfig(next);
  if (Object.keys(errors).length) throw new Error(`Fix ${Object.keys(errors).length} field(s) before saving.`);
  const batch = writeBatch(db);
  const hist = doc(collection(db, 'settingsHistory'));
  const config = { ...structuredClone(next), version: (previous?.version ?? 0) + 1 };
  batch.set(hist, {
    by: user.uid,
    byEmail: user.email ?? '',
    at: serverTimestamp(),
    changed: previous ? changedPaths(previous, config) : ['(initial)'],
    before: previous ? structuredClone(previous) : null,
    after: config,
    note: note.slice(0, 200),
  });
  batch.set(SITE_DOC, {
    ...config,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedByEmail: user.email ?? '',
    lastChangeId: hist.id,
  });
  await batch.commit();
  return hist.id;
}

export async function fetchSettingsHistory(max = 30): Promise<SettingsChange[]> {
  const snap = await getDocs(query(collection(db, 'settingsHistory'), orderBy('at', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as Omit<SettingsChange, 'id'>) }));
}

export async function fetchAdminUsers(): Promise<{ uid: string; email: string; role: string }[]> {
  const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'admin')));
  return snap.docs.map((d) => ({ uid: d.id, email: d.data().email ?? '', role: d.data().role }));
}

// ---------------------------------------------------------------- React context
interface SiteConfigState {
  config: SiteConfig;
  loaded: boolean;
  reload: () => void;
}

const Ctx = createContext<SiteConfigState>({ config: DEFAULT_SITE_CONFIG, loaded: false, reload: () => undefined });

export function SiteConfigProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ config: SiteConfig; loaded: boolean }>({ config: DEFAULT_SITE_CONFIG, loaded: false });
  const load = () => {
    fetchSiteConfig()
      .then((config) => setState({ config, loaded: true }))
      .catch(() => setState({ config: DEFAULT_SITE_CONFIG, loaded: true }));
  };
  useEffect(load, []);
  return <Ctx.Provider value={{ ...state, reload: load }}>{children}</Ctx.Provider>;
}

export const useSiteConfig = () => useContext(Ctx);

/** Logo <img> with fallback to the bundled logo, then to the company name, if the image fails. */
export function CompanyLogo({ config, className, height }: { config: SiteConfig; className?: string; height?: number }) {
  const [src, setSrc] = useState(logoUrl(config.company.logoPath));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setSrc(logoUrl(config.company.logoPath));
    setFailed(false);
  }, [config.company.logoPath]);
  if (failed) return <span className={`${className ?? ''} logo-fallback`}>{config.company.name}</span>;
  return (
    <img
      className={className}
      src={src}
      alt={config.company.logoAlt}
      height={height}
      onError={() => (src !== DEFAULT_LOGO_PATH ? setSrc(DEFAULT_LOGO_PATH) : setFailed(true))}
    />
  );
}
