# Contact Page, Contact Management & Header — Change Report

Date: 2026-10-15. Tested on the local Firebase emulators. **Not deployed.**

The contact-page reference screenshot did not come through with the request, so the layout follows the written brief:
* One card per branch, each with a location icon.
* For each contact: name, telephone and email shown as selectable text, with Call and Email buttons.

## What changed

### Contact page: `/contact`
* Page heading and an optional introduction, both editable.
* Cards for the **Jeddah**, **Riyadh** and **Al Khobar** branches.
* Layout:
  * 3 columns on desktop, 2 on tablet, 1 on mobile.
  * 1 px borders, light shadows and a navy top rule on each card.
  * No gradients or animation, apart from the loading placeholder.
* Telephone numbers and emails are plain selectable text, so they're easy to read and copy.
* **Call** uses `tel:+966…`. **Email** uses `mailto:` with an enquiry subject that includes the branch name.
* A branch can have several contacts, each with its own Call and Email buttons.
* If a contact has only a phone or only an email, only that button is shown.
* Loading, error and "being updated" states are handled.
* The details are exactly as supplied:

| Branch | Contact | Telephone | Email |
|---|---|---|---|
| Jeddah Branch | Rauf | +966 51 121 1028 | Salesjeddah@wideruniversal.com |
| Riyadh Branch | Savan Abdulla | +966 56 332 6309 | abdulla@theuniversalgrp.com |
| Al Khobar Branch | Sulthan | +966 55 882 9335 | Saleskhobar@wideruniversal.com |

* No contact details are written into the page code. They are loaded from the database. The initial values come from `data/contacts.initial.json`, published once with `npm run contacts:publish`. A check of the built site confirmed none of these details are in it.

### Admin → Contacts: `/admin/contacts`
* **Branches:** add, edit name and optional location, show/hide, reorder, delete (with confirmation).
* **Contacts:** add several per branch, edit name, optional role, telephone and email, reorder, remove (with confirmation).
* Telephone numbers and emails are validated as you type. Saving is blocked while any field is invalid, and the public page keeps the last published version.
* **Save and publish** updates the public page immediately. **Cancel** asks before discarding.
* An unsaved-changes guard and a live card preview are included.
* Every save is recorded in the audit history (see Website settings → Change history).

### Header
* **Logo lockup:** the official logo, a thin divider, then a two-line wordmark. "WIDER UNIVERSAL" is bold navy; "TRADING COMPANY" is smaller, letter-spaced and blue. The name comes from Website settings.
* **WhatsApp button removed from the header.** In its place is a navy **Main Website** button that opens https://wideruniversal.com/ in a new tab (`rel="noopener noreferrer"`). The address, label and visibility are set in Website settings. The WhatsApp "Request a quotation" button on the catalog and the product-page enquiry buttons are kept.
* The current page is shown with an underline on the matching menu item.
* The header "Contact" link now opens `/contact` by default, and the footer has an "All branch contacts →" link.
* The menu now collapses at tablet width (≤ 900 px), not only on phones. This prevents the header from becoming crowded on tablets.
* There is no Admin link anywhere on the public site. The admin area stays at `/admin`.

## Security
* New Firestore document `contactDirectory/published`:
  * Anyone can read it.
  * Only administrators (server-side `admin` claim) can write it, and only together with an audit record by the same administrator at the same server time.
  * The rules check its shape: allowed fields, a non-empty title, the intro length, branches as a list with at most 20 entries.
  * It cannot be deleted, and other documents in the collection are denied.
* Telephone numbers and emails are validated in the editor and checked again before display, so invalid values are never shown or linked. Firestore rules cannot loop over nested lists, so they cannot check each number individually.
* Existing authentication, rules and permissions are unchanged.

## Tests
| Suite | Result |
|---|---|
| Unit | **39 / 39**. New: supplied details unchanged, `tel:` and `mailto:` links, phone/email validation, field-level errors, hidden branches, public filtering of invalid details, damaged data, wordmark split. |
| Firestore and Storage rules | **38 / 38**. New: public read; admin publish with an audit record; anonymous and non-admin writes denied; missing or forged audit record, bad shape, more than 20 branches, other document IDs, and deletion all denied. |
| Python | 5 / 5 |
| Typecheck, production build, `npm audit --omit=dev` | Pass, 0 vulnerabilities |

Browser checks:

| Check | Result |
|---|---|
| The three branch cards | Show exactly the supplied details. Call links are `tel:+966511211028`, `tel:+966563326309` and `tel:+966558829335`; Email links go to the matching addresses. |
| Admin: invalid email | Blocked with an inline error. |
| Admin: edits | Added a second Riyadh contact, changed the Jeddah email and added a branch; the public page showed all of it after Save and publish. |
| Admin: reorder, hide, delete | Reordering and hiding work; deleting a branch and removing a contact work. The original details were then restored. |
| Unauthenticated API calls (live emulator) | Write, delete, and writing another document are all refused (403). Public read works (200). |
| Header | No WhatsApp button; Main Website button present with safe link attributes; no admin links on public pages. |
| Layout | Desktop (1280 and 1000 px), tablet (768 px) and mobile (375 px): no overlap or horizontal overflow, 42 px buttons. |
| Regression | Catalog search and filters, PDF download (logo, prices, website) and prices unchanged. No console errors. |

## Files
* **New:**
  * `src/lib/contacts.ts`, `src/lib/contactsStore.ts`
  * `src/pages/ContactPage.tsx`, `src/pages/admin/ContactsAdmin.tsx`
  * `scripts/publish-contacts.ts`, `data/contacts.initial.json`
  * `tests/unit/contacts.test.ts`
* **Modified:**
  * `src/components/Layout.tsx` (header lockup, Main Website button, active nav item, footer link)
  * `src/lib/siteConfig.ts` (Contact link default `/contact`, WhatsApp header default off, `splitCompanyName`)
  * `src/pages/admin/Settings.tsx` (WhatsApp header options removed; contact entries in the change history are not loadable into the site editor)
  * `src/pages/admin/AdminLayout.tsx` (Contacts menu item), `src/App.tsx` (routes), `src/styles.css`
  * `firestore.rules`, `tests/rules/firestore.rules.test.ts`, `package.json` (`contacts:publish` script)

Backups from before this change:
* Code: `backups/code-before-contacts/`
* Database: `backups/firestore-emulator-2026-10-15T13-39-12-773Z.json`

## Deployment (when approved)
1. Deploy to staging (app, rules and indexes):
   ```bash
   npm run deploy:staging
   ```
2. Publish the initial contacts once. They are maintained in Admin → Contacts after that.
   ```bash
   npm run contacts:publish -- --project <id>
   ```
3. If `settings/site` was already published with the old Contact link (`#contact`), change it to `/contact` in Admin → Website settings → Header.
