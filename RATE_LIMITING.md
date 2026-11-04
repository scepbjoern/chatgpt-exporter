# Rate limits and retries

The client serializes requests. Export and preview enable bounded automatic retries: at most eight retries for HTTP 429 on an individual request, and at most three for temporary 500/502/503/504 or eligible connection/header failures. HTTP 403/404 are not automatically retried. The server's Retry-After is read as seconds or an HTTP date and never shortened.

## Remembering repeated limits within a run

Rate-limit pressure is shared across requests in the same operation. Each 429 raises the next fallback pause: **1, 2, 4, 8, then 15 minutes**, remaining at 15 until recovery. The actual pause is the greater of this fallback and Retry-After. One or two successful conversations do not reset the next pause. Each observed retryable 429/5xx also increases request spacing by a factor of 1.5, up to 30 seconds.

Recovery requires **at least ten successful HTTP responses and at least five minutes since the first response in that stable period**. At that point pressure decreases one level and spacing is divided by 1.5, never below the selected minimum. Another reduction needs another qualifying stable period. Any failed HTTP response or eligible transport error resets the stable-period count. Waiting through a rate limit alone does not count as stable operation. These are conservative client heuristics, not a documented provider quota or a promised throughput.

Retry limits remain per request; the shared pressure does not impose a new eight-event limit on the whole export. Adaptation is held in memory for the current run. A new operation resets it; it is not an account-wide persistent quota tracker. Preview and export are separate operations.

The on-screen countdown shows automatic continuation and offers Stop safely. Exhausted retries stop the run with a partial report. Prior bytes and transaction journals remain; the next locked run recovers before resuming. Missing files are recorded explicitly. Closing the progress connection does not cancel an export; use Stop safely.

Tests use a fake clock and synthetic HTTP responses to cover cross-request escalation, stable-period decay, the retry cap, long server waits and cancellation. Real-account testing is ongoing; its outcome is separate from those synthetic checks. See [TESTING.md](TESTING.md) and [README.md](README.md).
