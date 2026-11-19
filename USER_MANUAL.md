# User guide

This is a source-only review candidate. Read [README.md](README.md) and [SECURITY.md](SECURITY.md) before a real-account trial.

1. Install a supported Node.js 24 release (recorded tests use24.11.0), obtain this fork's repair branch and run `node server.js`.
2. Open the complete private launch URL. Paste the session JSON, enter the intended explicit workspace/account ID and choose a short empty local output folder outside cloud synchronization. A new live artifact path above 250 characters fails with a request to use a shorter root.
3. Before any broad real export, compare the live inventory with the selected workspace: active/archived counts, owned project list and known conversation titles. This live routing check has not been performed by the automated tests.
4. Select conversations/projects/GPT metadata, output formats and optional Markdown fields. Raw JSON is always saved. A disabled existing view remains an older snapshot; enable it or regenerate to refresh it. Download pace is one file at a time; keep-awake is optional and initially off.
5. Start and wait for the durable final report. Closing a progress connection does not cancel the running export; leave the process running until it finishes or stop it explicitly. Never run two writers on the same folder.
6. If partial, inspect the final report categories. After a429, wait before rerunning. Missing/failed media are retried; previously saved bytes survive unsuccessful replacement. Files above the configured bounds remain errors, not successes.
7. Stop the exporter. Double-click the archive's `index.html`. Search by title, expand projects, open conversation text and project info, and test expected attachments. External links open on deliberate clicks; no viewer library is downloaded.
8. Create a complete folder backup with operating-system tools, extract it elsewhere, verify with `node scripts/verify-archive.mjs <folder>` and open the extracted index.

## Local regeneration

**Regenerate local views** requires no ChatGPT token. It rebuilds MD, safe pre-rendered HTML and index from raw JSON, using exact local file identities. It does not download missing files, repair unavailable remote data or prove prior completeness. A malformed raw file or unavailable media is reported. The operation uses the same archive writer lock, recovery journal and manifest mechanism. Previous replaced MD/HTML remain under `superseded/`.

## Interpretation

“Complete within requested scope” means the selected operation reported no known failure. It is not a proof that the API exposed every historical message/file. Missing items are not automatically classified as deleted. Branches and hidden/tool content differ between readable formats; retain JSON for comparisons.

Unknown/new content schemas, expired attachments, historical sandbox versions, shared projects and GPT Knowledge are explicit limitations. Raw metadata does not imply complete GPT/project configuration. Original active files and exported Markdown are outside the HTML viewer's rendering protections.

## Troubleshooting

- **Interface inactive after reload:** reopen the complete private launch URL from the terminal.
- **Identity mismatch/unbound old archive:** use a new folder for new exports; regenerate old local views separately. Do not edit the identity file to bypass a mismatch.
- **Archive locked:** let the existing writer finish. A later run can reclaim a lock only after its process is gone; malformed locks require inspection.
- **Interrupted operation:** rerun with the same identity and folder. Inspect the recovery count and latest report. Do not move individual files out of a pending transaction.
- **Network/timeout/size/host error:** inspect the category. No workaround that disables TLS, destination checks or size limits is provided. Direct HTTPS is required; corporate proxies are not implemented.
- **File present but not linked:** check the exact file-map entry and integrity. Similar names are not guessed.

For security details and residual tests, follow [SECURITY.md](SECURITY.md), [TESTING.md](TESTING.md) and the [repair matrix](docs/reviews/repair-matrix.md).

## Checking individual files and formulas

A conversation or project can be saved while an individual file fails. Check the file
entry in the result or in `archive/missing-files.md` for its name, source and observed
reason. A refusal applies to that request. A missing download address leaves the
cause open. A server error can be temporary. A repeated run in the same output
folder checks project metadata again and attempts missing resources. It keeps
an existing local copy when a replacement download fails.

`archive/missing-files.html` and its Markdown counterpart include earlier open
references, even after a filtered or stopped run. Open the original chat or project,
find the listed filename and download it through ChatGPT. Save manual copies in
`archive/manual-downloads/`, beside the report. Create project/chat subfolders
there as needed. For a legacy flat export, use `manual-downloads/` beside the
report at the output root. Include this folder in your backup. The exporter
replaces its managed attachment and view folders during later exports. Manual
copies remain separate from its file map and do not automatically clear the list.

Integrity checks compare files with the last recorded manifest. Changing a manual
file already included there causes a mismatch until the manifest is refreshed.
After intentional manual additions, edits or moves, run **Regenerate local views**
once, then run the archive verifier again on the complete output folder. The local
regeneration keeps manual file bytes and records the new hashes. A successful
hash check still needs to be considered together with the export's missing-file
report.

A project display icon can be part of the raw metadata. The exporter downloads
files listed in the project resource inventory. The offline conversation view
shows common inline and multiline TeX formulas as readable source with their
delimiters and line breaks. The original message remains in the conversation JSON.
Outside a matched TeX expression, the HTML viewer applies ordinary Markdown escaping. For example, a backslash before a literal brace may only be visible in the source Markdown and JSON.

## Damaged local metadata

A **Local metadata** warning names a file relative to the readable archive
(`archive/` for organized exports). The same path is in `errors[].id` for the
`recovery-metadata` entry in the saved export report. The recovery list may be
incomplete until this is resolved.

1. Stop the export and copy the **complete output folder** as a backup.
2. In the original output folder, select **Conversations** and **Projects**, remove
   date and project filters, and start the export again. Invalid conversation maps
   are rebuilt from the conversation references, and attachments are retried.
   Previous bytes remain in the working directory's `superseded/` backups.
3. A damaged `project-raw.json` is rebuilt from the current inventory. Existing
   resource files are kept, and the damaged metadata is backed up. However, earlier
   references missing from today's inventory cannot be reconstructed reliably.
   The archive therefore keeps a coverage warning and partial status across retries.
4. If this project warning remains, keep the complete old archive and choose a
   **new empty output folder** for a separate current export. Check its report and
   missing-file list. It is a current snapshot, not a replacement for lost history.

Do not delete metadata or backups to suppress a warning. **Regenerate local views**
does not repair these mappings and does not clear a project coverage warning in
the recovery list. Its separate success status describes local view generation only.
