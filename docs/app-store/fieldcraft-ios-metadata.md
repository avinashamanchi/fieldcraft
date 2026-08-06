# FieldCraft iOS App Store metadata draft

Last reviewed: 2026-08-06. This is a credential-free draft, not proof of an App Store Connect submission.

## Listing

- Name: `FieldCraft`
- Subtitle: `Jobs, invoices, and expenses`
- Primary category: `Business`
- Secondary category: `Productivity`
- Copyright: `2026 Avinash Amanchi`
- Support URL: `https://avinashamanchi.github.io/fieldcraft/support.html`
- Privacy URL: `https://avinashamanchi.github.io/fieldcraft/privacy.html`
- Marketing URL: `https://avinashamanchi.github.io/fieldcraft/`

## Promotional text

Keep field-service work organized with editable job, client, invoice, expense, service, and inventory records that remain usable offline.

## Description

FieldCraft is a business-management workspace for independent tradespeople and small field-service teams.

Log jobs and clients, prepare editable invoices, record expenses, maintain a service and inventory catalog, and keep working with an on-device offline cache. FieldCraft calculates invoice amounts locally and queues authenticated cloud sync when a connection is available.

Optional AI can turn a transcript you review into an editable invoice draft or suggest an expense category. AI stays off until you consent, and manual entry remains available without AI. On-device speech recognition and receipt text recognition are available in the native iOS build when supported.

FieldCraft does not guarantee savings, revenue, payment, delivery, tax treatment, or accounting accuracy. Review every invoice, amount, client detail, and business record before using or sharing it.

## Keywords

`field service,jobs,invoices,expenses,contractor,offline,clients,inventory,estimates`

## Review notes

- A provider-owned temporary review account must be supplied privately in App Store Connect; never add it to this repository.
- Manual local job and invoice entry works without AI. The `Quick local job note` flow creates an editable deterministic draft on device.
- Optional AI is off until the signed-in user explicitly grants consent. Requests pass through authenticated Supabase functions; no provider key is shipped in the app.
- Apple Speech and Vision require the native FieldCraft development/App Store build and cannot be validated in Expo Go. Typed invoice and expense entry remains available.
- The app does not send invoices automatically and does not claim the iOS share sheet delivered a document.
- Cloud sync and account deletion require the release operator's configured Supabase project.

## App Privacy draft for App Store Connect

Confirm this against the deployed production configuration immediately before submission.

- Data used to track the user: `No`.
- Third-party advertising: `No`.
- Contact information: client/business names, phone numbers, email addresses, and addresses entered by the user; linked to the authenticated account; used for app functionality.
- User content: jobs, invoices, expenses, notes, service/inventory records, and a selected business logo; linked to the authenticated account; used for app functionality.
- Identifiers: Supabase account/user ID; linked to the user; used for authentication, security, deletion, and sync.
- Diagnostics/other data: content-free request ID, route, status, rate-limit digest, and coarse latency/security metadata only if retained by the deployed function logs; used for security and app functionality, never tracking.
- Photos: receipt images stay local and are deleted from FieldCraft temporary storage after processing; the explicitly selected business logo can be uploaded to the account's owner-only Storage path.
- Audio: raw audio is processed for on-device transcription and is not uploaded by FieldCraft.
- Optional processor: a reviewed transcript or minimized reviewed expense fields can be sent to Groq through FieldCraft's authenticated function only after consent.
- Payments, contacts address book, advertising data, precise location, health, fitness, browsing history, and search history: not collected by FieldCraft.

## Age rating and compliance draft

- Complete Apple's current age-rating questionnaire in App Store Connect; do not infer a final rating in this file.
- The app has no gambling, contests, unrestricted web browsing, user-to-user messaging, or mature content features.
- Complete export-compliance questions for HTTPS/TLS use based on the final binary and counsel/provider guidance.
- Complete required-reason API and privacy-manifest checks on the production archive, including every third-party SDK.
