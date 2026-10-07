# Epic Agent Workbench

One project that takes an **Epic URL** plus the **repositories** where changes should be made, analyses the Epic with a group of GitHub Copilot agents, and then makes changes **only if every needed repo is available and no extra repo is required**.

## Quick start (3 steps)

Requirements: VS Code with GitHub Copilot Chat (agent mode), Node 18+, git access to your repos (HTTPS login or SSH key).

1. **Give it the Epic and repos**
   ```bash
   node scripts/setup.mjs --epic https://acme.atlassian.net/browse/PAY-123 \
        --repos acme/payments-api,acme/payments-web
   ```
   This clones missing repos into `repos/`, checks each one, and writes `epic-request.md` and `epic-workbench.code-workspace`.
   Other repo forms: full URLs, SSH URLs, or bare names with `--owner acme`. Add `--auto-proceed` to skip the human approval of the analysis (the Repo Gate still applies).
2. **Open the workspace:** `code epic-workbench.code-workspace`
   Always open the `.code-workspace` file, not the folder. Each repo becomes its own workspace folder, so Copilot search and edit tools can see it.
3. **Run it:** Copilot Chat, switch to **Agent** mode, run `/run-epic`.

To change the Epic or repos, re-run step 1 (it overwrites `epic-request.md`). To continue after a break or after fixing a blocked repo, run `/resume-epic`.

## What happens

```
epic-request.md -> Orchestrator fetches Epic -> Analyst (Repo impact table)
   -> REPO GATE ── FAIL -> STOP: no branches, no code, tells you what to add/fix
        │ PASS
        -> Gate 1: you approve the analysis (skipped if auto_proceed: yes)
        -> per story: Developer -> Reviewer (max 3 rounds) -> Tester
        -> Gate 2: you approve -> 05-handoff.md with push commands + PR text
```

**Repo Gate** passes only when all of these are true:
- The analysis lists no extra repositories (`None`).
- Every repo that needs changes is on your allow-list and READY (cloned, has a remote).
- Each of those repos has a clean working tree (your uncommitted work is never touched).
- There are no blocking open questions and at least one story.

If it fails, you keep the full analysis in `docs/epics/<EPIC-ID>/01-analysis.md`, and `status.md` says exactly what to fix. Fix it, then run `/resume-epic`.

## Files

| Path | Purpose |
|---|---|
| `scripts/setup.mjs` | Clones/validates repos, writes `epic-request.md` and the workspace file |
| `epic-request.md` | Single input: Epic URL, options, repo allow-list (generated) |
| `.github/copilot-instructions.md` | Global guardrails for all agents |
| `.github/agents/*.agent.md` | Orchestrator, Analyst, Developer, Reviewer, Tester |
| `.github/prompts/run-epic.prompt.md`, `resume-epic.prompt.md` | The `/run-epic` and `/resume-epic` commands |
| `.vscode/mcp.json` | GitHub MCP server so agents can read GitHub issues/Epics |
| `docs/epics/<EPIC-ID>/` | Shared state: brief, analysis, dev log, review, test report, status, handoff |
| `repos/` | Cloned target repos (git-ignored) |

## Guardrails built in
- Repo allow-list: agents never touch or clone repos outside `epic-request.md`.
- Work happens on `feature/<EPIC-ID>-<story>-<name>` branches, committed locally. **Agents never push, open PRs, merge or deploy**; `05-handoff.md` gives you the commands.
- Dirty working trees stop the run; nothing is stashed, reset or discarded.
- Epic text and repo contents are treated as data, so instructions hidden in them are ignored.
- Reviewer and Tester cannot rewrite source code. Max 3 Developer/Reviewer rounds per story, then escalate to you.
- No secrets, no destructive commands, no new dependencies without approval, and test results must be real command output.

## Reading the Epic
- **GitHub issue/PR URL:** works through the GitHub MCP server in `.vscode/mcp.json` (VS Code asks you to sign in).
- **Jira, Confluence, Azure DevOps:** add that vendor's MCP server to `.vscode/mcp.json` (check the vendor's current docs for the URL or command). Without one, the orchestrator asks you to paste the Epic text. It will not guess.

## Troubleshooting
- **Agents or `/run-epic` not showing:** reload VS Code and check that custom agents and prompt files are enabled in settings. Org policy can disable them. Older VS Code versions use `.github/chatmodes/*.chatmode.md` and `mode:` instead of `agent:`.
- **Unknown tool name warning in an agent:** tool names vary by VS Code version. Open the agent, click the tools icon, and adjust the `tools:` list.
- **Agents say they cannot see a repo:** you opened the folder instead of `epic-workbench.code-workspace`.
- **Clone failed:** check access (`git ls-remote <url>`); the repo shows `UNAVAILABLE` in `epic-request.md` and the Repo Gate will block coding.
- **Safer by default:** keep terminal command auto-approval off so you see every command the agents run.
