# FieldCraft iOS App Store metadata draft

Last reviewed: 2026-08-09. This is a credential-free draft, not proof of an App Store Connect submission. The first release is iPhone-only; iPad support is deferred until its layout and device matrix are validated.

## Listing

- Name: `FieldCraft`
- Subtitle: `Jobs, invoices, and expenses`
- Primary language: `English (U.S.)`
- SKU: `fieldcraft-ios`
- Primary category: `Business`
- Secondary category: `Productivity`
- Copyright: `2026 Avinash Amanchi`
- Support URL: `https://avinashamanchi.github.io/fieldcraft/support.html`
- Privacy URL: `https://avinashamanchi.github.io/fieldcraft/privacy.html`
- Terms of Use URL: `https://avinashamanchi.github.io/fieldcraft/terms.html`
- Marketing URL: `https://avinashamanchi.github.io/fieldcraft/`

## Promotional text

Keep field-service work organized with editable job, client, invoice, expense, service, and inventory records that remain usable offline.

## Description

FieldCraft is a business-management workspace for independent tradespeople and small field-service teams.

Log jobs and clients, prepare editable invoices, record expenses, maintain a service and inventory catalog, and keep working with an on-device offline cache. FieldCraft calculates invoice amounts locally and queues authenticated cloud sync when a connection is available.

Optional AI can turn a transcript you review into an editable invoice draft or suggest an expense category. AI stays off until you consent, and manual entry remains available without AI. On-device speech recognition and receipt text recognition are available in the native iOS build when supported.

FieldCraft does not guarantee savings, revenue, payment, delivery, tax treatment, or accounting accuracy. Review every invoice, amount, client detail, and business record before using or sharing it.

## Keywords

`contractor,field,service,clients,inventory,estimates,offline,work,trade`

## Subscription listing draft

- Subscription group: `FieldCraft Pro`
- Products: `fieldcraft_pro_monthly` and `fieldcraft_pro_annual`
- RevenueCat entitlement/offering: `pro` / `default`
- Display the localized StoreKit price and period; do not hard-code launch prices in the binary or listing.
- Free currently supports 10 non-archived clients, 3 open jobs, and 5 newly issued estimates or invoices per rolling 30 days. Pro permits creation above those limits. Existing records remain readable and editable after downgrade.
- Each product still needs its App Store Connect localization, price point, availability, review screenshot, and sandbox/TestFlight verification.

## Review notes

- A provider-owned temporary review account must be supplied privately in App Store Connect; never add it to this repository.
- Manual local job and invoice entry works without AI. The `Quick local job note` flow creates an editable deterministic draft on device.
- Optional AI is off until the signed-in user explicitly grants consent. Requests pass through authenticated Supabase functions; no provider key is shipped in the app.
- Apple Speech and Vision require the native FieldCraft development/App Store build and cannot be validated in Expo Go. Typed invoice and expense entry remains available.
- The app does not send invoices automatically and does not claim the iOS share sheet delivered a document.
- Cloud sync and account deletion require the release operator's configured Supabase project.
- Authentication uses email and password only. FieldCraft offers no social or third-party login provider.
- The paywall exposes Restore Purchases, Apple subscription management, Privacy Policy, and Terms of Use. Deleting a FieldCraft account does not cancel an Apple subscription.

## App Privacy draft for App Store Connect

Confirm this against the deployed production configuration immediately before submission.

- Data used to track the user: `No`.
- Third-party advertising: `No`.
- Contact information: client/business names, phone numbers, email addresses, and addresses entered by the user; linked to the authenticated account; used for app functionality.
- User content: jobs, invoices, expenses, notes, service/inventory records, and a selected business logo; linked to the authenticated account; used for app functionality.
- Identifiers: Supabase account/user ID; linked to the user; used for authentication, security, deletion, and sync.
- Purchase history: product, entitlement, purchase, and expiration information is linked to the pseudonymous FieldCraft account ID and used for offering, restoring, and verifying Pro through Apple and RevenueCat. Recheck the final SDK manifests and App Store definitions.
- Diagnostics/other data: content-free request ID, route, status, rate-limit digest, and coarse latency/security metadata only if retained by the deployed function logs; used for security and app functionality, never tracking.
- Photos: receipt images stay local and are deleted from FieldCraft temporary storage after processing; the explicitly selected business logo can be uploaded to the account's owner-only Storage path.
- Audio: raw audio is processed for on-device transcription and is not uploaded by FieldCraft.
- Optional processor: a reviewed transcript or minimized reviewed expense fields can be sent to Groq through FieldCraft's authenticated function only after consent.
- Payment-card details, contacts address book, advertising data, precise location, health, fitness, browsing history, and search history: not collected by FieldCraft.

## Age rating and compliance draft

- Complete Apple's current age-rating questionnaire in App Store Connect; do not infer a final rating in this file.
- The app has no gambling, contests, unrestricted web browsing, user-to-user messaging, or mature content features.
- Complete export-compliance questions for HTTPS/TLS use based on the final binary and counsel/provider guidance.
- Complete required-reason API and privacy-manifest checks on the production archive, including every third-party SDK.
- Content-rights declaration, storefront availability, and Digital Services Act trader status require account-holder decisions in App Store Connect.

## Truthful release status

The source package is prepared only. On 2026-08-09 the public Privacy, Terms, and Support URLs returned HTTP 404. Supabase migrations/functions, RevenueCat products/offering/webhook, the production EAS environment, signed native Speech/Vision and purchase tests, screenshots, App Store Connect forms, upload, review, acceptance, and publication remain pending.
