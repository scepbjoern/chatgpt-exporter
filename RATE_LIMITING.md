# Rate limits and retries

The local API client serializes ChatGPT requests and stops a run after its first observed ChatGPT429. Queued requests remain stopped until a new operation resets the limiter; concurrent project-picker/export/regeneration operations are rejected.

A429 is a **partial operation**, not successful completion. Retry-After is displayed only in a restricted safe form. Wait before rerunning; the service determines when access is available. No fixed export throughput or daily allowance is promised.

The durable report records rate-limit and media/conversation errors. A generation interrupted before commit is not adopted as complete. Saved previous bytes and the transaction journal remain; the next locked run recovers them. Unavailable files remain explicitly incomplete and are retried. Closing the progress connection does not cancel the export.

See [README.md](README.md) for recovery, limits and archive verification. No real-account rate-limit experiment has been run for this repair candidate.
