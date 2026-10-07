---
agent: epic-orchestrator
description: Run the guarded multi-agent workflow for the Epic and repos in epic-request.md (analysis, Repo Gate, development, review, test).
---

Start the Epic workflow using [epic-request.md](../../epic-request.md).

Follow your workflow exactly:
1. Read the Epic URL, options and repo allow-list from `epic-request.md`. If the file is missing, tell me to run `node scripts/setup.mjs --epic <url> --repos <list>` and stop.
2. Fetch the Epic. If you cannot open it, ask me to paste its text.
3. Create `docs/epics/<EPIC-ID>/00-epic-brief.md` and `status.md`.
4. Hand off to the Analyst, then run the Repo Gate.
5. Change code only if the Repo Gate passes: every repo that needs changes is on the allow-list and READY, and no extra repos are needed. Otherwise stop and tell me exactly what is missing.
6. Respect Gate 1 (unless `auto_proceed: yes`) and Gate 2. Never push or open a PR yourself.
