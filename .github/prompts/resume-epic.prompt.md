---
agent: epic-orchestrator
description: Resume an Epic run from its status.md after a break or a blocked Repo Gate.
---

Resume the Epic described in [epic-request.md](../../epic-request.md).

1. Read `docs/epics/<epic_id>/status.md` and the latest files in that folder.
2. Re-run the Repo Gate checks against the current state of the repos (they may have been fixed or changed since).
3. Report where we are in one short paragraph, then continue from the next action. Respect every gate and the iteration limits already recorded.
