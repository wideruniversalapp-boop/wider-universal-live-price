# Deployment Guide

**Status: not deployed yet.** Everything has been built and tested on the local Firebase emulators
(see [TEST_REPORT.md](TEST_REPORT.md)). Follow the steps in order. Steps marked **(you)** need your Google account,
a password or a payment card, so you do them yourself; the rest can be done by Claude or a developer.

Commands are for **Windows PowerShell**, run in the project folder.

---

## Part A — Create the Firebase project (you, ~20 minutes)

Do this twice if you want a **staging** copy for testing before **production** (recommended; both are free at your
usage). Example names: `wider-catalog-staging` and `wider-catalog-prod`.

1. **(you)** Go to https://console.firebase.google.com, signed in with the Google account that should **own** the
   site (it can be any Google account, including a company email registered as a Google account).
   **Add project** → name it → Google Analytics can be turned off.
2. **(you)** **Upgrade to Blaze** (bottom-left, *Spark → Upgrade*). A payment card is required, but at this catalog's
   size usage stays within the free allowance. Then in Google Cloud Billing → **Budgets & alerts**, create an alert
   (e.g. USD 5). An alert emails you; it does not stop the service.
3. **(you)** **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
   Then **Settings → User actions**: untick *Enable create (sign-up)*, and tick *Email enumeration protection*.
4. **(you)** **Build → Firestore Database → Create database** → *production mode* → region **me-central2 (Dammam)**
   (or `europe-west1`). The region cannot be changed later.
5. **(you)** **Build → Storage → Get started** → same region.
6. **(you)** **Project settings (gear) → General → Your apps → Web (</>)** → register an app (no Hosting checkbox
   needed) → copy the `firebaseConfig` values (apiKey, authDomain, projectId, storageBucket, appId). These are public
   identifiers, not passwords.
7. **(you)** **Project settings → Service accounts → Generate new private key.** Save the JSON file in a folder
   **outside** the project, e.g. `C:\FirebaseKeys\wider-staging.json`. This one *is* secret: never email it or
   put it in the project folder. It is only needed for the one-time data loading below.

## Part B — Connect this computer (you, 2 minutes)

```bash
npx firebase login
```

A browser window opens; sign in with the same Google account. Check with:

```bash
npx firebase login:list
```

## Part C — Configure the project (Claude / developer)

1. In `.firebaserc`, replace `REPLACE-WITH-STAGING-PROJECT-ID` / `REPLACE-WITH-PRODUCTION-PROJECT-ID` with the
   project IDs.
2. Create `.env.staging` (and later `.env.production`) from `.env.example` with the web-app values from A6 and
   `VITE_USE_EMULATORS=false`.
3. In `storage.cors.json`, replace the placeholder origins with the site addresses
   (`https://<project-id>.web.app`, `https://<project-id>.firebaseapp.com`, and the custom domain if any).

## Part D — Deploy the website and security rules (Claude / developer)

```bash
npm run deploy:staging
```

This first checks that `.env.staging` and `.firebaserc` are complete and point at the real project (it stops with a clear message if not), then type-checks, builds the site with `.env.staging`, and deploys hosting, `firestore.rules`,
`firestore.indexes.json` and `storage.rules`. Index builds can take a few minutes.

Allow PDFs to embed uploaded logos and banners (needs the Google Cloud CLI, `gcloud`, or do it in Cloud Shell in the
Google Cloud console):

```bash
gcloud storage buckets update gs://<storage-bucket> --cors-file=storage.cors.json
```

## Part E — Load the data (Claude / developer, once per project)

Point the scripts at the key from A7 for this PowerShell window:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\FirebaseKeys\wider-staging.json"
```

Then, in order:

| # | Command | What it does |
|---|---|---|
| 1 | `npm run seed -- --project <id> --bucket <storage-bucket> --dry-run` | Preview the catalog load (no writes) |
| 2 | `npm run seed -- --project <id> --bucket <storage-bucket>` | Loads 1,291 products, reference data, 1,110 images, brands, categories |
| 3 | `npm run pdf:apply -- --project <id> --apply --set-selling-price` | Sets the selling prices from the supplied PDF price lists: 1,289 matched products (on a fresh project none have a price yet, so all are set; the 2 review items stay "on request") |
| 4 | `npm run contacts:publish -- --project <id>` | Publishes the Jeddah / Riyadh / Al Khobar branch contacts |
| 5 | `npm run verify -- --project <id>` | Checks the database against the source dataset |
| 6 | `npm run index:rebuild -- --project <id>` | Builds the fast public price-list index (steps 2–3 also do this) |

All of these can be re-run safely. `seed` never overwrites prices or edits made in the admin panel.

## Part F — Create your administrator account

1. **(you)** Firebase console → **Authentication → Users → Add user** → your admin email and a strong password
   (12+ characters). The admin email can be any address.
2. Grant admin rights (with the key from A7 set as in Part E):

```bash
npm run set-admin -- --project <id> --email you@example.com
```

Remove access later with the same command plus `--revoke`.

3. **(you)** Open `https://<project-id>.web.app/admin`, sign in, then:
   - **Website settings → Save and publish** once (creates the live settings: logo, header, footer, PDF branding).
   - Check the Contact link in Website settings → Header points to `/contact`.
   - Optional: **Brands & categories → Brand spotlight** headlines and banners.
4. **(you, recommended)** Turn on **multi-factor authentication** for admin accounts (Authentication → Sign-in method
   → Multi-factor; requires upgrading to Identity Platform, authenticator-app codes have no per-use charge).

## Part G — Review staging, then production

On `https://<staging-id>.web.app` check:

- Catalog loads; search, brand chips, category/sort filters, Offers and Price-drops chips work.
- A product row opens with specs; **Add to quote list** works; `/quote` sends to WhatsApp and email.
- Contact page shows the three branches; Call and Email buttons work.
- PDF price list downloads with the logo, company details and correct prices.
- Admin: sign in, edit a price (the change shows publicly), stock change, import preview, image upload.
- A non-admin account gets "Access denied".
- Browser console: no **Content-Security-Policy** report messages. If clean, rename the header in `firebase.json`
  from `Content-Security-Policy-Report-Only` to `Content-Security-Policy` and redeploy.

Then repeat **A–F for production** with `.env.production`, the production key, `--project <prod-id>` and:

```bash
npm run deploy:production
```

## Part H — Custom domain (optional)

Hosting → **Add custom domain** → e.g. `catalog.wideruniversal.com`. Add the TXT and A records it shows at your
domain provider; the HTTPS certificate is issued automatically (up to 24 hours). Then add the domain under
**Authentication → Settings → Authorized domains** and to `storage.cors.json` (re-run the CORS command).

## Part I — After launch

- **Delete the service-account key file** from your computer (A7) if you do not need the scripts regularly; create a
  new one when needed.
- **Backups:** Firestore → *Disaster recovery* → enable point-in-time recovery, and schedule daily backups:

```bash
gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=14w --project=<prod-id>
```

- Restore a whole database: `gcloud firestore import gs://…` into a fresh project first, then switch.
  Single products: every change is in the audit history, and imports can be reverted from Admin → Import / export.
- **Costs:** watch Firebase console → *Usage and billing*. The public catalog uses about 3 database reads per visit.
- Optional: **App Check** to limit scripted abuse.

## Security checklist before go-live

- [ ] Sign-up disabled and email enumeration protection on (A3).
- [ ] Only intended people have admin rights (`npm run set-admin`); multi-factor on for them.
- [ ] Service-account key kept outside the project folder; deleted after setup if not needed.
- [ ] Rules deployed (Part D) and CORS set.
- [ ] `settings/site` published from Website settings; contacts published.
- [ ] CSP switched to enforced after the staging check.
- [ ] Prices reviewed: selling prices come from the supplied Simat PDFs; 2 items (SL59-100, SLF-06) need manual
      prices; 3 PDF prices are Simat promotional prices (SL-B10W, M8-NVR, SL59-100) — see
      `data/pdf_price_import/price_update_report.md`.
- [ ] Rights to reuse the product photos and descriptions confirmed (see `data/extraction_report.md`).
- [ ] The test product "WU-TEST-001 / Wider Test" exists only in the local test data — it is not in the production
      dataset.
