# Test record

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
| [macOS hosted runner](https://github.com/scepbjoern/chatgpt-exporter/actions/runs/41649742581/job/125964425266) | Queued for the latest code revision at handoff; not claimed passed. The preceding core revision passed the Node suite, Chromium archive/UI and WebKit archive/UI (see below). |

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

Still open: the additional targeted Opus 5.5 review; authentic Business workspace routing/inventory comparison; small real-data content/media validation and later broad completeness checks; installed Safari/manual macOS archive use, OS GUI ZIP/copy and deep Windows path variants; live production HTTPS/TLS/CDN compatibility and corporate network requirements; hardware/power/disk-full failures; all historical sandbox versions. Corporate proxies are not implemented. Shared projects and GPT Knowledge remain outside scope.

All executed tests use synthetic data and fake credentials. A passing run proves those scenarios, not remote completeness or a general security guarantee.

The completion display also distinguishes deliberate disabled deletion inference from an actual partial operation. Separate project-resource and GPT failures are injected together with a successful chat and remain errors in the durable report. Both outcomes have behavior checks.

Latest macOS scheduling: the final job can remain queued on the hosted service while Windows has completed. The [preceding core run at 91a859d](https://github.com/scepbjoern/chatgpt-exporter/actions/runs/41648579667/job/125960376281) passed all 22 suite files (one Windows-only case skipped), Chromium 145.0.7632.6 archive/UI and WebKit 26.0 archive/UI. The later a40e6cc revision changes one completion-status condition and adds project/GPT/clean-completion assertions; its latest macOS run must still be read as a separate outcome. No failed latest macOS test is being hidden as a pass.
