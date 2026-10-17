/**
 * Grant or revoke administrator access (server-side custom claim `admin: true`).
 *
 *   npm run set-admin -- --project <id> --email someone@example.com
 *   npm run set-admin -- --project <id> --email someone@example.com --revoke
 *   npm run set-admin -- --emulator --project demo-wider --email admin@example.test --create
 *
 * --create makes the account if it does not exist, using the password in the
 * ADMIN_PASSWORD environment variable (never pass passwords on the command line).
 * The user must sign out and in again (the dashboard refreshes the token on load).
 */
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { arg, flag, initAdmin } from './admin-init';

async function main() {
  initAdmin();
  const email = arg('email');
  if (!email) throw new Error('Pass --email <address>');
  const auth = getAuth();
  let user = await auth.getUserByEmail(email).catch(() => null);
  if (!user) {
    if (!flag('create')) throw new Error(`No account for ${email}. Create it in the Firebase console (Authentication) or pass --create.`);
    const password = process.env.ADMIN_PASSWORD;
    if (!password || password.length < 10) throw new Error('Set ADMIN_PASSWORD (min 10 characters) to create the account.');
    user = await auth.createUser({ email, password, emailVerified: true });
    console.log(`Created account ${email}`);
  }
  const revoke = flag('revoke');
  const claims = { ...(user.customClaims ?? {}) };
  if (revoke) delete claims.admin;
  else claims.admin = true;
  await auth.setCustomUserClaims(user.uid, claims);
  if (revoke) await auth.revokeRefreshTokens(user.uid);
  await getFirestore().doc(`users/${user.uid}`).set(
    { email, role: revoke ? 'none' : 'admin', updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  console.log(`${revoke ? 'Revoked' : 'Granted'} administrator access for ${email} (${user.uid}).`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
