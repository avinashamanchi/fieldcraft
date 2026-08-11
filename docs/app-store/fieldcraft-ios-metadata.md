# FieldCraft iOS App Store metadata draft

Last reviewed: 2026-08-11. This is a credential-free draft, not proof of an App Store Connect submission. The first release is iPhone-only; iPad support is deferred until its layout and device matrix are validated. The complete applicability record is `apple-review-guideline-applicability.md`.

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

Take a job from estimate to invoice, partial payment, reminder, and export—with an offline workspace that keeps the source of truth visible.

## Description

FieldCraft is a business-management workspace for independent tradespeople and small field-service teams.

Create clients, estimates, jobs, and editable invoices; record manual or provider-confirmed partial payments; schedule consented invoice reminders; export account data; track expenses; and maintain service and inventory catalogs. Bounded lists and an on-device cache keep the workspace usable offline while authenticated changes queue for cloud sync.

FieldCraft Pro expands creation capacity and enables connected Stripe-hosted payment links and scheduled reminders. Customer payments are only for real-world trade services, never digital app access. Payment state remains pending until a signed provider webhook confirms it, and Apple Pay appears on hosted checkout only when available and eligible.

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
- Keep that review account active for the full review window, pre-complete onboarding with synthetic business data, and include any MFA/recovery steps plus a direct support contact in App Review Information.
- Reviewer path: sign in with the private review account; open the prepared estimate; convert it to a job; issue the prepared invoice; record a partial manual payment; inspect the payment history; create/revoke the sandbox customer payment link; enable/disable the consented reminder; export account data; then open Settings for AI consent, privacy, sync, subscription, local deletion, and account deletion.
- Manual local job and invoice entry works without AI. The `Quick local job note` flow creates an editable deterministic draft on device.
- Optional AI is off until the signed-in user explicitly grants consent. Requests pass through authenticated Supabase functions; no provider key is shipped in the app.
- Apple Speech and Vision require the native FieldCraft development/App Store build and cannot be validated in Expo Go. Typed invoice and expense entry remains available.
- The app does not send invoices automatically and does not claim the iOS share sheet delivered a document.
- Cloud sync and account deletion require the release operator's configured Supabase project.
- Authentication uses email and password only. FieldCraft offers no social or third-party login provider.
- The paywall exposes Restore Purchases, Apple subscription management, Privacy Policy, Terms of Use, FieldCraft Support, and Apple's purchase/refund-help page. Apple determines refund eligibility. Deleting a FieldCraft account does not cancel an Apple subscription.
- `fieldcraft_pro_monthly` and `fieldcraft_pro_annual` unlock digital FieldCraft capacity and therefore use Apple IAP only. Stripe-hosted invoice payments concern the user's real-world trade services; they never unlock app features, never alter the RevenueCat entitlement, and are not an alternative checkout for Pro. The app never treats the checkout redirect as payment truth.
- Offer codes, win-back offers, promoted IAP, Family Sharing, and alternative digital payments are disabled for v1 unless separately configured, documented, and tested in the exact signed candidate.

## App Privacy draft for App Store Connect

Confirm this against the deployed production configuration immediately before submission.

- Data used to track the user: `No`.
- Third-party advertising: `No`.
- Contact information: client/business names, phone numbers, email addresses, and addresses entered by the user; linked to the authenticated account; used for app functionality.
- User content: jobs, invoices, expenses, notes, service/inventory records, and a selected business logo; linked to the authenticated account; used for app functionality.
- Identifiers: Supabase account/user ID; linked to the user; used for authentication, security, deletion, and sync.
- Purchase history: product, entitlement, purchase, and expiration information is linked to the FieldCraft account ID and used for Analytics and App Functionality, including offering, restoring, and verifying Pro through Apple and RevenueCat. It is not used for tracking. Recheck the final SDK manifests and App Store definitions.
- Purchases/financial information for customer invoices: invoice amount, currency, payment/refund/dispute state, and provider identifiers are linked to the business account and used for App Functionality. Full card and bank-account details entered only on Stripe-hosted checkout are not accessible to FieldCraft; confirm the final App Privacy answer against the deployed Stripe integration.
- Contact information used for reminders: a recipient email and business reply-to address are linked to the business account and sent to the configured reminder provider for App Functionality only after recorded consent.
- Diagnostics/other data: content-free request ID, route/provider/deployment label, rotating owner digest, status/reason, and coarse latency/security metadata only if retained by the deployed function logs; used for security and app functionality, never tracking.
- Photos: receipt images stay local and are deleted from FieldCraft temporary storage after processing; the explicitly selected business logo can be uploaded to the account's owner-only Storage path.
- Audio: raw audio is processed for on-device transcription and is not uploaded by FieldCraft.
- Optional processor: a reviewed transcript or minimized reviewed expense fields can be sent to Groq through FieldCraft's authenticated function only after consent.
- Payment-card/bank numbers, contacts address book, advertising data, precise location, health, fitness, browsing history, and search history: not collected by FieldCraft. Card/bank data entered on Stripe's hosted surface stays with Stripe.

## Age rating and compliance draft

- Complete Apple's current age-rating questionnaire in App Store Connect; do not infer a final rating in this file.
- The app has no gambling, contests, unrestricted web browsing, user-to-user messaging, or mature content features.
- Complete export-compliance questions for HTTPS/TLS use based on the final binary and counsel/provider guidance.
- Complete required-reason API and privacy-manifest checks on the production archive, including every third-party SDK.
- Content-rights declaration, storefront availability, and Digital Services Act trader status require account-holder decisions in App Store Connect.

## Truthful release status

The source package and legal-site update are prepared only. The previously published Privacy, Terms, and Support pages returned HTTPS 200 on 2026-08-10, but the August 11 Stripe/reminder/retention revisions must be published and rechecked byte for byte after merge. Supabase migrations/functions, RevenueCat products/offering/webhook, Stripe/reminder-provider configuration, the production EAS environment, signed native/provider/purchase tests, live staging load, screenshots, App Store Connect forms, upload, review, acceptance, and publication remain pending.
