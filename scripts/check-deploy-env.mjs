/**
 * Run by `npm run deploy:staging` / `deploy:production` before building.
 * Stops the deploy when the Firebase web-app settings for that target are missing, still point
 * at the local emulators, or name the local test project. An incomplete configuration builds
 * without errors but shows a blank page once hosted.
 *
 *   node scripts/check-deploy-env.mjs staging|production
 */
import { existsSync, readFileSync } from 'node:fs';

const mode = process.argv[2];
const REQUIRED = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_APP_ID'];

// Same files and priority as Vite: .env.<mode>.local overrides .env.<mode>.
const env = {};
for (const file of [`.env.${mode}`, `.env.${mode}.local`]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const problems = [];
const missing = REQUIRED.filter((k) => !env[k]);
if (missing.length) problems.push(`missing ${missing.join(', ')}`);
if (env.VITE_USE_EMULATORS === 'true') problems.push('VITE_USE_EMULATORS must be false');
if ((env.VITE_FIREBASE_PROJECT_ID ?? '').startsWith('demo-')) problems.push(`${env.VITE_FIREBASE_PROJECT_ID} is the local test project`);
const rc = existsSync('.firebaserc') ? JSON.parse(readFileSync('.firebaserc', 'utf8')) : {};
const alias = rc.projects?.[mode];
if (!alias || alias.startsWith('REPLACE-')) problems.push(`set the "${mode}" project ID in .firebaserc`);
else if (env.VITE_FIREBASE_PROJECT_ID && alias !== env.VITE_FIREBASE_PROJECT_ID) problems.push(`.firebaserc "${mode}" is ${alias} but .env.${mode} is ${env.VITE_FIREBASE_PROJECT_ID}`);

if (!['staging', 'production'].includes(mode)) problems.unshift('usage: node scripts/check-deploy-env.mjs staging|production');
if (problems.length) {
  console.error(`Deploy stopped (${mode}): ${problems.join('; ')}. See DEPLOYMENT.md, Part C.`);
  process.exit(1);
}
console.log(`Deploy settings for ${mode} look complete (project ${env.VITE_FIREBASE_PROJECT_ID}).`);
