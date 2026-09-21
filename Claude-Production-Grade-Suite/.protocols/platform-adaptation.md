# Platform Adaptation — capability mapping for non-reference hosts

The production-grade skills are written in the tool vocabulary of their reference
platform (Claude Code). The skills themselves are Agent Skills standard `SKILL.md`
files and run on any host that reads them — Codex, OpenCode, Pi, and others — but
some tool names they use will not exist in your toolset.

**If every tool named in this file exists in your environment, this file is inert —
stop reading and follow the skills as written.**

Otherwise, apply the mappings below. They preserve the system's guarantees while
swapping the mechanism. Branch on what you can observe (does this tool exist for
me?), never on what platform you believe you are on.

## The invariants (what must survive on every host)

1. **Structured choices.** The user selects from predefined options; never an
   open-ended question. Recommended option first, "Chat about this" last.
2. **Fresh context per work unit.** Parallel or sequential, each dispatched unit
   starts from disk artifacts, not from another agent's conversation.
3. **Receipts and gates.** Every unit writes its JSON receipt; gates verify
   artifacts on disk before opening. No receipt = not done.
4. **Re-anchoring.** Specs are re-read FROM DISK at phase transitions.
5. **Oracle discipline.** No oracle, no loop; the fast oracle stays green after
   every source edit; producers never weaken their own checks.

Only the mechanisms below vary.

## Preamble lines (`` !`command` ``)

Lines beginning with `` !` `` in SKILL.md files are preamble shell commands that the
reference host executes automatically and splices into the skill. If your host did
not execute them (you can see them as literal text), run those commands yourself
with your shell tool before proceeding — they only `cat` protocol/config files and
probe project state, and every one degrades to empty output when its target is
missing.

## Tool mappings

| Skill says | You have | Do this |
|---|---|---|
| `AskUserQuestion(...)` | A native structured-question / multiple-choice tool | Use it with the same options, order, and labels. |
| `AskUserQuestion(...)` | No such tool | Print the question and options as a numbered list (recommended first, "Chat about this" last) and stop for the user's reply. Never rephrase a choice as an open-ended question. |
| `Agent(prompt=..., run_in_background=True)` / `Skill(skill=...)` dispatch | A subagent/task tool that runs a prompt in a fresh context | Use it; pass the same prompt; run units in parallel where the host allows. |
| `Agent(...)` dispatch | No subagent tool, but a shell + a headless mode of your own host binary | Spawn a fresh non-interactive run of the host for each unit (a fresh process is a fresh context). Point the child at the skill file by absolute path, tell it where to write outputs and its receipt (files, not stdout), and set `PRODUCTION_GRADE_CHILD=1` in its environment so ambient extensions stay quiet. Example shape on a host named `pi`: `PRODUCTION_GRADE_CHILD=1 pi --no-session -p "Read <repo>/skills/software-engineer/SKILL.md and follow it. Task: ... Write receipt to <workspace>/.orchestrator/receipts/T3a-software-engineer.json"`. |
| `Agent(...)` dispatch | Neither | Execute the units inline, one at a time, in dependency order. Before each unit, re-read its upstream artifacts from disk (re-anchoring) and adopt only that unit's role; write its receipt before starting the next. Slower, same guarantees. |
| `TeamCreate` / `TaskCreate` / `TaskUpdate` / `TaskList` | Native task/team tools | Use them. |
| `TeamCreate` / `TaskCreate` / `TaskUpdate` / `TaskList` | No task tools | Keep the task graph as a markdown checklist at `Claude-Production-Grade-Suite/.orchestrator/tasks.md` (task id, description, blocked-by, status). Update it at every state change; it is the pipeline's task state. `TeamDelete` becomes a no-op. |
| `isolation="worktree"` | Git worktree support (native or via `git worktree` in the shell) | Use it for parallel units that write files. |
| `isolation="worktree"` | No worktrees | Run file-writing units sequentially in the shared directory (announce this in the settings printout), or partition write paths so no two concurrent units touch the same directory. |
| `WebSearch` / `WebFetch` | Host web tools | Use them. |
| `WebSearch` / `WebFetch` | None | Skip the plugin auto-update check silently. For freshness-protocol lookups (model IDs, versions, pricing, CVEs), do not guess from training data: mark the value `UNVERIFIED (no web access)` in the artifact and receipt, and prefer whatever the project already pins (lockfiles, existing configs). |
| `Glob` / `Grep` / `Read` / `Write` | Host file tools | Use the host's equivalents; shell `find`/`rg`/`cat` are acceptable fallbacks (tool-efficiency protocol still applies: batch independent reads). |

## Hooks (session-guard, oracle-gate)

The reference platform enforces two ambient hooks from `hooks/hooks.json`:
a session-start project guard and a PostToolUse **oracle gate** that runs the fast
oracle after every source edit. If your host runs no such hooks, the rule does not
change — only the enforcement does: after every source-file edit, run
`Claude-Production-Grade-Suite/.orchestrator/oracle.sh` yourself and fix red before
the next edit (loop-protocol Rule 7). The hook is enforcement, not the rule.

## Auto-update

The orchestrator's auto-update check reads `~/.claude/plugins/installed_plugins.json`.
If that file does not exist, you are not running a Claude Code marketplace install:
skip the check silently and rely on the host's own update flow (`git pull` for a
clone, `pi update`, `codex plugin update`, reinstall — see the INSTALL-*.md for your
host).

## Command spelling

The docs write `/production-grade`. Hosts spell invocation differently
(`$production-grade` where skills are `$name`-invoked; `/skill:production-grade`
where skills are namespaced; or plain natural language — "build me X, production
grade"). When you print instructions that name a command, use the spelling that is
valid on the host you are running in.
