# FieldCraft — Apple App Review guideline applicability

Reviewed against Apple's App Review overview and App Review Guidelines on 2026-08-10. This is a source-package control, not an approval prediction. `IMPLEMENTED` means repository evidence exists; `EXTERNAL GATE` requires a live service, signed build, device, credentialed account, or reviewer action; `N/A` means the capability is absent and must stay absent unless this matrix is reviewed again.

| Guideline | Status | FieldCraft decision and evidence |
| --- | --- | --- |
| 1.1 Objectionable content | IMPLEMENTED | FieldCraft creates private business records. It has no public feed or supplied offensive content. User-entered text remains private to the authenticated workspace. |
| 1.2 User-generated content | N/A | No publishing, discovery, following, random chat, or user-to-user content exchange. Adding any community feature requires moderation, reporting, blocking, and contact controls first. |
| 1.3 Kids Category | N/A | General business app, not directed to children, with no Kids Category claim or child-oriented marketing. |
| 1.4 Physical harm | IMPLEMENTED | Invoice, tax, expense, profit, and AI output are editable records, not professional/accounting guarantees; review language is in-app and in metadata. |
| 1.5 Developer information | EXTERNAL GATE | App Store seller, review contact, support contact, and legal entity must be accurate and reachable in App Store Connect. |
| 1.6 Data security | IMPLEMENTED + EXTERNAL GATE | Authenticated owner boundaries, encrypted HTTPS services, protected local secrets, row-level authorization, deletion, and security tests exist. Production Supabase/RevenueCat configuration and signed archive evidence remain required. |
| 1.7 Reporting criminal activity | N/A | The app does not report or facilitate reporting alleged crimes. |
| 2.1 App completeness | EXTERNAL GATE | Automated tests and export gates exist. Do not submit until the production backend, subscriptions, demo account, every link, and every signed-device flow work with no placeholder state. |
| 2.2 Beta testing | EXTERNAL GATE | Use development builds/TestFlight for unfinished builds; App Store metadata must not call the production binary beta, demo, or test. |
| 2.3 Accurate metadata | IMPLEMENTED + EXTERNAL GATE | Draft metadata describes actual limits, AI behavior, subscriptions, iPhone scope, and no guarantees. Final screenshots, age rating, privacy answers, seller, category, and version text require App Store Connect verification. |
| 2.4 Hardware compatibility | IMPLEMENTED + EXTERNAL GATE | iPhone-only portrait v1, 48-point targets, Dynamic Type/VoiceOver-oriented UI, bounded local data, and no background task claim. Test the signed archive on supported iPhones and disable untested Mac/Vision availability. |
| 2.5 Software requirements | IMPLEMENTED + EXTERNAL GATE | Uses public Expo/iOS APIs, HTTPS, App Sandbox, no downloaded executable code, no hidden background mode, and explicit camera/photo/microphone/speech purpose strings. Archive privacy-manifest and IPv6-only validation remain gates. |
| 3.1.1 In-App Purchase | IMPLEMENTED + EXTERNAL GATE | Digital Pro limits use Apple IAP through RevenueCat only. StoreKit-localized monthly/annual prices, purchase, restore, and management are coded; products and sandbox/TestFlight verification remain external. |
| 3.1.2 Subscriptions | IMPLEMENTED + EXTERNAL GATE | Ongoing synced business capacity supports auto-renewing Pro. Free remains usable; benefits, period, renewal, cancellation, privacy, terms, and downgrade behavior are disclosed. Use one subscription group and submit the first IAP with the app version. |
| 3.1.3 Other purchase methods | IMPLEMENTED | FieldCraft does not steer users to external payment for digital app features. Customer invoice/payment records concern real-world trade services and must never unlock digital FieldCraft functionality. |
| 3.2 Other business-model rules | N/A | No reader content, enterprise-only distribution, crypto, advertising management, person-to-person gifts, loans, trading, or regulated financial service. |
| 4.1 Copycats | IMPLEMENTED | Original FieldCraft name/assets and field-service workflow. Final screenshots/assets require rights verification. |
| 4.2 Minimum functionality | IMPLEMENTED | Native offline workspace, camera/photo receipt selection, speech transcription, PDF/share, sync, conflict handling, and secure account controls—not a web clipping. |
| 4.3 Spam | IMPLEMENTED | FieldCraft has a distinct field-service purpose from the other apps. Do not submit cloned metadata, screenshots, icons, or binaries. |
| 4.4 Extensions | N/A | No app extensions. |
| 4.5 Apple sites/services and 4.6 alternate icons | N/A | No Apple-site scraping, Apple impersonation, or alternate-icon claim. |
| 4.7 Mini apps/plug-ins | N/A | No embedded mini-app, HTML game, plug-in, or downloaded-code catalog. |
| 4.8 Login services | IMPLEMENTED | Only FieldCraft's first-party email/password account is offered; no third-party/social login is present, so Sign in with Apple parity is not triggered. |
| 4.9 Apple Pay | N/A | No Apple Pay transaction. Future real-world customer payments require a separate payments review; Apple Pay branding cannot be added before integration. |
| 4.10 Monetizing built-in capabilities | IMPLEMENTED | No charge for push, camera, microphone, speech, or other built-in iOS capabilities themselves. Pro gates business capacity. |
| 5.1 Privacy | IMPLEMENTED + EXTERNAL GATE | In-app disclosures cover local/cache/cloud data, Supabase, optional AI/Groq, Apple/RevenueCat, retention, consent revocation, local deletion, and account deletion. Public policy must return HTTPS 200 and match the final binary/provider settings. |
| 5.1.1 Collection/minimization | IMPLEMENTED | No contacts, card details, ads, or tracking; raw audio and receipt images stay local. AI is off until explicit versioned consent and manual entry remains available. |
| 5.1.1(v) Account deletion | IMPLEMENTED + EXTERNAL GATE | In-app Delete Account exists. Verify recent-auth/MFA, backend erasure, retries, retention exceptions, and signed-device behavior against production before submission. |
| 5.1.2 Data use/sharing | IMPLEMENTED + EXTERNAL GATE | Reviewed text is sent to the disclosed processor only with consent; privacy copy names processors and protections. Verify final contracts/settings and App Privacy answers. |
| 5.2 Intellectual property | IMPLEMENTED + EXTERNAL GATE | Users must have rights to records/logos/content. Confirm every bundled and screenshot asset license and seller/copyright entry. |
| 5.3 Gaming/gambling, 5.4 VPN, 5.5 device management | N/A | No gaming, gambling, lottery, VPN, root certificate, MDM, or device-security product. |
| 5.6 Developer conduct | EXTERNAL GATE | Maintain honest metadata/support, no review manipulation, no private API, no copied assets, and prompt responses to App Review. |

## Submission-stopping external gates

- Privacy, Terms, and Support URLs must return HTTPS 200 with current content.
- Production Supabase migrations/functions and RevenueCat products, entitlement, offering, webhook, and transfer behavior must be directly verified.
- A stable private review account must expose all account-based features; MFA/recovery instructions belong in Review Notes.
- The exact signed archive must pass device, permission, accessibility, offline/reconnect, deletion, purchase/restore/refund, crash, privacy-manifest, and IPv6-only checks.
- Screenshots must be captured from the submitted build with no private customer data and must accurately represent each device size.
- Paid Apps Agreement, tax/banking, age rating, App Privacy, content rights, DSA status, availability, export compliance, and IAP review metadata must be complete.

Optional offer codes, win-back offers, promoted IAP, Family Sharing, custom product pages, and alternative distribution/payment terms are disabled for v1. They are not compliance requirements and must not be enabled without separate configuration, policy, and signed testing.
