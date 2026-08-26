## 1. Local Development Foundation

- [ ] 1.1 Set up docker-compose orchestrating three containers (Next.js, Python PDF Processing Service, self-hosted PostgreSQL) on an internal Docker network for local development only — no public ingress yet; verify all three start and reach each other by service name
- [ ] 1.2 Configure PostgreSQL in its own container with a dedicated named Docker volume, separate from the Next.js and Python service containers; verify the volume survives `docker compose down`/rebuild of the other two containers
- [ ] 1.3 Implement the persistence schema for User, Identity, Child, WorksheetArchive, GradingSession, ErrorQuestion, CorrectionWorksheet (D4/D7) using standard, portable PostgreSQL (no non-standard extensions); verify migrations apply cleanly to a fresh instance
- [ ] 1.4 Add a local-dev-only seed script inserting one allowlisted User/Identity/Child row for manual end-to-end testing; explicitly not a production auth path — verify the seeded identity can be used to drive the workflow manually ahead of real Auth (Group 5) being built

## 2. Storage Core (OSS)

- [ ] 2.1 Configure a private OSS bucket (D10): no public-read/public-write, versioning enabled; verify bucket ACL and versioning settings
- [ ] 2.2 Implement StorageService issuance of short-lived, scope-limited STS credentials (multipart upload) and presigned URLs (simple upload) for browser direct upload (D9); verify an issued credential cannot list, delete, or access objects outside its granted key
- [ ] 2.3 Implement server-side upload verification (object existence, size, content-type, checksum) gating Asset availability (D9); verify a browser-reported "upload success" without server verification does not produce a usable Asset
- [ ] 2.4 Implement server-generated, unique, unpredictable object keys for original assets, with re-upload creating a new Asset rather than overwriting; verify a repeated upload does not replace the existing object
- [ ] 2.5 Implement StorageService's signed GET URL issuance capability for private assets; in the local walking skeleton, gate it with an explicit dev identity / caller-context ownership check (using the Group 1.4 seeded identity) — not yet a full authenticated session; verify a request without any caller context is rejected and a request for an asset owned by a different identity is rejected. (Re-verified against real authenticated User + ownership in 5.5 — do not reimplement signed-URL logic there.)
- [ ] 2.6 Verify original PDF and grading-photo assets remain accessible and byte-identical after rebuilding/redeploying the Next.js container (worksheet-archive spec/grading-workflow spec/D3); record the verification

(OSS cross-account/cross-region backup replication is in Group 10 — Data Protection — not here, since it hardens recovery rather than enabling core upload/download function.)

## 3. PDF Processing Service Core

- [ ] 3.1 Scaffold the Python PDF Processing Service (PyMuPDF) as an independent Docker container implementing page-render, bbox-crop, and worksheet-assembly endpoints; verify the container starts and responds to a health check
- [ ] 3.2 Define the `PdfProcessingPort` interface in the Next.js Domain/Application layer and an Infrastructure HTTP adapter implementing it (D11); verify Domain/Application code has no import of an HTTP client or PyMuPDF-specific type
- [ ] 3.3 Implement least-privilege OSS access for the Python service — short-lived scoped credentials, or Next.js-mediated file transfer (D11); verify the service never holds a long-lived OSS AccessKey/SecretKey
- [ ] 3.4 Implement basic malformed/corrupt-PDF error handling and temporary-file cleanup in the service; verify a corrupt PDF input returns a clear error and leaves no orphaned temp files

(Request/job identity, idempotent retry, timeout, and "service unavailable → explicit failure" handling are in Group 11 — Service Robustness — since the happy path above is what the walking skeleton needs first.)

## 4. Walking Skeleton: End-to-End Vertical Slice (manual-only paths, no AI yet)

Uses the seeded identity from 1.4 and the core pieces from Groups 2–3. Goal: prove the full pipeline works before investing in AI Selection Gate, backup hardening, or production deployment.

- [ ] 4.1 Implement PDF upload + naming (worksheet-archive spec) using Storage Core, plus the archive list view (name, upload time, empty state); verify a PDF can be uploaded, named, and appears in the list, AND verify a submission with an empty name is rejected with a prompt to fill it in
- [ ] 4.2 Implement grading-photo upload (one or more photos) + archive selection, creating a GradingSession linking the photo(s) and chosen PDF; verify multi-photo upload works and single-photo is a valid case
- [ ] 4.3 Implement the confirmed-error-list Human Review UI as an editable list (add/remove individual question numbers), starting from an empty list in manual-only mode; persist the confirmed list immediately per D6 on each edit/confirm; verify a parent can add and remove entries and the resulting list is saved and survives a page refresh. This UI is built once here and reused (not reimplemented) in 7.1.
- [ ] 4.4 Implement the region-selection Human Review UI: render the relevant PDF page (via the Group 3 render endpoint) with an adjustable/manual bounding-box drawing tool, starting from no box in manual-only mode; persist confirmed region coordinates immediately per D6 on confirm; verify a drawn box is saved and survives a page refresh. This UI is built once here and reused (not reimplemented) in 7.2.
- [ ] 4.5 Implement clean-question extraction (crop) via `PdfProcessingPort` using confirmed region info; verify the extracted image contains no handwriting or grading marks, AND positively verify that formulas, geometric figures, and tables within the cropped region are fully preserved (correction-worksheet spec)
- [ ] 4.6 Implement correction-worksheet PDF assembly from the extracted question images, using the default answer space (type classification not yet wired in); verify a printable PDF is produced with one answer space per extracted question
- [ ] 4.7 Run and record an end-to-end walkthrough of 4.1–4.6 using one real sample worksheet + photo; verify the full manual-only pipeline produces a correct correction worksheet

## 5. Auth & Access Control

- [ ] 5.1 Implement the AuthService abstraction with the User/Identity model (D2); verify Domain code references only `User.id`, never a provider-specific identifier
- [ ] 5.2 Integrate SMS OTP via 阿里云 PNVS 短信认证 (D12); verify a real phone number can complete an OTP login end to end
- [ ] 5.3 Execute the Email OTP Selection Gate (D12): test account provisioning and sender/domain verification for 阿里云 DirectMail and 腾讯云 SES, and send OTP to qq.com/163.com/126.com plus one international mailbox, recording delivery time and spam-folder outcome; record the decision and integrate the selected provider behind AuthService
- [ ] 5.4 Implement first-login auto-provisioning of User/Child records for an allowlisted email/phone, replacing the 1.4 dev-seed path for real usage (per corrected Migration Plan — no manual DB seeding in production); verify the first successful OTP login for an allowlisted identifier creates the expected records
- [ ] 5.5 Implement access-control middleware rejecting unauthenticated requests to every protected route/API (access-control spec); re-verify the Group 2.5 signed GET URL issuance against a real authenticated User + ownership authorization, reusing its existing logic rather than reimplementing it; verify unauthenticated access is blocked and redirected with no business data returned, and that 2.5's dev-identity placeholder check is fully replaced by real session-based authorization
- [ ] 5.6 Verify that an authenticated user can access their own data and functionality within their permission scope (access-control spec positive case); verify a logged-in parent can reach their worksheet archives, grading sessions, and question bank data

## 6. AI Integration & Selection Gate

AI Integration owns the Task Contract interfaces and model adapter only. It does **not** implement the human-review UI, fallback UI, or answer-space sizing logic — those already exist (Group 4) and are extended in Groups 7 and 9, not duplicated here.

- [ ] 6.1 Define the four AI Task Contract interfaces — error-question recognition, region localization, knowledge-tag labeling, question-type classification (D5) — independent of any model SDK; verify Domain/workflow code depends only on these interfaces
- [ ] 6.2 Build a fixed, reusable AI evaluation sample set per D13 (Chinese primary-school math papers; printed text and formulas; geometric figures; circle/cross/check/handwritten marks; single-question, multi-question, and cross-page cases) with recorded expected results
- [ ] 6.3 Execute the AI Provider Selection Gate against Qwen-VL and Kimi for each of the four Task Contracts, recording task correctness, bbox/localization quality, structured-JSON success rate, latency, API cost, and failure/retry behavior; produce the decision record described in D13
- [ ] 6.4 Implement the AI Integration adapter(s) for the selected model(s) behind the four Task Contracts, including explicit empty/failure-result handling at the contract boundary; verify no provider-specific type leaks into Domain code, and a simulated model failure yields the contract's defined empty/failure result (not an exception that crashes the caller)

## 7. Grading Workflow — Wire AI-Assisted Paths Into Existing UI

Extends the manual UI already built in Group 4 — does not re-implement it.

- [ ] 7.1 Wire the error-recognition Task Contract's candidate output (6.4) into the editable confirmed-error-list UI built in 4.3, so AI results pre-populate the list the parent edits; verify both the AI-assisted path and the original manual-only path (AI empty/failed) still complete correctly
- [ ] 7.2 Wire the region-localization Task Contract's candidate output (6.4) into the region-selection UI built in 4.4, so an AI-suggested box appears as the initial adjustable box instead of starting empty; verify a manual correction still overrides and persists in place of the AI suggestion, and per-question manual fallback still works when AI fails to localize that question
- [ ] 7.3 Verify that re-triggering AI recompute (error recognition and/or region localization) for a GradingSession that already has confirmed facts does not modify or delete the original grading-photo asset, and does not overwrite the already-confirmed error list or region coordinates (D6/D9/grading-workflow spec); simulate a recompute after confirmation and verify both the asset and the confirmed facts are unchanged

## 8. Question Bank

- [ ] 8.1 Implement the step that commits a GradingSession's confirmed error questions (from 4.3/4.4/7.1/7.2) into permanent Question Bank `ErrorQuestion` records — source worksheet, error timestamp, confirmed region info, grading-photo reference (D4/question-bank spec); verify all fields are saved once the workflow completes
- [ ] 8.2 Implement AI knowledge-tag generation as a draft with a human confirm/edit step, non-blocking on AI failure (empty tag, manual fill allowed); verify the error question still saves successfully when AI tagging fails
- [ ] 8.3 Implement provenance tracking so a human-edited knowledge tag is never overwritten by a later AI recompute (D4); verify a triggered recompute does not alter an already human-edited tag

## 9. Correction Worksheet — Type Classification & Generation Snapshot

- [ ] 9.1 Wire the question-type classification Task Contract (6.4) into the answer-space sizing logic built in 4.6, replacing the "default only" behavior with type-matched sizing plus default fallback on AI failure (D5/D7); verify calculation questions receive a larger answer space, fill-in/multiple-choice questions receive a smaller answer space, and classification failure falls back to the default space without blocking generation
- [ ] 9.2 Implement Generation Snapshot persistence at generation time — confirmed error list/order, region coordinates, type-classification results or defaults (D7); verify the snapshot captures everything needed to deterministically reproduce the output
- [ ] 9.3 Implement re-fetch of a previously generated correction worksheet using the persisted Generation Snapshot and/or cached final PDF, without re-running AI recognition/classification or any human-confirmation steps; verify repeated retrieval produces semantically consistent output and does not require re-upload/re-confirmation
- [ ] 9.4 Implement regeneration of the derived clean-question image from the original PDF + confirmed region info when the derived image is unavailable (D3); verify regeneration succeeds without requiring re-upload or re-confirmation

## 10. Data Protection & Backup

- [ ] 10.1 Configure OSS cross-account + cross-region replication as the independent backup/recovery path for original assets (D10); verify replicated objects appear in the destination account/bucket
- [ ] 10.2 Implement a scheduled `pg_dump` job meeting RPO ≤ 6h, uploading dumps to a dedicated OSS backup path separate from primary asset storage (D8); verify a scheduled run produces a dump object in OSS
- [ ] 10.3 Implement success/failure observability for the backup job (logging/alerting); verify a simulated failure (e.g., invalid OSS credential) is visibly reported, not silent
- [ ] 10.4 Implement a backup retention policy (prune dumps outside the retention window); verify old backups are removed and recent ones retained
- [ ] 10.5 Execute a restore test: restore the most recent backup into a clean PostgreSQL instance and verify key business data (confirmed error questions, region coordinates, knowledge tags) is present and correct; document the procedure as a runbook

## 11. Service Robustness Hardening

- [ ] 11.1 Implement request/job identity and idempotent retry handling between the Next.js adapter and the PDF Processing Service, with a bounded timeout on the Next.js side; verify a retried call does not produce duplicate or partially-applied output
- [ ] 11.2 Implement Next.js-side handling of PDF-service unavailability as an explicit failure state that never silently advances the workflow to "success" (D6/D11); verify a simulated service-down scenario surfaces a clear failure without corrupting already-confirmed business facts
- [ ] 11.3 Implement an input file size limit for the PDF Processing Service, rejecting oversized input explicitly rather than attempting it; verify an oversized input is rejected with a clear error

## 12. Production Deployment Readiness

- [ ] 12.1 Select and configure the production-grade public ingress mechanism (tunnel/reverse proxy) providing HTTPS access from mainland browsers to the Next.js container; verify a request from an external mainland network reaches the app
- [ ] 12.2 Investigate and document ICP filing / domestic web-service compliance requirements for the chosen ingress mechanism and mini PC hosting (D8 open question); record findings and any required action
- [ ] 12.3 Re-validate the already-implemented backup mechanism (10.2) under production network conditions — "mini PC → OSS backup upload" stability over the real production ingress/network path — plus "mainland browser → ingress → mini PC" latency/stability per the D8 Smoke Test Gate; this is re-validation of existing mechanisms, not a reimplementation; record results

## 13. Final Cross-Cutting Verification

- [ ] 13.1 Review Storage/Auth/AI/PDF Processing boundaries and confirm no Provider-specific SDK or type (OSS, PNVS, Email provider, AI model, PyMuPDF/HTTP client) leaks into Domain Model code (D3/D5/D9/D11/D12); document the review
- [ ] 13.2 Run a full end-to-end walkthrough on the production-deployed stack — upload archive, upload grading photos, AI-assisted and manual-fallback confirmation, save to question bank, generate and re-fetch a correction worksheet — using a real sample worksheet; verify the complete path works under production conditions
- [ ] 13.3 Verify access-control end to end in production: unauthenticated requests are rejected across every protected route/API, including signed-URL issuance for assets (access-control spec); verify no business data is returned prior to authentication
- [ ] 13.4 Verify the Group 1.4 local-dev seed mechanism is disabled or unreachable in the production build/configuration, and cannot be used to bypass OTP/allowlist to create or access a User/Identity (D2/access-control); verify attempting to invoke it against a production configuration fails or is not present
