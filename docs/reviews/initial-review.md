# Initial AI-assisted static review of the baseline

Date: 2026-11-03. Reviewer attribution: GPT-6.1 Sol, high reasoning effort, through
Codex. This is an English technical summary prepared from the supplied review;
private coordination, local paths and unrelated tool comparisons have been removed.
The underlying review was AI-assisted and was not an independent professional audit.

## Reviewed source and evidence

The reviewed source was the frozen `moisescastellano/chatgpt-exporter` fork at
[`78efcdc396816997e843abbab58a966708b79dc9`](https://github.com/moisescastellano/chatgpt-exporter/tree/78efcdc396816997e843abbab58a966708b79dc9),
which descends from [`ezwep/chatgpt-exporter`](https://github.com/ezwep/chatgpt-exporter).
The supplied source ZIP SHA256 was
`63A98606EC1AAA42F98CEB8687674EB4B7F1405BD6F8DE00CA86508670B91C03`.
The reviewer compared 43 file hashes with the supplied inventory. That established
identity with the supplied inventory, not independent remote-commit provenance.

The review fully read the executable core (`server.js`, backend modules, local UI
script, CLI and rendering entry points). Tests were inventoried and selectively
examined, with particular attention to storage, local export, project selection,
layout and rate-limit checks. It did not semantically audit every test or inspect
the screenshots visually. No repository code, test suite, build, browser attack,
network capture or live API export was executed. No real account or token was used.
The following line references belong to that frozen commit, not the repaired tree.

## Findings F01-F18

Severity described possible impact when a trigger occurred. It did not measure
frequency, establish a working remote attack or prove that every API response could
produce the hypothesized condition.

| ID | Original severity | Baseline source finding and boundary | Baseline evidence |
| --- | --- | --- | --- |
| F01 | High | Update removed the previous attachment directory before replacement downloads. An expired file, 404, 429 or interruption could destroy the only saved bytes. | `lib/export-runner.js:700-714,745-773`; `lib/export-files.js:109-126` |
| F02 | High | Resume classification trusted valid unchanged JSON. Missing Markdown, failed/missing media and altered output options did not reliably trigger repair; missing-HTML errors could be suppressed. | `lib/export-runner.js:503-550`; `lib/resume-state.js:18-36` |
| F03 | High when used as backup | ZIP collected current-run buffers, excluding resumed/moved artifacts and some existing GPT files. It overwrote the prior ZIP and was produced before the root index. | `lib/export-runner.js:97,124-128,525-595,835-846` |
| F04 | High, conditional | Loopback binding existed, but authentication, Host/Origin/CSRF and JSON content-type checks were absent. Local write/read operations were exposed with process permissions. Browser-origin exploitation depended on browser protections and was not executed. | `server.js:56-61,127-139,197-206,295-329,354-356` |
| F05 | High for completeness | Some conversation/file errors were counted; GPT, project-resource, inventory, move, HTML and index failures could remain log-only. A green completion screen did not prove complete output. | `lib/export-runner.js:137-140,203-207,246-262,397-399,786-792,857-880`; `server.js:173-176` |
| F06 | High, conditional | Untrusted titles, error text and directory names flowed into `innerHTML` in the token-bearing interface. Full pasted session JSON remained in the field. Code execution/token access required an accepted malicious value; no exfiltration was demonstrated. | `public/index.html:496,780-806,829-831,899-902,990-1021`; `lib/export-runner.js:823` |
| F07 | High | Archive HTML loaded unversioned CDN scripts/styles and inserted unsanitized Markdown-derived HTML. Generated pages lacked CSP and the index frame lacked sandboxing. Active content/network access was possible by source structure; an exploit was not run. | `lib/html-renderer.js:51,68-80,106,154-166`; `lib/export-index.js:142` |
| F08 | High | Output had no account/workspace binding. Reusing a folder under another token could mix local inventories and move old items into `deleted/`. No upload of one account's data to another was shown. Real workspace routing was unknown. | `lib/conversation-storage.js:63-99`; `lib/export-runner.js:365-398,470,520` |
| F09 | High | HTTP-200 responses with unknown schema could become empty inventories. Owned-only projects restricted scope; unstable offset pagination could omit items. Absence could then be labelled deletion. Real occurrence and complete project coverage were unverified. | `lib/chatgpt-api.js:128-159`; `lib/export-runner.js:187-205,297-321,354-389` |
| F10 | High | Concurrent export, picker or regeneration jobs could reset shared pacing/429 state and interfere with writes. Dropping the progress stream did not cancel the exporter. | `lib/chatgpt-api.js:33-59,78-98`; `server.js:102-122,151-190,213-239,270`; `lib/export-runner.js:20,894` |
| F11 | Medium-high, conditional | Download metadata/redirect destinations lacked an explicit per-hop scheme/host/port policy, internal-address checks and limits. Initial bearer forwarding was restricted to ChatGPT hosts. Redirect token leakage and SSRF were not demonstrated. | `lib/chatgpt-api.js:65-75,110-118`; `lib/export-files.js:192-272,315-329` |
| F12 | High | Group moves deleted existing targets and renamed JSON, Markdown, HTML and files separately. A failure could split the group; the operation was not atomic despite its comment. | `lib/conversation-storage.js:112-132`; `lib/export-runner.js:553-555` |
| F13 | Medium-high | Projects used cleaned names without stable IDs; conversations/GPTs used short ID prefixes. Fallback lookup did not verify full JSON identity. Case-sensitive deduplication could overwrite names on case-insensitive filesystems. | `lib/export-runner.js:121-128,219-244,486`; `lib/export-files.js:54-79,97-105` |
| F14 | Medium | Local logs contained archive-sensitive titles/paths/IDs and limited error bodies. Debug paths exposed signed URLs and proxy values; the log endpoint lacked access protection. Ordinary authorization headers were not found in the logging path. | `server.js:28-50,279-288`; `lib/chatgpt-api.js:67-73,104-105`; `lib/export-runner.js:62-84,752,825` |
| F15 | Medium-high for large archives | Unbounded bodies, downloads, raw local JSON, attachment buffers and ZIP accumulated in memory. Downloads lacked explicit deadlines. The ZIP writer lacked ZIP64 and the UTF-8 flag. No volume/memory experiment was run. | `server.js:84-85,128-129,198-199`; `lib/chatgpt-api.js:69,118`; `lib/conversation-storage.js:41-55`; `lib/export-runner.js:97,470,741,838`; `lib/zip.js:17-49` |
| F16 | High for a complete GPT backup | Discovery fields produced Markdown only; existing output could stay stale. No raw GPT JSON, separately proven full configuration or Knowledge download path was present. | `lib/export-runner.js:99-140`; `lib/entity-markdown.js:26-65` |
| F17 | Medium-high | Sandbox identity was the path alone; multiple historical versions could collapse into one download. References existing only in `metadata.content_references` were not generally downloaded. Actual API/version availability was unknown. | `lib/sandbox-files.js:23-41,75-95,109-127`; `lib/export-files.js:131-189,279-287`; `lib/markdown.js:132-134` |
| F18 | Medium-high | Corrupt local JSON could be silently ignored. A parseable incomplete object could satisfy resume metadata. Direct non-atomic JSON writes and a later derivation failure could leave incomplete output. | `lib/conversation-storage.js:39-59`; `lib/resume-state.js:18-36`; `lib/export-runner.js:771-780,821-825` |

## Positive observations and distribution caveats

Successful conversations were saved as raw JSON. Active/archived inventory paths
were separate. Project inventory preceded project queue filtering, and explicit
known inventory failures could suppress deletion reconciliation. These were useful
mechanisms, with the limitations above.

The package file list omitted `lib/` although the server imported it. CLI import and
server auto-start could attempt startup twice. Build tools were unpinned, the
Windows target used Node 18, and the tag release workflow lacked tests and referred
to upstream packages. No installed npm package, binary identity, signing, clean
build or Windows/macOS runtime was validated. Upstream EXE/npm distribution did not
prove inclusion of this fork's changes.

## Original recommendation and later use

The original recommendation was to withhold claims of a reliable large multi-day
backup from the unchanged baseline and first reproduce preservation, resume,
inventory, HTML and local-access failures with synthetic data. Proposed experiments
were not results. The subsequent repair effort narrows scope: no internal ZIP,
no shared projects or GPT Knowledge files, and no archive-wide full-text search.
Current fixes, executed tests and open findings must be evaluated against the
repair commit separately. The follow-up static assessment is summarized in
[`second-ai-review.md`](second-ai-review.md).
