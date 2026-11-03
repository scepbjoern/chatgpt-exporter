# Changes

## Post-review corrections — 2026-11-03, unreleased

- Address targeted Opus findings N1–N9: deduplicate unchanged publication, remove redundant committed stages after validation, preserve disabled views and referenced media across moves, and refresh navigation after partial exports.
- Separate header, body-idle and total network deadlines; preserve progressing slow downloads while stopping stalled or overlong responses.
- Register compact filename keys against full identities with collision extension, cap generated names and reject new live paths over 250 characters; shorten retired-source backup paths while retaining old journal compatibility.
- Make the verifier consume current operation identity/status and lock state; add crash regressions and a deep-root OS ZIP/Chromium check.
- Publish canonical raw/media despite renderer errors; tolerate invalid dates, verify targets after retirement, add identity-less alias fallback and bounded transient removal retries.
- Strengthen legacy HTML marker checks and correct the historical macOS CI record: `a40e6cc` macOS was cancelled with no steps executed. See the [review response](docs/reviews/opus-repair-followup.md) and current [test record](TESTING.md). No release or professional audit is implied.

## 3.3.1-review.0 — repair candidate, 2026-11-03

Based exactly on `moisescastellano/chatgpt-exporter@78efcdc396816997e843abbab58a966708b79dc9`. This is a review candidate, not a completed external review or a production release.

- Protect loopback APIs with a private per-launch capability, Host/Origin/content-type checks, body bounds and an exclusive operation lock; protect progress through authenticated fetch streaming.
- Replace dynamic untrusted HTML insertion with text nodes, clear/expire session input, apply a script-hash CSP and normalize served line endings for Windows hashes.
- Pre-render offline HTML with vendored Marked 15.0.12; escape raw HTML, restrict links/images, disable child scripts, render project info locally and retain title search/navigation. No CDN or runtime Markdown parser.
- Publish prepared generations with retained old bytes, journals, rollback/recovery and filesystem-identity checks for case-only renames. Complete partially copied retirement snapshots before deleting the original source. Serialize stale-lock reclamation.
- Preserve newly captured valid raw JSON even if a later view/download/publication step fails; report it as unpublished retained data.
- Check canonical JSON identity/shape, repair missing readable outputs, validate media size/hash, retry failed or damaged media and visibly retain prior files when a replacement is unavailable.
- Bind new archives to declared user/workspace IDs, route the explicit workspace header, validate inventory schema/pagination and stop conversation publication if project mapping is incomplete. Do not infer deletion from absence.
- Remove internal ZIP generation, archive-wide byte buffers and the separate legacy browser-console exporter. Use OS archive tools and a size/hash manifest verifier.
- Bound/stream downloads, validate every redirect, DNS-pin public HTTPS destinations, minimize external headers and redact diagnostics.
- Preserve full source identities in JSON and stable full SHA256 filename keys; distinguish same-named projects and case-insensitive filename collisions. Keep GPT raw metadata and refresh it, without claiming a complete configuration/Knowledge export.
- Keep useful original behavior tests; replace four source-check-heavy files with behavior tests and add recovery, HTTP, browser, scale, regeneration and OS ZIP verification tests.
- Use Node 24 source startup; fix server import/CLI double-start, include library files in package metadata, mark the package private and remove the untested release/build workflow. Add Windows/macOS CI with pinned Actions.

Original MIT licence/authorship remain. See [the review matrix](docs/reviews/repair-matrix.md), [test audit](docs/test-audit.md) and [test record](TESTING.md). Real workspace routing, installed Safari, historical sandbox versions and production large-account completeness remain open.
