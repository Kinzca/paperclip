# Default workflows without a total time limit

## Contract

New workflows with no configured time restriction default to `timeoutMinutes: null`.
A finite integer (1–1440 minutes) remains an explicit total execution allowance.
Omission inherits the ancestor value; null cannot widen an explicit ancestor ceiling.
Persist unlimited deadlines as SQL NULL, not a distant timestamp or repeated grants.

Existing policies and frozen task snapshots retain their settings. This change
neither resumes stopped tasks nor edits company configuration. Attempt limits,
repeated-failure detection, company/agent budgets, approvals, cancellation, and
individual execution/tool timeouts remain independent controls.

## Implementation

- Shared validation, inheritance, defaults, runtime grants and API types accept null time.
- Admission, dispatch, execution gates, human wait accounting, operator pause/resume,
  verdict admission and scheduler deadline queries tolerate absent deadlines.
- Verification commands keep finite command timeouts and leases even when the parent
  workflow has no deadline. Deadline queries naturally exclude null values.
- Platform minutes can be left blank for unlimited time. Scoped policy editing has
  an explicit unlimited checkbox and keeps blank overrides distinct as inheritance.
- Generated migration 0337 only drops NOT NULL from workflow_runs.deadline_at;
  it does not change existing values, policies, paused tasks or business data.
  Apply the migration before deploying the new server. Rolling back to code that
  assumes non-null deadlines requires separately dealing with new unlimited runs.

## Verification

Targeted checks: shared policy inheritance, nullable grant handling, real isolated
PostgreSQL scheduling across seven days, pause/resume without time grants, finite
expiry and extensions, independent verdict completion in finite and unlimited modes,
human wait settlement with null, UI save/round-trip, OpenAPI and migration snapshot.
Expanded selection: 122 tests in 10 files passed (including final correction run).
Database snapshot drift and migration-safety checks passed. Service TypeScript checking and
compilation, UI typecheck/build and token gates passed.

The standard recursive typecheck/build was attempted but cannot complete on this
host because cargo is absent. Runner TypeScript checks run separately; no Rust
source changes are included. No live instance migration, deployment, company
configuration mutation or business task restart is part of this source publication.
The final full-selection results are recorded below.


Full-suite correction: five existing synthetic-executable fixtures embedded
`process.execPath` directly in shebangs, which fails when Node lives under a path
containing spaces. Reused the existing quoted `nodeFixtureScript` launcher in
Runner API (29 tests), native GitHub (9), persisted workspace source (30), SSH output
budget (3), and heartbeat GitHub launcher (10) files. All five correction runs passed;
no assertions or production authorization behavior were weakened. The UI project
passed all 734 files and 8,204 tests.

Further full-suite portability corrections apply the same existing launcher to
managed-worktree inspection (5 tests) and Codex environment probes (8 passed,
1 Windows-only skip). ACP isolation's command-string fixture now quotes both
executable and script paths; its three tests passed. All original assertions
remain unchanged. CLI: 66 files / 528 tests passed. Database: 50 files / 193 tests
passed. The first general-server run covered 886 files (871 passed, 9 failed,
6 conditional skips); its 19 failed cases are covered by correction runs. Two
additional suite setup errors require cargo (Dot Runner and native Codex Runner)
and remain an environment verification gap, alongside recursive Rust build/checks.


## Final verification record

| Selection | Final evidence |
| --- | --- |
| Feature regressions | 122 tests in 10 files passed |
| General server | All 886 files selected; 878 passed after correction runs, six conditional skips, two suite setups blocked by missing cargo |
| Serialized routes | All 158 files passed after correction runs; exact coverage checked against the native dry-run selection |
| Non-server workspaces | All 20 configured projects covered; assertion failures passed in full-file correction runs, conditional skips retained |
| UI / CLI | 734 files / 8,204 UI tests; 66 files / 528 CLI tests passed |
| Shared / database | 91 files / 933 shared tests; 50 files / 193 database tests passed |
| Service / UI / CLI / Runner TypeScript | Relevant checks passed; service compilation and UI build passed |
| Migration and UI token gates | Passed |
| Recursive typecheck and complete build | Attempted; blocked at cargo, which is not installed on this host |

Additional portability fixes keep provider bodies in properly quoted synthetic
launchers for Hermes instruction delivery (11 tests) and Daytona tar listing (24).
The heartbeat recovery file needed the same correction in two synthetic Git probes;
all 401 cases passed on its complete rerun. Multilingual routes had one socket hangup;
its complete eight-case rerun passed without a source or assertion change. Serial
routing used the repository's existing four partitions. Interrupted partitions were
continued from their exact remaining file lists; passed files were retained and
failed files rerun in full. No timeout or security assertion was relaxed. Rust suite
setup failures remain failures, not newly introduced conditional skips; full checks
are therefore not claimed green.

The standard database generator also pruned old schema snapshots according to its
five-snapshot policy. These are repository schema metadata, not instance backups.
Only reusable source, tests, docs and generated schema metadata are published.
