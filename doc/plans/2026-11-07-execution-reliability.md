# Execution reliability upgrade

## Scope and invariants

Upgrade the reusable Paperclip control plane. No company setup, agent credentials,
business assets, task transcripts, database exports or local instance state belong
in this change. Source publication and live deployment are separate operations.
Single ownership, company isolation, atomic checkout, cancellation, approvals and
budget hard stops remain authoritative.

## Changes

1. Distinguish a bounded original-owner disposition continuation from a repair-only
   handoff. Derive this from the persisted active action, source issue, owner and
   wake policy. Preserve retry accounting and escalated board recovery contracts;
   do not loosen recovery resolution endpoint guards. Ignore another issue's action
   when preparing wake instructions.
2. Own the local stdio MCP exchange as a bounded process lifecycle. Bound protocol
   output, handle malformed messages/startup/early exit, retain the original error,
   and escalate graceful termination to forceful termination of the owned POSIX
   process group. Bound cleanup as well as the request. This does not repair tools
   invoked by an external desktop client outside Paperclip's gateway. Windows uses
   direct-child termination; descendant group behavior is POSIX-only.
3. Add optional declarative tool requirements to frozen workflow nodes. Check
   effective authorization and installed/enabled connection configuration before
   task creation and attempt consumption. Configuration failures retain a resumable
   hold. The check grants no new permissions and does not pretend static catalog
   membership proves live application readiness.
4. Add optional frozen acceptance criteria to review nodes. Require every declared
   criterion unchanged in structured verdicts; reject missing/unverified checks on
   pass. Preserve independent review and process/workspace settlement. Protect the
   baseline criteria and verification tools from optimization proposals.
5. Include absolute deadline and attempt/cost ceilings in dispatched node briefs.
   Existing durable state, explicit allowance extensions and cancellation outboxes
   remain the recovery path; no automatic limit increases are introduced.
6. Keep authenticated Dot broker intake on its native assignment lifecycle using
   the `dot_intake` origin, rather than letting a second orchestrator take away its
   assignee before admission. Keep existing authorization and budget checks. Keep
   status-card compilation/refresh (`status_card`) and summary-slot generation
   (`summary_slot`) on their generation lifecycles for the same reason, retaining
   existing write authority, revision checks and cancellation ledgers.
   Pin the damaged-session recovery fixture to its synthetic CLI so installed real
   provider dependencies cannot affect the test or receive fixture traffic.
   Workspace test repositories declare their initial branch, and synthetic Node
   launchers quote the executable path instead of relying on a space-free shebang.
   Native trust fixtures explicitly select direct-task execution; chat handoff
   tests check both workflow coordinator ownership and the frozen executor, and
   still reject attempts to bypass inherited governance. Startup mocks expose the
   existing workflow worker contract, and migration assertions include the already
   bundled background-batch migration.
7. When orphan-blocker assignment admits a workflow, retain its frozen executor
   and let the workflow worker dispatch nodes. Never enqueue legacy execution of
   the coordination root. Audit the actual coordinator and execution owner, and
   keep direct-task recovery covered separately.

## Verification

Use isolated synthetic fixtures, never the active instance database. Regressions
cover normal continuation versus escalated repair, stale/cross-issue actions,
unresponsive MCP children and descendants, protocol limits, tool configuration
holds/resumption, company isolation, and frozen review criteria. Run affected suites
first, then recursive typecheck, the full repository test command and build.
Review the exact staged file list for instance data before committing and pushing.

### Recorded verification results

- Recursive typecheck and the complete `pnpm build` passed on macOS with Node 24
  and the repository-pinned pnpm 9.15.4. Build products remain ignored; this did
  not deploy the running instance or migrate a database.
- Exercised the complete Vitest selection using the repository's CI groups and
  disjoint shards: 886 general server files, 158 serialized route files and all
  20 non-server projects. When a group stopped on a failure, continued its
  remaining selection; retained unchanged passes and reran failed files in full.
  Reduced concurrency and canonical temporary directories eliminated resource
  timeouts and macOS path-alias failures. No test timeouts or production security
  checks were relaxed.
- The new recovery/workflow/tool regressions passed. The process-recovery file
  passed all 401 cases, including workflow-owned and direct-task orphan recovery.
  Eight corrected general server files passed all 147 cases in their final
  combined rerun. The direct-task red-team file passed all 13 cases.
- The complete suite is **not green**. Compared the remaining failures against a
  separate checkout of the pre-upgrade commit
  `1f0cbda491e35c982b8cf1065d55ff608608041a`, using the same installed dependencies:
  exactly the same 97 failing test names remain, with no additional failure names
  in these comparisons. They comprise 92 UI cases across 21 files (including a
  missing `usePluginSlots` mock export), three Hermes environment cases across two
  files, one MCP isolation case whose version regex rejects an installed
  prerelease Codex CLI, and one OpenAPI coverage case that does not classify the
  existing `workflows.ts` route file. These are recorded limitations rather than
  evidence that the full repository passed. Conditional host/service-dependent
  skips remain skips; external desktop editor and live-agent acceptance were not
  performed.
- Only reusable source, synthetic tests and documentation are included. Test
  databases, comparison checkout, logs, toolchain/cache files and local instance
  or company state are excluded from the commit.

## Compatibility and limits

The 97 failures recorded above were resolved in the subsequent
[baseline-test repair](2026-11-07-existing-test-failures.md), which records the
complete follow-up coverage and correction-run results.

Optional fields live in existing JSON template snapshots; no database schema or
migration is required. Existing workflows do not acquire new gates retroactively.
Origin corrections apply to newly created internal jobs; previously admitted
workflows are not silently cancelled or rewritten. Operators retain their normal
cancel/recreate controls for an already misclassified job.
A reviewer still supplies truthful artifact revision and evidence: strings alone
cannot prove visual quality or that a particular external editor loaded that build.
Tool configuration preflight does not replace runtime identity or policy checks.
The platform retains explicit operator intervention for missing authorization or
exhausted allowance; unattended execution is bounded by its existing authorization.
