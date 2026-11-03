# Targeted Opus 5.5 follow-up — N1–N9 corrections

Review the changes after your a40e6cc review. This is a bounded follow-up, not a new full audit. Use the bundle manifest for exact reviewed and repaired source commits and file hashes. The prior reviewed code is a40e6cce9015656ed0370e52e4b4a0ced5478fad; its delivery tree is 7f3fce83f2a61cb4c5631430cb86e5142315a45b (only two later Markdown changes).

Read docs/reviews/opus-repair-followup.md, TESTING.md, SECURITY.md and the follow-up diff first. Challenge those claims against code and executed behavior. The original review and reproduction hashes are recorded in the response. This is AI-assisted review, not professional audit or production approval.

Priorities:
1. N1/N6/N9, archive-store.js: equality/no-op behavior, full directory names and hashes, original backup survival, committed new/ cleanup only after validation, old-journal recovery, compact retireBackups, case spelling across volumes, identity-less aliases, partial deletion/rollback and bounded retries. Does any path lose a unique copy, delete the new target or stop recovery? Repeated unchanged runs must not keep duplicating artifacts.
2. N2/N7/N8, export-runner.js: disabled MD/HTML views and their local media through rename and archive moves; errors per renderer while publishing valid raw/media; partial-run navigation after429. Disabled views are retained snapshots and may be older than raw. Other download/publication failures still retain raw outside the canonical tree. Check repeated rename-then-move, not only a one-step move.
3. N3, chatgpt-api.js: cumulative header/DNS/redirect budget, body idle timer reset by nonempty bytes, total cap, transport cancellation, reader/timer/listener cleanup and size limits. A steadily progressing body may exceed60seconds; a stall must terminate. No live TLS/CDN success is claimed.
4. N4, archive-names.js and runner: full-ID registry behind20hex keys with collision extension, restart behavior, filename identity and containment, path length guard, media extension/encoding and retained long histories. Check deliberately forced digest-prefix collisions. Complete titles remain in JSON and views. Existing long historical archives are not rewritten wholesale.
5. N5 and legacy HTML: explicit operation marker/run ID/status and writer-lock checks in verifier, current-state recheck after hashing, partial byte-integrity distinction. A real meta element in generated head is a format discriminator, not a cryptographic safety proof. Failed legacy regeneration must not admit an unmarked old page.

Synthetic execution is authorized for this follow-up: inspect source first, then run the relevant local Node tests with fake credentials and temporary fixtures; run browser tests if the pinned dependencies/browser are available. Do not request a real token or touch real archives. No real ChatGPT requests, external messages, settings changes, release or publication. Do not install unrelated tools. If your environment blocks a step, record it and continue permissible checks without bypassing the restriction.

Use Node24.11.0. Core: npm test. Browser: node tests/browser-offline.mjs; node tests/browser-ui.mjs; node tests/browser-depth.mjs (Windows/macOS native ZIP). Read actual CI outcomes; do not infer a pass from workflow configuration or older commits. Playwright WebKit is not installed Safari.

Return:
- Brief bounded-readiness verdict and an N1–N9 table: fixed within scope / partial / open, exact code references, inspected or executed evidence and residual limits.
- Any material regression to F01–F18; do not repeat the whole old audit if unchanged.
- Reproducible synthetic case for every new defect, affected bytes/boundary, severity, smallest correction and test.
- Distinguish static findings, tests you ran, inherited reports and live/manual questions.
- Save a Markdown report and any standalone reproduction test. Do not modify the repaired source silently.

Accepted exclusions remain: shared projects, GPT Knowledge, historical sandbox file versions, full-text search, new framework, proxy implementation, installed Safari certification and general production/completeness approval.
