# Security model and limitations

This is a local archive exporter. It reads the selected ChatGPT API inventory and
writes files with the permissions of the user running Node. The implementation and
its tests are under review; the historical AI-assisted reviews in
[`docs/reviews`](docs/reviews/) assess the frozen starting commit. They do not
certify the current repair diff. Development tests use synthetic data and fake
credentials; no real user archive or live ChatGPT token has been used in those tests.

## Local interface and credentials

The server listens on `127.0.0.1`. Its private launch URL contains a random
capability in the fragment. The interface reads that capability, removes the
fragment from the address bar and supplies it as `X-CGE-Key` on every API request,
including the fetch-stream progress connection. The public HTML does not contain
the capability. Knowing a job ID alone does not authorize progress access.

The server checks the exact loopback Host, rejects foreign Origins, requires the
local Origin and JSON content type for POST requests, and bounds request bodies.
A single-operation lock prevents export, regeneration and project selection from
interfering within one server. These controls do not isolate the process from
malware running as the same OS user. Anyone who obtains the launch URL can invoke
local operations with this process's permissions. Keep the terminal output and
launch URL private and stop the server when finished.

The pasted session field is cleared when read. The browser retains the parsed
credential in a closure for the local operation/project selection, with a short
expiry; completion/reset clears the cached credential. The server releases its
request token reference after the job. Tokens are not deliberately written to
preferences, archives or logs. This does not erase browser/OS clipboard history,
process memory, crash dumps or swap. Debug output is deliberately minimal and
network diagnostics redact bearer values, signed queries and URL credentials.

The local interface inserts untrusted values as text and uses a script-hash content
security policy. The server supplies no permissive cross-origin access headers.
Directory selection and creation remain local filesystem capabilities, so use a
folder you control. Archive output and logs contain private conversation data;
they are not encrypted by this application.

## Workspace scope and completeness

An archive is bound to a supplied session user ID and an explicit workspace/account
ID. Requests to the exact ChatGPT origin receive that workspace header. The binding
is declared: it does not independently authenticate the session's user ID or prove
provider-side workspace routing. Before using real data, compare the returned
active/archived inventory and projects with the intended web workspace. A different
user/workspace declaration requires a separate empty output folder.

Schema, IDs and pagination are checked. Remote absence does not trigger automatic
moves into `deleted/`; old local content remains available. A completed requested
scope is not evidence that an undocumented provider endpoint exposes every item,
every media type, all historical versions or a stable snapshot. Shared projects
and GPT Knowledge files are outside scope. Saved GPT metadata is the data returned
by discovery, not a proven complete GPT configuration. Sandbox paths represent the
latest available download, not a complete history of same-path file versions.

## Offline HTML and original files

Generated conversation and project pages are rendered during export with the
versioned local parser documented in [`VENDOR.md`](VENDOR.md). Raw HTML is escaped;
links and images follow a restrictive output policy. Remote images are not embedded.
Only mapped local raster images can be embedded. Generated documents have a
restrictive content security policy and do not need runtime parser/CDN downloads.
The index offers navigation and title search and loads local pages without `fetch`.

The index's content frame is sandboxed with scripts disabled. It permits local
same-origin file rendering, downloads and deliberate popups for links. Generated
conversation pages themselves need no scripts. External HTTP(S)/mailto links may
open only when the reader follows a link. Browser handling of `file:` URLs, CSP and
sandbox flags must still be checked for each claimed platform/browser combination.

The generated viewer's protections do not sanitize original attachments. HTML,
SVG, XML, scripts, office documents and other original files can contain active
content or cause network access when opened directly or in another application.
The viewer does not embed active original formats as images; it preserves their
bytes and labels obvious active formats. Choose an appropriate viewer before
opening originals. File extensions and a successful download are not malware or
file-type validation.

Raw Markdown preserves conversation text and may contain raw HTML, external image
URLs or original links. A separate Markdown renderer can interpret them differently
and load remote resources. JSON also preserves source strings. The offline HTML
security policy does not follow these files into another viewer.

## Network policy and resource limits

Production requests require HTTPS on port 443. API requests are restricted to
`chatgpt.com`. Binary downloads permit `chatgpt.com`, `oaiusercontent.com`,
`openai.com`, their configured content-host suffixes (`.oaiusercontent.com`,
`.openai.com`) and `.blob.core.windows.net`. Metadata can contain signed download
URLs. Each redirect is checked again, with at most five hops. The bearer token and
workspace header are supplied only to the exact `https://chatgpt.com` origin;
external content hosts receive minimal download headers.

Every production destination is resolved and checked for private/non-routable IP
addresses. The native HTTPS connection is pinned to the validated public address
and TLS verifies the requested hostname. TLS verification is not disabled. The
allowlist can reject newly introduced legitimate provider hosts; report the failure
instead of broadening it without evidence. The production native HTTPS transport
connects directly and does not implement authenticated/corporate proxy support.
Live provider compatibility, corporate network routing and all possible signed
content-host variants have not been established by synthetic tests.

Defaults are a 32 MiB API response limit, a 256 MiB download limit and a 60-second
request deadline covering DNS, headers and body consumption. Downloads stream to
unique partial files before publication and compute SHA256. JSON still requires
memory up to the response limit; archive inventories/manifests and recovery copies
also consume memory/disk. Limits can prevent a legitimate large item from exporting;
the failure must remain visible. Unsolicited compressed responses are rejected after
requesting identity encoding. The compatibility binary-buffer API remains bounded.
Test-only endpoint/transport injection is programmatic and is not offered through
the interface or environment variables.

## Preservation, reporting and recovery

Export replacements use separate staging generations, retained backups and a
publication journal. Recovery resolves incomplete journalled publication on the
next locked run. This is recoverable multi-file publication, not a transactional
filesystem or a guarantee against hardware failure. Previous copies under
`superseded/` increase disk use and remain as sensitive as the active archive.
Failed downloads can retain a verified previous attachment while reporting the
failure; a retained copy does not prove that it matches a newly changed remote file.

Review the saved export report and hash manifest before creating an OS ZIP of the
finished, idle folder. Hashes detect changes relative to that manifest; they do not
prove upstream authenticity, full server-side coverage or malware safety. This
application does not provide encryption, a separate backup destination or automated
backup retention.

For a reproducible security report, provide the affected commit, a synthetic fixture,
expected/observed behavior and redacted logs. Use a private repository security
report if that feature is available; otherwise request a private reporting channel
without posting secrets or real conversation content in a public issue.
