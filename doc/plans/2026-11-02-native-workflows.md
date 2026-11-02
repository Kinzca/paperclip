# Native inherited workflows

## Objective

Make bounded execute/verify/rework workflows a Paperclip host capability. New
ordinary execution tasks inherit versioned defaults; companies and projects do
not need a separate orchestrator or a newly written prompt for each task.

## Existing behavior and constraints

- Preserve the existing single-assignee issue, atomic checkout, review/approval,
  company/privacy, budget, pause, and activity contracts.
- Reuse normal issues for agent work and native execution services for checks.
- Keep organization reporting independent of the execution dependency graph.
- Preserve the local checkout's existing Windows installer modifications.
- Do not migrate or start the user's production instance as part of development.

## Implementation

1. Shared validated contracts: versioned DAG templates, role bindings, immutable
   task snapshots, bounded retry/timeout/cost limits, evidence and decisions.
2. Company-scoped persistence: template revisions, inherited scope policies,
   durable run/node state and evaluation/proposal records. Generate migrations.
3. Host orchestration: automatic task admission, dependency fan-out/fan-in,
   independent verification, explicit repair edges, event-driven advancement,
   startup reconciliation, pause/resume/cancel, and bounded human escalation.
4. Verification: retain command results/artifact evidence against the exact node
   attempt. Never accept a model's claim as an objective check result. Do not run
   arbitrary agent-authored shell commands on the host.
5. Reusable templates and improvement: ship a generic default and a game template,
   resolve platform/company/project/task settings without relaxing ancestor
   ceilings; compare candidate revisions on recorded regression trials before
   controlled publication. Existing runs retain their original snapshot.
6. API/UI: authorized configuration and publication, inspectable task graph,
   evidence, current blockers and intervention controls. Keep token-only styling.
7. Validation: graph and boundary tests, transactional/restart/rework/privacy
   tests, typecheck, Vitest, build, token gates. Push only this feature's files to
   a dedicated codex/ branch; fill the repository PR template if opening a PR.

## Acceptance journeys

- Create a new assigned standard task: resolve inherited defaults, materialize
  its workflow once, and dispatch only ready nodes.
- A failed objective check reaches the repair owner and is rerun on a new
  attempt; independent review cannot be performed by the executor.
- Parallel branches join only after all required dependencies pass.
- Repeated failure, deadline, missing access or budget exhaustion stops automatic
  work and leaves an explicit actionable human wait.
- Process restart resumes committed work without duplicate node tasks or replay
  of an ambiguous non-idempotent action.
- Pausing a parent stops its workflow; cancellation prevents stale events from
  advancing it. Company/private task boundaries hold at reads and writes.
- Update a template: existing snapshots stay unchanged; candidate changes are
  evaluated against a baseline and do not auto-publish themselves.

## Delivery

Implementation and operational documentation in the repository; checks and their
limitations reported honestly; a remote feature branch with commit/PR links.

## Verification (2026-11-02)

Passed on Node 24.22.2:

- Shared workflow contracts: 7 tests.
- Native workflow database integration: 15 tests, using fresh migrations and
  isolated embedded PostgreSQL. Covers admission/assignment, independent and
  delegated-contributor review, parallel joins, repair history, pause/resume,
  parent blocking/cancellation, ceilings, restart recovery, real command exit/
  timeout/environment isolation, and three-case candidate replay/publication.
  Terminal evaluation recovery is verified across the simulated commit/crash gap.
- Existing task service regression: 139 tests.
- Existing run preparation/cancellation boundaries: 9 tests.
- Portable adapter utility regression: 142 passed, 6 skipped.
- Direct TypeScript checks for shared, db, adapter-utils, server and ui.
- UI production build. Existing bundle-size/dynamic-import warnings remain.
- Git whitespace checks. A small pre-existing attribution-label type mismatch in
  the touched task detail component was corrected while preserving localization.

Full repository checks were attempted and are **not all green**:

- `pnpm -r typecheck`: unchanged Runner generated ACPX-profile attestation drift.
- `pnpm build`: unchanged Runner protocol manifest is stale.
- `pnpm test:run`: the stable runner uses `spawnSync("pnpm")`, which fails with
  ENOENT in this Windows environment. Relevant suites were invoked directly.
- Two additional adapter process-session suites depend on `/bin/sh` and
  `/bin/bash` fixtures unavailable as native Windows executables; the broader
  five-suite run had 155 failures, 196 passes and 6 skips. The three portable
  adapter suites above passed separately.
- `pnpm check:token-gates`: 107 existing violations across 26 unchanged files.
  No changed file or new workflow UI file appears in the violation list.

The packaged studio runtime and its data were not migrated or restarted. No paid
model/game-engine journey was run; model wakeups in integration tests are stubbed.
Deploy the source revision and apply its migration before enabling these controls
in the running studio. Existing installer/overlay modifications remain outside
this feature commit. The implementation preserves native budgets and governed
action approvals; host-command checks require a separate explicit operator opt-in.
