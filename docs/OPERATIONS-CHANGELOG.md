# Codex Pocket Operations Changelog

This is a concise, secret-free record for humans and future agents. Detailed topology and guardrails are in `OPERATIONS.md`.

## 2026-08-26

- Investigated mobile access failure: Alibaba Cloud proxy and reverse tunnel were healthy, but the local Codex Pocket process was not listening on port `8787`, producing public `502` responses.
- Restored the server watchdog and verified local health plus authenticated public health return `200`.
- Confirmed the Alibaba Cloud public entry uses Nginx/OpenResty, not Caddy. Existing listeners and proxy configuration must be preserved.
- Added an independent Windows `Codex Pocket Recovery Monitor` to restart a stopped server or tunnel watchdog after its health check fails.
- Consolidated the three initial scheduled tasks into one `Codex Pocket Supervisor`. It manages both the Node service and SSH tunnel internally, reducing background PowerShell memory and configuration complexity.
- Added a one-minute recovery trigger after testing showed that Task Scheduler's failure-restart setting alone does not reliably recover a supervisor terminated externally.
- Recorded the permanent repository rule that every verified project change must be committed and pushed to the private GitHub `origin`, while machine-local secrets remain excluded.
- No credentials, access codes, private keys, API tokens, or Codex conversation data were changed or recorded here.
