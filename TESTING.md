# Test record

## 3.4.0-review.1 — 2026-11-04

Windows / Node 24.11.0: all 27 core test files passed. New synthetic cases cover static presentation widgets, read-only forms with unevaluated expressions, exact/unknown/conflicting citations, literal code preservation, separate branch continuations and preview inventory phases. The count-drift regression now requires a clean completion when the final count reconciles and retains mismatch/page-error checks.

Chromium offline/UI and the native ZIP/deep-path check passed. Browser checks exercise refreshed-token preview validity, control order, blue preview and terminal status, green saved results alongside an orange missing-file panel, inert attack markers, collapsible GPT metadata, branch toggles and original links. Synthetic screenshots were visually inspected. CI on this exact next commit must be checked separately; no real-account overnight run or renewed external review is claimed.

## 3.4.0-review.0 — 2026-11-04

The implementing agent ran all **26 core test files** successfully on Windows / Node.js 24.11.0. Eight new focused cases cover dated 32-character Unicode names, organized export/resume/regeneration and manifest integrity, legacy filename migration without re-downloading chats, preview with no archive writes, project PDF extensions and missing-file context, long HTTP-date Retry-After, bounded 5xx/429 handling, and cancellation during a wait. Existing inventory validation tests still pass after sharing enumeration with preview.

Chromium 145.0.7632.6 passed offline archive navigation and the local UI, including disabled-start reasons, all Markdown defaults, preview/session reuse, invalid dates and stale-preview indication. The native Windows ZIP round trip with organized folders passed: source root 63 characters, restored root 73, longest paths 240/250, matching manifests and an actually opened local attachment. A synthetic UI screenshot was visually inspected; no private archive or real token was used for these checks.

Firefox 146.0.1 also passed the offline archive and UI checks on Windows. The first new-version CI run, [41818638381](https://github.com/scepbjoern/chatgpt-exporter/actions/runs/41818638381), passed Windows but failed the macOS maximum-name success case: the per-user temporary root plus the new dated names exceeded the unchanged 250-character archive guard. That fixture now explicitly chooses a short temporary root on macOS, consistent with the documented short-output-folder requirement. Other fixtures keep the normal system temporary directory. The corrected tree passed all 26 core test files again on Windows; its new CI result must be checked separately. No unattended real-account overnight run or renewed Opus review is claimed.

The sections below are historical records for earlier commits.

## Inventory pagination repair, 2026-11-03

The current working tree adds advisory-total pagination: enumerate until an explicit
`has_more: false` or an empty page, not until a changing `total` is reached. Missing
optional totals are accepted. Numeric drift/count mismatches allow discovered chats
to export but retain `partial` and `inventory.complete: false`. Invalid schemas,
offsets, duplicate IDs and contradictory empty pages still block the conversation
queue. Bounded page diagnostics contain counts only, not titles or credentials.

The delegated implementation agent ran all **25 core test files** successfully on
Windows / Node.js 24.11.0, including 16 new inventory cases. The coordinating agent
reviewed the patch and reran the Chromium offline archive and local UI checks:
both passed. No current macOS execution is claimed. The previous 93af5c3 macOS job
ultimately cancelled with zero steps; its Windows job passed.

An explicitly authorized local live trial reproduced the previous numeric-total
abort. After the repair, pagination reached its empty terminal page and one selected
conversation was saved as JSON, Markdown and HTML. All ten manifest entries matched.
The report remained partial because totals changed. That trial had no attachments,
does not establish account completeness or workspace isolation, and did not include
a visual browser check of its private local HTML. Private data, paths and credentials
are excluded from this repository. Live evidence is separate from synthetic tests.

The sections below describe earlier commits and their own test scope.

## Post-review follow-up, 2026-11-03

Exact executable code/test/workflow commit: `93af5c36b81a329d33aa675da656c06c603e01f6` (includes the disabled-view original-media follow-up to `a795d76`). All local results immediately below were rerun on that code. Later Markdown-only documentation changes do not change the tested executable tree.

Current [CI run 41661167548](https://github.com/scepbjoern/chatgpt-exporter/actions/runs/41661167548): [Windows job](https://github.com/scepbjoern/chatgpt-exporter/actions/runs/41661167548/job/126004429461) passed the core suite plus Chromium deep ZIP, offline archive and UI. The [macOS job](https://github.com/scepbjoern/chatgpt-exporter/actions/runs/41661167548/job/126004430026) is queued with no assigned runner or executed steps at this documentation check; it is not a pass. Read the live job result before a Mac trial. Earlier a40e6cc macOS cancellation is recorded below rather than replaced with the older 91a859d success.

The working tree containing the N1–N9 follow-up fixes passed all **24 test files** on Windows / Node.js 24.11.0. This includes the new archive-store and runner regressions, operation-marker crash cases, slow-progress/stalled network cases and collision tests. Exact committed source and CI results are recorded in the delivery manifest and follow-up section below.

The coordinating implementation agent ran offline archive and local UI checks in Chromium 145.0.7632.6, Edge 156.0.4314.58, Firefox 146.0.1 and Playwright WebKit 26.0: all eight passed. The separate Chromium `tests/browser-depth.mjs` also passed: 95-character source root, 105-character extracted root, longest paths 229/239 characters, actual native Windows ZIP/extract, hash verification, index/project navigation and opening the attachment with exact bytes. This is nine browser executions, not nine additional core test files. WebKit uses HTTP(S) blocking, not its broken file-page offline emulation.

The new deep-path test is configured in Windows/macOS CI. Installed Safari, Explorer/Finder graphical ZIP, real SMB, actual antivirus/sync locks, production TLS/CDN and live-account completeness remain untested. Windows system-tar invocation was also verified under Git Bash by the delegated implementation agent. All data and credentials are synthetic.

The completed targeted Opus review is summarized in [the response](docs/reviews/opus-repair-followup.md). It found real defects in the prior reviewed tree; the follow-up changes themselves await targeted review. Records below are **historical a40e6cc evidence**, not a claim that the new tree was tested by Opus.

Date: 2026-11-03. Repair code/test/workflow commit: `a40e6cce9015656ed0370e52e4b4a0ced5478fad`. Later delivery changes update Markdown documentation only. This is a source review candidate, not a production or completeness approval.

## Baseline and test assessment

The untouched starting commit `78efcdc396816997e843abbab58a966708b79dc9` passed `npm test`: all 13 original files on Windows with Node.js 24.11.0. Several checked source strings rather than behavior. [The test audit](docs/test-audit.md) reviews all 13: nine useful behavior files retained, four source-check-heavy files replaced with behavior checks. Footer expectations now identify this fork. No coverage percentage or aggregate assertion count is claimed.

## Final local execution

On Windows with Node.js 24.11.0, all 22 `*.test.mjs` files passed on the code commit above. This includes converter/storage regressions, HTTP access and redirect controls, actual saved bytes/hashes, update 404/429, missing/corrupt media and views, scope/identity checks, publication conflicts, a real child-process exit and journal recovery, two competing stale-lock reclaimers, regeneration, a Windows short-path alias and OS ZIP/extract verification.

The indexing check creates 2000 synthetic raw chats containing approximately 128 MiB of message text and builds a lean index in a 64 MiB V8 heap. It is not a whole-export RSS or large-account benchmark.

Both actual browser scripts were rerun by the coordinating implementation agent on that final code tree:

| Windows browser | Version | Offline archive | Local interface |
| --- | --- | --- | --- |
| Bundled Chromium |145.0.7632.6 | Passed | Passed |
| Installed Edge |156.0.4314.58 | Passed | Passed |
| Bundled Firefox |146.0.1 | Passed | Passed |
| Playwright WebKit |26.0 | Passed with HTTP(S) route blocking | Passed |

The archive browser check exercises file paths with special characters, assistant/tool text, inert attack markers, no automatic external requests, a valid local raster image, title search, hash reload, project info and archived/deleted navigation. The interface check exercises the launch capability, authenticated config/progress, CSP-controlled UI actions, literal folder/result markers, cleared session input and partial-status warnings.

Playwright WebKit's offline emulation rejects even a trivial local `file:` page. Its archive test blocks all HTTP(S) routes and records requests instead. Chromium/Firefox additionally use offline emulation. Playwright WebKit is not installed Safari.

## CI execution

[Final code CI run](https://github.com/scepbjoern/chatgpt-exporter/actions/runs/41649742581), exact code commit `a40e6cce9015656ed0370e52e4b4a0ced5478fad`, Node.js 24.11.0:

| Platform | Result |
| --- | --- |
| [Windows hosted runner](https://github.com/scepbjoern/chatgpt-exporter/actions/runs/41649742581/job/125964425439) | Passed: Node suite, Chromium archive and UI |
| [macOS hosted runner](https://github.com/scepbjoern/chatgpt-exporter/actions/runs/41649742581/job/125964425266) | Cancelled after waiting, with no steps executed. Overall run failed. No macOS evidence for a40e6cc; earlier core revision results remain separate. |

The Windows-only alias test is explicitly skipped on macOS; the other suite files run there. The macOS workflow also executes the archive and UI in Playwright WebKit. Pinned Actions and a locked development dependency are used. No release workflow is enabled. Documentation-only changes do not rerun the same executable checks.

## Failures found during implementation

Earlier CI runs are not hidden. A Windows run exposed retirement calls that returned without the expected absence of source files. Canonical native paths, bigint file identities, direct checked file/directory removal and verified fault injection replaced that behavior. The precise underlying OS/library cause was not independently isolated; observable results gate the fix. A later macOS test-harness failure wrote to a denied child's closed stdin; release is now sent only to the child that acquired the lock. These corrected failures are separate from the final run above.

The Windows PowerShell archive module did not load in the local development environment. The executed OS ZIP roundtrip uses Windows `tar.exe` or macOS `/usr/bin/ditto`, then checks every manifest entry/hash and detects deliberately changed bytes. Explorer/Finder graphical ZIP creation is a separate manual check.

## Reproduction and remaining checks

```text
npm ci --ignore-scripts
npm test
npx --no-install playwright install chromium
npm run test:browser
```

Other installed engines use `CGE_BROWSER_ENGINE=firefox` or `webkit`; Edge uses `CGE_BROWSER_CHANNEL=msedge`. The two browser scripts are separate commands and are not included in the 22 test-file count.

Still open: review of the post-Opus corrections; authentic Business workspace routing/inventory comparison; small real-data content/media validation and later broad completeness checks; installed Safari/manual macOS archive use, OS GUI ZIP/copy and further Windows path variants; live production HTTPS/TLS/CDN compatibility and corporate network requirements; hardware/power/disk-full failures; all historical sandbox versions. Corporate proxies are not implemented. Shared projects and GPT Knowledge remain outside scope.

All executed tests use synthetic data and fake credentials. A passing run proves those scenarios, not remote completeness or a general security guarantee.

The completion display also distinguishes deliberate disabled deletion inference from an actual partial operation. Separate project-resource and GPT failures are injected together with a successful chat and remain errors in the durable report. Both outcomes have behavior checks.

Historical macOS evidence: the [preceding core run at 91a859d](https://github.com/scepbjoern/chatgpt-exporter/actions/runs/41648579667/job/125960376281) passed all 22 suite files (one Windows-only case skipped), Chromium 145.0.7632.6 archive/UI and WebKit 26.0 archive/UI. The later a40e6cc macOS job was cancelled without execution; its initial queued status was only a packaging-time snapshot. The targeted Opus review and implementation agent independently checked this final outcome.
