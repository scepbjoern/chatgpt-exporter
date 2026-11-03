# Repository guidance

This fork descends from `moisescastellano/chatgpt-exporter` at
`78efcdc396816997e843abbab58a966708b79dc9`, itself a fork of
`ezwep/chatgpt-exporter`. Preserve the MIT licence and existing author attribution.

## Architecture and conventions

- `server.js` serves the loopback interface and coordinates one local operation.
  `public/index.html` contains the existing interface and its browser script.
- `lib/export-runner.js` orchestrates inventories, downloads and publication.
  `lib/archive-store.js` owns archive locks, generation journals and recovery.
- `lib/chatgpt-api.js` owns network policy, pacing, response limits and workspace
  routing. `lib/export-files.js` resolves attachment and sandbox references.
- `lib/markdown.js` retains the existing Markdown converter and its output options.
  `lib/safe-markdown.js`, `lib/html-renderer.js` and `lib/export-index.js` produce
  the offline HTML archive. Vendored code and its provenance are listed in `VENDOR.md`.
- Keep JavaScript ES modules, `node:` imports and each file's existing style.
  Backend modules generally use two spaces, double quotes and semicolons. Make
  focused changes; avoid unrelated formatting or a framework/language migration.

## Data and trust boundaries

- Preserve raw source data and previous published bytes before replacements.
  Use the archive publication/recovery helpers for export artifacts. A group of
  files is recoverable through a journal; do not describe it as one atomic rename.
- Keep user/workspace binding explicit. A declared ID and a request header do not
  prove that the provider returned the intended workspace. Do not infer deletion
  from an item's absence in a remote inventory.
- Treat titles, paths, errors and all conversation content as untrusted. Use DOM
  text nodes in the local interface. Escape raw HTML and restrict generated URLs.
- The generated viewer must open locally without a server, token or automatically
  loaded external resources. Preserve navigation and title search. Full-text
  search, shared projects and GPT Knowledge files are outside the current scope.
- Never persist session tokens or include them in URLs, logs, fixtures or commits.
  The local launch capability grants filesystem/API access; keep it private.
- Test seams may relax policy only in explicitly created synthetic clients. Do
  not add environment/UI switches that disable production network checks.

## Validation and review

Run `npm test` after relevant changes. Keep useful converter and storage behavior
checks. Prefer observable bytes, hashes, files, requests and error reports over
assertions about source strings or success wording. Run browser tests when changing
HTML or UI behavior, and distinguish browser automation from a real OS/browser
manual check. Windows and macOS CI results must be recorded separately.

Use synthetic data and fake credentials. Record partial failures and unresolved
limits. Keep public documentation in English without private paths or account
data. AI-assisted reviews must identify their scope and evidence; do not present
them as independent professional audits or as executed tests.
