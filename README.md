# ChatGPT Exporter — local archive review candidate

A source-only fork for saving the ChatGPT conversation data the service actually returns as raw JSON, Markdown and a self-contained offline HTML folder. Start the exporter locally, complete a run, stop it, then open the archive's `index.html` by double-clicking. The viewer has navigation and **title search**, not full-text search.

**Review status:** the targeted Opus 5.5 AI review found additional defects; the [repair response](docs/reviews/opus-repair-followup.md) records N1–N9 and their regression tests. The follow-up fixes are awaiting targeted review. [TESTING.md](TESTING.md) records actual synthetic checks. No real-account export, complete Business workspace backup, professional security audit or production release is claimed. Do not use upstream executables/npm packages as builds of this fork.

## Origin and changes

This work starts at [moisescastellano/chatgpt-exporter](https://github.com/moisescastellano/chatgpt-exporter), commit `78efcdc396816997e843abbab58a966708b79dc9`, itself based on [ezwep/chatgpt-exporter](https://github.com/ezwep/chatgpt-exporter). Original authorship and the [MIT licence](LICENSE) remain. See [CHANGELOG.md](CHANGELOG.md), [SECURITY.md](SECURITY.md), [the finding matrix](docs/reviews/repair-matrix.md) and the sanitized [first](docs/reviews/initial-review.md) and [second AI review](docs/reviews/second-ai-review.md).

This fork replaces destructive updates with recoverable generations, verifies saved media size/hash, retries incomplete media, regenerates local views, binds new archives to a declared user/workspace, disables automatic deletion inference, removes internal ZIP creation and its byte buffers, restricts download destinations, protects local APIs and pre-renders safe offline HTML. Downloads are sequential to bound memory. Existing Markdown rendering options are retained.

## Run from source

Use **Node.js 24**; the recorded test version is **24.11.0**. Windows and macOS are target systems. No runtime npm install is needed: the pinned Markdown parser and its licence are vendored locally. Browser-test dependencies are development-only.

```text
git clone --branch repair/offline-preserving-export https://github.com/scepbjoern/chatgpt-exporter.git
cd chatgpt-exporter
node server.js
```

Open the complete private launch URL printed by the process. Its random fragment authorizes the local interface; the page removes that fragment from the address bar. Reloading requires reopening the complete launch URL. Keep that URL private and stop the process with Ctrl+C after use. There is no published executable or npm release of this repair candidate.

Paste your session JSON from `https://chatgpt.com/api/auth/session` into the local page and supply the **explicit workspace/account ID** for the intended workspace. The pasted session must contain `accessToken` and `user.id`. Obtain the actual selected workspace ID from the authenticated service's account selection or your administrator; do not guess it. The session field is cleared after parsing; a project-picker credential cache expires after five minutes. Neither the ChatGPT token nor session JSON is saved in the archive.

Choose a **new, empty, short local output folder outside cloud synchronization**, such as `C:\cge\archive` on Windows. New live paths longer than 250 characters fail visibly; older retained histories may still contain longer paths. `archive-keys.json` registers compact path keys against full source identities and extends collisions. The exporter writes `archive-identity.json` on first use and refuses a different declared user/workspace. It sends the workspace ID as `ChatGPT-Account-Id`; this routing still requires a separate real inventory comparison. A synthetic identity test does not verify how the live Business service routes requests.

An old unbound export is deliberately not adopted as the same account automatically. Use **Regenerate local views** to rebuild its local MD/HTML without a token, or use a new empty folder for new network exports. Back up old folders first. The regenerated viewer does not prove the old archive's original completeness.

## What the archive contains

- Raw JSON for successfully obtained conversations, always retained as the comparison source. JSON is serialized service data, not a byte-identical HTTP response and not proof of service completeness.
- Markdown with the existing branch, source-link, metadata, label and activity options. HTML is a separate tree view; it need not display exactly the same branch selection as Markdown.
- Pre-rendered HTML with local navigation and title search. Assistant/tool text does not depend on browser JavaScript or a CDN. Raw HTML is displayed inertly. Remote images are not automatically loaded; ordinary external links work only when clicked.
- Recognized available attachments and sandbox outputs, with `.file-map.json` size/SHA256 records. Original HTML/SVG or other active files remain original bytes and must be opened with care; viewer protections do not sanitize originals or arbitrary Markdown readers.
- Owned-project metadata/resources returned by the inventory, GPT raw metadata plus Markdown, durable reports, recoverable previous generations and an archive manifest.

**Not included:** GPT Knowledge files, shared projects, all historical sandbox versions, Codex tasks/local sessions, an import into another chat service, unavailable/expired server files or a guaranteed complete set of audio/video/new content types. GPT discovery metadata is not a full GPT configuration export. The latest available file for a reused sandbox path can be linked by several messages.

## Completion, recovery and ZIP

Read the final on-screen status and the matching `logs/export-report-<runId>.json` or `regeneration-report-<runId>.json`. A partial status is not completion, even if some conversations succeeded. `archive-operation.json` marks an operation in progress or its final status. A stopped process can leave a stale manifest; rerun to recover before treating it as current.

Updates are staged; replaced targets and retired source artifacts remain under `superseded/` with journals. If a later step fails after valid raw data was obtained, `retainedUnpublishedRaw` in the report identifies a retained raw copy under `superseded/unpublished-<runId>/`; it is not a completed generation or a resume key. A locked next run rolls back uncommitted publication or completes committed retirement. This is recoverability across process interruption, **not simultaneous multi-file atomicity or a guarantee against power failure, disk corruption/full disks or other programs modifying the archive**. Never manually remove a lock while a writer is active. A `.export-lock.guard` left by an interruption during lock acquisition requires inspection; it is not automatically removed. No automatic retention/pruning occurs: previous generations consume disk space. Preserve a separate backup before cleanup.

A conversation absent from the current inventory stays at its prior location and generates a warning; it is not automatically marked deleted. Existing `deleted/` folders remain readable. A schema/page error prevents a clean completion. Re-run later after a 429; saved bytes remain available and incomplete files are retried.

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
