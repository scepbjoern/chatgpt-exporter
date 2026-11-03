# Test record

Date: 2026-11-03. Source-only repair candidate based exactly on `78efcdc396816997e843abbab58a966708b79dc9`. Final commit/CI references are recorded after execution; this document does not claim pending runs have passed.

## Baseline

The untouched starting commit passed `npm test`: all 13 original files on Windows with Node.js 24.11.0. These mixed behavior checks and source-string assertions; passing them did not prove preservation/security. [Test audit](docs/test-audit.md) reviews all 13 and explains retention/replacement decisions. No coverage percentage is claimed.

## Candidate checks

The final record will distinguish the local Node suite, actual browser runs, Windows/macOS CI and manual/live checks. Synthetic fixtures only; no actual ChatGPT account, real token or user archive is used.

Commands:

```text
npm ci --ignore-scripts
npm test
npx --no-install playwright install chromium
npm run test:browser
```

Other installed test engines use `CGE_BROWSER_ENGINE=firefox` or `webkit`; Edge uses `CGE_BROWSER_CHANNEL=msedge`. Both browser scripts run independently so neither a generated-output assertion nor a VM/DOM stub is mislabeled a browser run.

Known testing-method limit: Playwright WebKit's offline emulation rejects even a trivial local `file:` page. Its archive test therefore blocks all HTTP(S) routes and records requests, without enabling that emulation. Chromium/Firefox additionally use offline emulation. Playwright WebKit is not installed Safari.

The Windows PowerShell archive module could not load in this development environment. The OS ZIP roundtrip test uses Windows `tar.exe` or macOS `/usr/bin/ditto`; it verifies extracted manifest entries and detects byte mutation. Explorer/Finder graphical ZIP creation is still a separate manual check.

## Open checks

- Additional targeted external AI review of the final diff.
- Live selected Business workspace identity/routing and inventory/title comparison.
- Small real-data content/media comparison and any later large-account completeness check.
- Installed Safari and manual macOS archive use, OS GUI ZIP/transfer and deep Windows path variants.
- Production native HTTPS/TLS/CDN/proxy compatibility. No real endpoint was contacted in tests; corporate proxies are not implemented.
- Hardware/power/disk-full failures, outside archive modification and all historical sandbox versions.

Windows/macOS workflow configuration is not itself a successful run. Use actual run links recorded below once available.

## Local result before CI

Windows, Node.js 24.11.0: the final local `npm test` run passed all 21 test files. The actual Chromium 145.0.7632.6 offline archive and UI browser scripts also passed. Intermediate failures were corrected (including a footer expectation after updating fork provenance); no failures are hidden by the final result. OS ZIP roundtrip used system `tar.exe` and passed exact manifest/hash checks.

The implementation agents additionally ran both browser scripts on Windows Edge 156.0.4314.58, Firefox 146.0.1 and Playwright WebKit 26.0; those results are attributed to those agents. A final code-identical browser rerun is recorded with the delivery evidence. CI and real Safari remain pending here until linked below.
