# Native task workflows

Paperclip owns a bounded execute / verify / review / repair loop. Adapters such as
`codex_local` provide tools, credentials and the inner coding loop; the server owns
dependencies, retained evidence, recovery and stopping rules.

## Configure once

Open **Task workflows** in the sidebar. Company/project defaults apply automatically
to newly assigned standard root tasks, including initially unassigned tasks at
first assignment. Existing assigned tasks are not retrofitted. Platform defaults
enable `standard`: execute → retain a successful run receipt → independently
review, with three attempts per node, 60 active minutes and two concurrent stages.
Native company budgets remain enforced; an additional workflow cost cap is optional.

The board page is `/:companyPrefix/workflows` (for example, `/AIG/workflows`).
The bare `/workflows` URL redirects to the selected company. Keep this root in
`ui/src/lib/company-routes.ts` and the unprefixed redirect table in `ui/src/App.tsx`
so sidebar navigation retains the company prefix.

The overview shows the saved workflow, parallel stages, effective execution limits
and their sources. **Edit rules** previews changes before saving; clearing a field
restores inheritance. Cost input uses USD and is stored as integer cents. Unsaved
edits stay in the current application's memory, scoped to account and company,
when navigating away; they are not an on-disk draft or a database write.

**Workflow revisions** separates execution-instruction editing, baseline selection
and evidence review. Verification gates remain fixed. Select 3–10 successful tasks
with distinct frozen objectives; the picker respects root-task visibility and the
candidate's exact baseline version. Starting regressions explicitly creates real
agent tasks. Saving a draft or browsing candidates does not start execution.
Unsaved candidate edits block regression and publication until saved as a new
revision. Publication retains the existing evidence and human-approval gates.

For AIGameStudio, choose **Game development** once at company scope. It requires a
run receipt, attachment and work product, parallel code review/playtesting, then
human acceptance. Normal agent roles supply bindings. Personnel reporting remains
unchanged: the dependency graph describes work rather than management. A missing
independent reviewer becomes work for the responsible human. Paused agents require
intervention; this feature does not activate agents or their periodic heartbeats.

Resolution follows platform → company → project → task. A child may tighten
attempt/time/concurrency/cost ceilings but cannot lift an ancestor's limit or
enable a disabled ancestor. Clearing an override restores inheritance. Agents may
narrow limits but cannot disable their workflow or replace its template.

Automatic admission requires a responsible human identity. Legacy/internal tasks
without one retain the native lifecycle; explicitly requested workflow trials
without an owner are rejected. Restore inactive membership before human stages
can be dispatched.

The automatic lifecycle applies to manual standard roots. Child tasks, conversations,
harness tests, nonmanual origins (including routines/imports), and planning/ask work
retain their existing lifecycle. Board-authored explicit native execution policies
retain the existing stages/monitors engine. An agent cannot supply a separate root
policy to bypass inherited workflows. Experimental Pipelines continues coordinating
business cases and routines; it is not replaced or recursively wrapped.

## Execution and evidence

The parent is human-owned coordination work. Nodes are ordinary single-assignee
child tasks using native checkout, identity, budgets, workspaces, privacy and
cancellation. Bindings remain company-scoped; implementers cannot review their own
output, including contributions made through delegated subtasks. Role reviewers
are resolved again before dispatch when delegation reveals a conflict; another
independent role member or the responsible human takes over, with an audit record.
A conflicting explicitly pinned reviewer stops for intervention. The snapshot freezes
objective, initial plan, template, binding rules, policy
versions and ceilings. Cancel a workflow before changing its objective/owner/project.
New defaults and published revisions apply to future admissions.

Ready nodes fan out within the ceiling; joins wait for every dependency. Checks
inspect every task input and native workspace-finalization barriers protect readers.
Explicit failure edges create fresh repair task identities, invalidate descendants
and preserve attempt history. Review verdicts require the current participant,
node, attempt and workflow version. Successful agent verdicts wait for process and
workspace settlement. Stale/superseded decisions return 409.

Database work signals and committed task/run events drive the worker. Startup
reconciliation, stable wake keys and durable attempts prevent duplicate node tasks.
Deadlines/check leases schedule timed wakeups without periodic idle agent heartbeats.
Pause uses native tree holds, cancels unclaimed wakes and retains live-run cancellation
in an outbox. Execution/write boundaries reject stopped/expired/superseded nodes.
Resume preserves ceilings. Exhausted retries/time/cost, unavailable tools or changed
assignments produce a human wait. Cancellation is final; exhausted ceilings require
a new authorized task.

Reported costs include delegated descendants. Unpriced usage stops cost-capped
workflows. This is a reported-usage stop, not a prepaid reservation: in-flight work
and late receipts can exceed it. Native company budget enforcement stays independent.

A successful process receipt is **not** proof that tests passed. Evidence gates
inspect server-owned heartbeat, attachment and work-product records. Independent
review must exercise the objective with real tools. Task details retain results
and attempt evidence. The game template additionally gates on retained deliverables.

Operator-authored command checks declare executable, argv, timeout and `retrySafe`.
Host commands are off by default. They require platform `allowHostCommands: true`,
native execution mode `any`, and an active `local_fs` execution workspace. There is
no managed/remote-to-host fallback. Only the board may introduce command recipes.
The environment is restricted; results retain exit status, timeout and redacted
output excerpts. Use managed tools for authenticated checks, rather than secrets
in argv. Host-process cancellation is local to the owning server process and is
intended for single-host deployments. Expired leases repair evidence/retry-safe
checks; ambiguous non-idempotent commands require human investigation and are not
blindly replayed after a crash.

## Controlled improvement

Agents or operators propose immutable drafts with a rationale. Baseline acceptance
gates, instructions, check definitions and dependencies cannot be weakened.
Candidates can improve execution instructions, add checks or change coordination.

Select at least three successful baseline runs with distinct frozen objectives,
then **Run candidate regressions**. Idempotent candidate tasks execute and are
evaluated automatically from persisted outcomes. Manual pairing is also available.
Renaming a scenario does not increase coverage. Evaluation requires successful
baseline/candidate gates without extra repair attempts. Publication requires three
passing objectives, no failing scenario, an unchanged published baseline and explicit
board approval. Running snapshots remain pinned. This does not train model weights,
rewrite rules autonomously or establish scientific generalization from three cases.

## API

All paths are beneath `/api`. Task reads enforce company membership and native
privacy. Child grants expose only that node, not siblings or internal lease and
cancellation data. Mutations are audited; policies/controls use optimistic versions.

| Method | Path | Purpose |
| --- | --- | --- |
| GET/PUT | `/instance/workflows/defaults` | Instance administrator defaults |
| GET | `/companies/:companyId/workflows` | Templates, revisions and visible policies |
| GET | `/companies/:companyId/workflows/revisions/:revisionId/baselines` | Board-only, searchable eligible task metadata; bounded `limit`/`offset`, no execution |
| PUT | `/companies/:companyId/workflows/policy` | Board scope overrides |
| POST | `/companies/:companyId/workflows/revisions` | Propose draft |
| GET/POST | `/companies/:companyId/workflows/revisions/:revisionId/evaluations` | Inspect/evaluate paired runs |
| POST | `/companies/:companyId/workflows/revisions/:revisionId/trials` | Replay `baselineRunIds` against draft |
| POST | `/companies/:companyId/workflows/revisions/:revisionId/publish` | Board publication gate |
| GET | `/issues/:issueId/workflow` | Snapshot, graph and attempt evidence |
| POST | `/issues/:issueId/workflow/control` | Board pause/resume/retry/cancel |
| POST | `/issues/:issueId/workflow/decisions` | Current participant verdict |

Controls require `action`, `reason`, `expectedVersion`. Decisions require `nodeId`,
`attempt`, `expectedVersion`, `outcome: passed|failed`, `comment`. Explicit board
trial creation may use normal task creation with
`workflow: { templateKey: "standard", revision: 2 }`. Ordinary tasks need no field.

## Deploy and verify

Deploy this source revision and apply its additive migration through the normal
Paperclip deployment process. A separate packaged Windows runtime does not acquire
source changes merely because a branch was pushed. Never point test helpers at the
running studio database.

```sh
pnpm --filter @paperclipai/shared exec vitest run src/workflows.test.ts
pnpm --filter @paperclipai/server exec vitest run src/services/workflows/engine.integration.test.ts
pnpm --filter @paperclipai/ui exec vitest run src/lib/company-routes.test.ts src/App.workflows-routing.test.tsx
pnpm check:token-gates
```

Integration tests use isolated embedded PostgreSQL, real issue services/migrations
and stubbed model wakeups. They prove orchestration and authorization, not a live
paid model invocation or a real game-engine playtest.
