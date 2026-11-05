# ChatGPT Exporter — local archive review candidate

A source-only fork for saving the ChatGPT conversation data the service actually returns as raw JSON, Markdown and a self-contained offline HTML folder. Start the exporter locally, complete a run, stop it, then open the archive's `index.html` by double-clicking. The viewer has navigation and **title search**, not full-text search.

**Pilot status:** A targeted AI-assisted review of `4e77c8f` checked offline navigation, formulas, file diagnostics and interrupted project exports. The follow-up change preserves resource links across interruptions and tries another metadata route when a download host refuses a file URL. A personal-account test reached the end of the discovered conversation list across resumed runs, with individual files still unavailable. Managed-device installation and live Business workspace coverage remain open pilot checks. See the [test record](TESTING.md). Use the source package for this fork and install Node.js 24 separately.

## About this fork

> **This is `scepbjoern/chatgpt-exporter`, a substantially revised fork of a fork.**
> It builds on [moisescastellano/chatgpt-exporter](https://github.com/moisescastellano/chatgpt-exporter), which builds on [Erik Zwep's original exporter](https://github.com/ezwep/chatgpt-exporter). Their work provides the foundation. The additions and replacements maintained here are listed below; they should not be attributed to either upstream repository.

### Credits and inherited foundation

The original project supplied the exporter and browser interface, conversation/project/GPT retrieval, multiple export formats and archive navigation. The moisescastellano fork added or extended Smart Resume, generated-file mapping, selective projects, Markdown regeneration, branch selection, metadata/timestamp/label options, activity summaries and download diagnostics.

Our fixed starting point is **moisescastellano commit [`78efcdc3`](https://github.com/moisescastellano/chatgpt-exporter/tree/78efcdc396816997e843abbab58a966708b79dc9)**. This comparison describes changes since that snapshot, not claims about the current state of other forks. The original copyright notice and [MIT licence](LICENSE) remain unchanged; vendored dependencies retain their attribution in [VENDOR.md](VENDOR.md).

### Added or substantially reworked in this fork

| Area | Work maintained in this repository |
| --- | --- |
| Preserving existing archives | Recoverable publication generations and journals; retain replaced bytes and disabled views, repair missing/corrupt media, verify size/SHA256, and recover interrupted operations. Resume was inherited; its preservation/recovery behavior was reworked here. |
| Automatic rate-limit recovery | Replace stopping at the first 429 with bounded automatic retries, Retry-After support, adaptive request spacing, run-wide escalating pauses, gradual recovery, countdown and safe cancellation. |
| Preview and export interface | Metadata-only selection preview, session reuse, required-field validation, six-step workflow, detailed inventory progress and separate saved-content, missing-file and error panels. |
| Offline HTML and source rendering | Locally vendored renderer, inert untrusted HTML, restricted URLs and no automatic external assets; static presentation widgets and saved citations, read-only forms, separate branch continuations and original-chat links. |
| Finding archived content | Dated chat filenames with up to 32 title characters, stable identities, an always-generated Markdown index and independent HTML index with title search, date filtering/sorting and three collapsible groups for GPT metadata, projects and conversations. Filters reveal matches inside closed groups. |
| Projects, files and reports | Preserve resource filename extensions; enrich project summaries with referenced/local counts and links; list missing files with their known chat/project context; distinguish a missing address, a service refusal, a refusal at the download host and an unknown cause. Publish project resources with their ID-to-file map so interrupted exports preserve local links. |
| Archive layout and account binding | Separate readable `archive/` (including raw JSON) from `_work/`; retain legacy layouts; explicit declared user/workspace binding; validated inventory pagination; no automatic deletion inference from absence. |
| Local and network boundaries | Per-launch local API authorization, Host/Origin checks, token lifecycle, validated download destinations/redirects, bounded streaming, DNS/header/body deadlines and sequential downloads. |
| Validation and documentation | Reworked behavior tests, interruption/recovery scenarios, native ZIP/path checks, offline/browser checks and Windows/macOS CI; documented findings, repairs and remaining limitations. |

Some inherited behavior was deliberately removed or changed: internal ZIP creation was replaced by OS ZIP tools; downloads run sequentially; missing inventory items are preserved rather than automatically classified as deleted. These are explicit design choices, not missing attribution.

See [CHANGELOG.md](CHANGELOG.md) for version history, [TESTING.md](TESTING.md) for executed checks, [SECURITY.md](SECURITY.md) for trust boundaries and [the repair matrix](docs/reviews/repair-matrix.md) for findings. The sanitized [initial review](docs/reviews/initial-review.md), [second AI review](docs/reviews/second-ai-review.md) and [Opus follow-up](docs/reviews/opus-repair-followup.md) distinguish review evidence from actual tests. This work is maintained by [scepbjoern](https://github.com/scepbjoern); substantial implementation and testing assistance came from AI coding agents, with human-directed practical testing.

## Run from source

Use **Node.js 24**; the recorded test version is **24.11.0**. Windows and macOS are target systems. No runtime npm install is needed: the pinned Markdown parser and its licence are vendored locally. Browser-test dependencies are development-only.

**Managed computers:** Node.js is installed separately. Its installation may require administrator rights or IT-managed deployment. A successful test on a personal/admin account does not establish that installation and use work on a managed standard-user account. Test installation, launching the exporter and writing a small export under the actual intended account. If installation is blocked, request approved IT provisioning rather than bypassing device policy. A bundled Node runtime is not included.

```text
git clone --branch repair/offline-preserving-export https://github.com/scepbjoern/chatgpt-exporter.git
cd chatgpt-exporter
node server.js
```

Open the complete private launch URL printed by the process. Its random fragment authorizes the local interface; the page removes that fragment from the address bar. Reloading requires reopening the complete launch URL. Keep that URL private and stop the process with Ctrl+C after use. There is no published executable or npm release of this repair candidate.

Paste your session JSON from `https://chatgpt.com/api/auth/session` into the local page and supply the **explicit workspace/account ID** for the intended workspace. The pasted session must contain `accessToken` and `user.id`. Obtain the actual selected workspace ID from the authenticated service's account selection or your administrator; do not guess it. Preview keeps the session available for Start Export for up to five minutes. Starting an export clears the field; a subsequent online run needs fresh session input. A running job keeps its token in memory until it ends. Neither the ChatGPT token nor session JSON is saved in the archive.

Choose a **new, empty, short local output folder outside cloud synchronization**, such as `C:\cge\archive` on Windows. Chat filenames use `YYYY-MM-DD - title (at most 32 characters) - stable key.ext`; dates are UTC creation dates, with `0000-00-00` for missing/invalid dates. New live paths longer than 250 characters fail visibly; older retained histories may still contain longer paths. For new UI exports, readable content is in `archive/` and technical state in `_work/`. Existing bound archives keep their original directory layout when resumed. Within the working directory, `archive-keys.json` registers compact path keys against full source identities and extends collisions. The exporter writes `archive-identity.json` on first use and refuses a different declared user/workspace. It sends the workspace ID as `ChatGPT-Account-Id`; this routing still requires a separate real inventory comparison. A synthetic identity test does not verify how the live Business service routes requests.

An old unbound export is deliberately not adopted as the same account automatically. Use **Regenerate local views** to rebuild its local MD/HTML without a token, or use a new empty folder for new network exports. Back up old folders first. The regenerated viewer does not prove the old archive's original completeness.

## What the archive contains

- Raw JSON for successfully obtained conversations, always retained as the comparison source. JSON is serialized service data, not a byte-identical HTTP response and not proof of service completeness.
- Markdown with the existing branch, source-link, metadata, label and activity options. HTML is a separate tree view; it need not display exactly the same branch selection as Markdown.
- Pre-rendered HTML with local navigation and title search. Assistant/tool text does not depend on browser JavaScript or a CDN. Raw HTML is displayed inertly. Remote images are not automatically loaded; ordinary external links work only when clicked.
- Recognized available attachments and sandbox outputs, with `.file-map.json` size/SHA256 records. Original HTML/SVG or other active files remain original bytes and must be opened with care; viewer protections do not sanitize originals or arbitrary Markdown readers.
- Owned-project metadata/resources returned by the inventory, GPT raw metadata plus Markdown, durable reports, recoverable previous generations and an archive manifest.

**Not included:** GPT Knowledge files, shared projects, all historical sandbox versions, Codex tasks/local sessions, an import into another chat service, unavailable/expired server files or a guaranteed complete set of audio/video/new content types. GPT discovery metadata is not a full GPT configuration export. The latest available file for a reused sandbox path can be linked by several messages.

## Completion, recovery and ZIP

For new organized exports, open `archive/index.md` or `archive/index.html`. The Markdown index is always created, including for JSON-only exports; the searchable HTML index is selectable independently of chat HTML. It offers creation-date filtering, date/title sorting and links to existing formats. Full titles remain in the index and raw JSON. Project summaries list referenced conversations/resources and distinguish local availability. `missing-files.md` lists unavailable references with their known chat/project context.

Read the final on-screen status and the matching `_work/logs/export-report-<runId>.json` or `regeneration-report-<runId>.json`. A partial status is not completion, even if some conversations succeeded. `archive-operation.json` marks an operation in progress or its final status. A stopped process can leave a stale manifest; rerun to recover before treating it as current.

Updates are staged; replaced targets and retired source artifacts remain under `superseded/` with journals. If a later step fails after valid raw data was obtained, `retainedUnpublishedRaw` in the report identifies a retained raw copy under `superseded/unpublished-<runId>/`; it is not a completed generation or a resume key. A locked next run rolls back uncommitted publication or completes committed retirement. This is recoverability across process interruption, **not simultaneous multi-file atomicity or a guarantee against power failure, disk corruption/full disks or other programs modifying the archive**. Never manually remove a lock while a writer is active. A `.export-lock.guard` left by an interruption during lock acquisition requires inspection; it is not automatically removed. No automatic retention/pruning occurs: previous generations consume disk space. Preserve a separate backup before cleanup.

A conversation absent from the current inventory stays at its prior location and generates a warning; it is not automatically marked deleted. Existing `deleted/` folders remain readable. A schema/page error prevents a clean completion. The UI export/preview automatically waits and retries 429 responses up to eight times per request, respecting Retry-After seconds or HTTP dates without shortening server waits. Fallback waits increase across requests within a run: 1, 2, 4, 8, then 15 minutes. A few successful requests do not reset this escalation. After at least ten successful responses over at least five stable minutes, the escalation drops one step and request spacing decreases one step toward the selected minimum. Repeated limits increase request spacing up to 30 seconds. Longer server-required waits are never shortened. A new operation starts fresh; adaptation is not persisted across runs. HTTP 500/502/503/504 and connection/header failures receive up to three retries. 403/404 are not retried. The UI shows the wait and offers Stop safely. Exhausted retries or expired authentication end the run with a report; restart later in the same folder. Network loss, machine sleep and session expiry can still prevent unattended completion.

Unchanged artifacts do not create another retained generation. Committed temporary copies are removed after target validation; changed backups, retired originals and reports remain. A view-generation error does not prevent valid raw JSON/media publication and is reported separately. Turning off a format preserves an existing view as a snapshot, including its local file links during moves. Re-enable that format or regenerate local views to refresh the snapshot.

After a finished, stopped run, copy the whole folder or use Explorer **Compress to ZIP** / Finder **Compress**. Include dotfiles such as `.file-map.json`, reports and `superseded/`. Extract to a different folder and check saved bytes:

```text
node scripts/verify-archive.mjs <extracted-folder>
```

The verifier checks the current operation marker/run identity, absence of a writer lock, manifest entries, sizes and SHA256. It rejects stale/interrupted operation state. A matching final partial report can pass byte verification while still indicating incomplete content. It does not prove remote completeness or inspect extra files. Open the extracted `index.html` as well. Safeguard the archive as private data; it is not encrypted by this tool.

## Checks and limits

```text
npm ci --ignore-scripts
npm test
npx --no-install playwright install chromium
npm run test:browser
```

CI runs synthetic Node/browser checks on Windows and macOS with Node 24.11.0; see [TESTING.md](TESTING.md) for actual outcomes and open manual checks. Playwright WebKit is not the installed Safari browser. Corporate proxy behavior, live workspace inventories, real-service CDN compatibility, sleep prevention, long paths and very large real archives remain separate checks.

API JSON is bounded to 32 MiB and downloads to 256 MiB each. DNS/connection/headers share 60 seconds across redirects; bodies allow 60 seconds without progress and a 30-minute overall cap. Larger or stalled files fail visibly. HTTPS downloads are restricted to the exact ChatGPT origin or the documented public CDN suffixes, validated and DNS-pinned per redirect. Production transport uses direct HTTPS and does not implement corporate HTTPS proxies. See [SECURITY.md](SECURITY.md) for the trust boundaries.

## Version 3.4 test workflow

Preview selection reads only inventory metadata and does not create archive files.
Changing the selection invalidates the displayed snapshot; export enumerates again.
Start Export requires session JSON, user/workspace identity, output folder and a valid
selection/date range. The progress display distinguishes chats already saved locally
from items checked in this run and names the conversation before work begins.

Use `archive/` for a standalone reading copy after reviewing the report; it includes
raw JSON, local file maps, original attachments and indexes. Keep the entire output
folder for resuming, integrity verification and recovery. Never discard `_work/`
while an operation is incomplete: it may contain unpublished raw data or historical
versions not present in the reading copy. Legacy archives are not automatically
reorganized. No automatic cleanup or portable bundled Node runtime is included.


### Reading the current archive

Known presentation widgets are converted to static content in Markdown and HTML; archived form choices are read-only. Citation links use saved metadata, with unavailable details explicitly marked. HTML groups tree alternatives into separate expandable continuations and links back to the original chat. The index starts with GPTs (metadata), Projects and Conversations collapsed. Archived and deleted entries are under Conversations. Search and date filters open matching groups; clearing filters restores the previous view. Paired TeX expressions appear as readable source with their delimiters and line breaks. Literal code and raw JSON are retained. The offline archive cannot reproduce every ChatGPT-specific interactive component.

Preview counts appear in a blue panel before Start Export. Inventory reading reports its phase and page counts. A refreshed token for the same account does not invalidate the selection. Saved content, missing files and other errors have separate result panels. Changing totals remain diagnostic-only when the final advertised total matches the discovered count; this is not an independent completeness guarantee.
