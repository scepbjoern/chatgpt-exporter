# Targeted Opus 5.5 review request — local exporter repairs

Review the repair diff, not the unchanged project as a new full audit or a comparison with other tools. This is an additional AI-assisted review requested after two static baseline analyses. Do not treat any AI report, passing test, filename or README statement as proof.

## Exact inputs

- Baseline: `78efcdc396816997e843abbab58a966708b79dc9` from `moisescastellano/chatgpt-exporter`, descended from `ezwep/chatgpt-exporter`.
- Repair code/test/workflow commit: `91a859d4178835c64308cf32198fad48dd632468` in `scepbjoern/chatgpt-exporter`, branch `repair/offline-preserving-export`.
- Additional delivery commits may update English review documentation only. Use the attached bundle's manifest to identify its exact source tree, ZIP/hash and diff endpoint. The executable code and tests must match the code commit above, unless that manifest explicitly reports a later code correction.
- Read the supplied complete repaired source, baseline source context and binary/full-index diff. Read `TESTING.md`, `docs/test-audit.md`, `docs/reviews/repair-matrix.md`, `SECURITY.md`, `VENDOR.md` and the sanitized baseline `initial-review.md`/`second-ai-review.md`.
- Use actual linked CI outcomes rather than assuming the configured workflow passed. Local results and CI are separate evidence.

The historical second AI review confirmed 14 findings and partially confirmed F11/F12/F14/F18. It knew the first report and was not a blind independent audit. Its exact model version was not established. Neither report ran the exporter. This requested new review targets the modifications.

## Accepted scope

Preserve raw JSON, existing Markdown conversion options, associated actually available files and a safe offline HTML folder with index/navigation/title search. No full-text search, shared-project export, GPT Knowledge, historical sandbox-version reconstruction, new framework, broad benchmark, executable distribution or finished release. OS ZIP of the finished folder is sufficient. GPT discovery JSON is raw metadata, not a complete GPT configuration export.

## Prioritized questions

1. **Preservation/recovery (F01/F12/F13/F18):** examine `archive-store.js`, runner and regeneration. Prepared copies, target backups, commit marker, source retirement and rollback must preserve unique old bytes. Check interruptions during directory copy, during rollback and after committed publication; case-only aliases, Windows short paths, exact/bigint file identity, conflicting targets, path containment and serialized stale-lock reclamation. Distinguish recoverability from simultaneous multi-file atomicity and power-loss durability. Can any remaining path delete the sole old copy, retire a newly published target or report completion after no-op removal?
2. **Resume/reporting (F02/F05/F18):** separately validate raw structure/identity, MD/HTML and media size/hash. Missing maps, damaged bytes and previous failures must retry or remain explicit errors. Retaining old bytes after a failed replacement must not claim that they are the current remote version. Check all error categories, partial/rate-limit events followed by final reports, manifest failures and the operation marker against stale manifests. Inspect local regeneration as well as network export.
3. **Local surface (F04/F06/F10/F14):** private launch capability absent from served HTML, exact Host/Origin/JSON/body bounds, all APIs including fetch-stream progress authenticated, one operation and archive writer lock, credential lifetime/clearing, safe text output, CRLF-normalized CSP hashes, debug redaction. Assess missing browser/OS evidence honestly. The local launch capability is intentionally printed once; it is different from the ChatGPT token.
4. **Offline HTML (F07):** review every emitted HTML/URL/attribute path for the pinned parser version, raw HTML, code fences, link titles/labels, encoded schemes/control characters, protocol-relative URLs and local path encoding. No automatic external requests. Assistant/tool text must be present without scripts. Root index uses a hash-authorized script; child pages are scriptless and the iframe permits same-origin files but not scripts. This changed after a real Chromium test showed opaque origins blocked local images. Failed legacy regeneration must not expose old unsafe pages through the index. Active original attachments and raw Markdown are explicitly separate trust boundaries.
5. **Identity/inventory/scope (F08/F09/F13):** explicit declared user/workspace binding, exact workspace header, validated pages/IDs/cursors/totals, no automatic deletion inference and no publication of conversations when project mapping is incomplete. Selection must never reclassify an unselected project chat as root after an error. Real Business routing is not proven by a synthetic session/header and remains a later live inventory comparison.
6. **Network/resource bounds (F11/F15):** exact bearer origin per redirect, public destination allowlist, DNS validation/pinned TLS, query/header redaction, deadlines, streaming bounds and temporary-file cleanup. Test-only policy seams must not be exposed via UI/environment. No live production HTTPS/CDN compatibility is claimed. Direct HTTPS does not implement corporate proxies.
7. **Scope and tests (F03/F16/F17 and remaining):** internal ZIP and byte accumulation really removed; GPT raw metadata refreshes; historical sandbox versions remain explicitly outside this repair. Assess all 13 original tests' retention/replacement decisions and the new behavior tests. Identify missing *material* failure cases, not a coverage-percentage target or source-string assertion wish list. Preserve useful converter tests. The scale test is an indexing heap check, not a whole-export memory guarantee.

## Execution boundaries

Use only synthetic local fixtures and fake credentials. Do not connect to a real ChatGPT account, request real tokens, operate other local user archives, change repository/account settings, publish a release or contact maintainers. Static inspection is required. If your environment supports the provided test runtime, run relevant synthetic tests and state exact results. If execution is unavailable, clearly mark it as not run; do not infer a pass from source.

The core suite is `npm test` on Node.js 24.11.0. Browser commands are `node tests/browser-offline.mjs` and `node tests/browser-ui.mjs` after installing the pinned Playwright dependency and browser. Chromium/Firefox use offline emulation plus HTTP(S) blocking; Playwright WebKit uses HTTP(S) blocking because its offline emulation rejects even trivial local files. WebKit automation is not installed Safari.

## Required return

- Brief verdict: ready for a *bounded synthetic/manual next check*, needs specified repairs, or blocked, with reasons. Do not issue a general security/production approval.
- Table covering **every F01–F18**: fixed within scope / partly fixed / not fixed / explicitly constrained, exact current code evidence, relevant executed test or unexecuted hypothesis, residual limitation.
- For each new material defect: severity, trigger, affected bytes/trust boundary, minimal synthetic reproduction, expected/observed result, precise file/function/line references, smallest plausible correction and a test that would catch it.
- State which files/tests you actually inspected or ran. Separate static proof, reproduced behavior, inherited test reports and live/manual questions. Challenge the current repair matrix where evidence does not support it.
- Prioritize any remaining data loss, false completion, untrusted script/network path or scope mixing. Do not reopen accepted excluded features as mandatory defects. Do not replace absent live-workspace/Safari evidence with speculation.
