# Test audit

Date: 2026-11-03. Baseline: `78efcdc396816997e843abbab58a966708b79dc9`.

This is an internal AI-assisted assessment of test meaning during implementation. It is not an independent professional audit. The reviewer read all 13 original test files, compared the changed tests with the baseline, examined the publication/recovery and export paths, ran the current synthetic suite, and used small synthetic reproductions for suspected defects. No real account, token or conversation archive was used.

## Baseline and retention decisions

The unchanged baseline suite passed all 13 files before repairs. Passing those files did not establish completeness, security or crash recovery: several files checked whether source code contained particular strings.

| Original test file | Meaning of the original checks | Decision and current evidence | Remaining limit |
| --- | --- | --- | --- |
| `archive-delete-layout.test.mjs` | Source-string checks for archived requests, paths, deletion handling and UI labels. | Replace with an actual active-to-archived export using synthetic conversations and attachment bytes; verify the local group, content and index. Absence from remote inventory now preserves the local record instead of inferring deletion. | A synthetic archive-state transition is not evidence about the live service's inventory coverage. |
| `conversation-storage.test.mjs` | Useful filesystem behavior: group discovery, project identity, newest-copy selection, successful moves and no-op moves. | Retain. Publication rollback, conflicting destinations, durable-journal recovery and real process interruption are covered separately by the recovery suites. | The original success cases alone do not exercise interrupted copies or every filesystem error. |
| `local-export.test.mjs` | Useful version-2 file-map identity/path checks, missing/corrupt manifests and discovery of regeneration groups. | Retain compatibility tests. Add export recovery checks for version-3 size/hash verification, missing maps, damaged media and retry state. Local regeneration also has its own archive lock and report. | Legacy version-2 maps have no historical hash to compare. An existing filename alone cannot prove its original contents. |
| `markdown-footer.test.mjs` | Converter output ends with one expected attribution footer. | Retain the two narrow output checks. | Formatting/attribution regression only; no export or security claim. |
| `markdown-options.test.mjs` | Real converter output for current/all branches, missing current node, metadata, date formatting, model/timestamp switches, custom labels and defaults. | Retain. These assertions inspect generated Markdown rather than the converter source. | Small synthetic graphs do not prove coverage of every future message schema or every branch topology. |
| `markdown-sources.test.mjs` | Real output for web citation conversion/deduplication, grouped responses, local file citations, unavailable sources and hidden/uncited references. | Retain all synthetic cases. Optional external-fixture cases were not invoked or supplied. | Citation schemas are samples; no live-service or real-fixture claim follows. |
| `markdown-worked.test.mjs` | Useful response grouping/order, visible activity summaries, hidden placeholders, unanswered prompts, attachments, code, labels, sibling branches and complete simple output. | Retain. Optional external-fixture cases were not invoked or supplied. | These tests concern public visible text and formatting. They do not extract hidden reasoning or establish complete remote history. |
| `project-selection.test.mjs` | Useful pure filtering checks mixed with source-string assertions for integration/UI wiring. | Retain the all/none/subset/root filtering behavior and replace source checks with a runner fixture: inventory all projects, publish only selected project metadata/conversations, preserve unselected local records and distinguish identical project names. | Failed project enumeration must also be tested; successful inventory is not enough to prove selection boundaries. |
| `rate-limit-ux.test.mjs` | Source-string checks, including the unsupported sentence “No saved progress was lost.” | Replace with execution of the real UI script against a minimal DOM boundary. Verify warning state, literal failed titles, cleared session input, authenticated progress and preservation of the final report after early error/429 events. Real HTTP 429 behavior and byte preservation live in API/export recovery suites. | The minimal DOM is not a browser. The separate browser UI test supplies Chromium CSP/event/rendering evidence. |
| `resume-state.test.mjs` | Useful pure classification for new/resume/move/update, changed titles, missing times and older remote timestamps. | Retain all cases. Add runner tests proving that unchanged raw JSON does not prevent repair of missing derivations, media/maps or prior failures. | Classifying a record as resume is not itself an artifact-completeness test. |
| `sandbox-files.test.mjs` | Useful extraction, message-ID retention, filename decoding, local-link rewriting, missing targets and parenthesized paths. | Retain. Transport limits/redirects are checked separately. Historical versions of one sandbox path remain explicitly outside the implemented guarantee. | Multiple message references still resolve to one latest available path; these tests do not establish historical-version preservation. |
| `server-refactor.test.mjs` | Source imports, exported function declarations and line-count checks. | Replace with an actual child process importing the server, proving that import exits without a listener or browser launch. HTTP behavior belongs in `server-security.test.mjs`. | Architectural style is not a safety proof, and no line-count threshold is asserted. |
| `version.test.mjs` | Package version consistency and its actual Markdown footer. | Retain the two narrow checks. | No distribution/build/release provenance claim. |

Good output assertions were retained even when they use string/regular-expression matching. Matching generated Markdown or returned HTTP data is materially different from searching application source for reassuring phrases.

## Added failure-oriented evidence

- `export-recovery.test.mjs` checks real stored bytes/hashes across update failures, HTTP 404/429, unchanged resume, missing/damaged artifacts, account mismatch, invalid inventory, interrupted publication, destination conflicts, ID/name collisions, corrupt JSON and metadata/index errors.
- `process-recovery.test.mjs` exits an actual child process between publication steps and recovers using the durable journal on the next run. This complements caught-exception tests.
- `chatgpt-api.test.mjs` uses isolated local HTTP fixtures and an explicitly injected test transport. It checks actual headers, streamed bytes/hash, redirects, size limits, timeouts, schema/cursor failures, queued 429 behavior and secret redaction. It never contacts a real account.
- `server-security.test.mjs` checks the HTTP boundary: no capability disclosure in HTML, protected APIs/progress, Host/Origin/content-type/body validation, operation exclusion, identity requirements and picker 429 responses.
- `offline-html.test.mjs` checks prerendered assistant/tool content, inert raw HTML, URL restrictions, special-character local paths, cyclic graphs, project information and title decoding.
- `browser-offline.mjs` and `browser-ui.mjs` are separate Playwright commands, not automatically counted among `*.test.mjs`. They exercise `file://` archive navigation and the local interface in a real browser, including CSP, inert markers, credential clearing and automatic request destinations.
- `scale.test.mjs` checks a lean index of 2,000 synthetic conversations with approximately 128 MiB of raw message text in a child process limited to a 64 MiB V8 heap. This is an indexing test, not a measured whole-export RSS limit or a real large-account result.

## Review feedback during implementation

The internal peer review identified concrete defects beyond the initial added tests: interrupted retirement could leave a partial retained copy; a manifest-write failure could leave an older optimistic durable report; a case-only title rename on a case-insensitive filesystem could retire the new target; failed project enumeration could bypass project selection and move an existing project conversation to the root; and stale-lock reclamation had a check/remove race between competing recovery processes. These were reported for correction and targeted regression tests. A passing earlier suite must not be used to dismiss a newly reproduced defect. Consult the final implementation/test record for the state of each correction.

The real Windows browser check also identified HTML CRLF normalization affecting CSP hashes. Serving and hashing the same LF-normalized HTML corrected that mismatch. A source-pattern check would not have proved browser compatibility.

## Execution and limits

During this assessment, `npm test` passed all 19 `*.test.mjs` files present at that point, including the retained baseline tests and newly added suites. The implementation continued to receive the targeted corrections above; the final recorded suite run is authoritative for the delivered commit. No aggregate assertion count or coverage percentage is claimed because the runner mixes `node:test` and handwritten assertion loops.

Reproduction commands:

```sh
npm test
npm run test:browser
```

Browser automation requires the pinned development dependency and its installed browser. A local Windows Chromium pass does not establish macOS/Safari, Firefox or every `file://`/CSP behavior. Platform CI results and manual checks must be recorded separately. A configured workflow is not a successful CI run.

Still outside these synthetic results: authentic Business workspace routing and inventory comparison; real account coverage; all historical sandbox versions; GPT Knowledge and shared projects; power-loss durability; hardware/disk exhaustion; every Windows path-length/filesystem variant; and an independent external review of the final repair diff. No release or deployment approval follows merely from these tests passing.

## Final reconciliation

The delivered record is in `TESTING.md`: 22 files locally, with actual browser commands recorded separately. The peer-review defects described above were corrected and have targeted regressions. Subsequent CI additionally exposed Windows removal postconditions/fault-injection assumptions and a macOS test pipe race. Canonical native paths, bigint identities, checked direct artifact removal, verified missing-file injection and release-only-to-holder coordination address those observations. A readable-view failure also now retains newly captured valid raw data as explicitly unpublished data rather than discarding it. This is still synthetic evidence and internal AI collaboration, not external approval.
