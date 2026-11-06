# Unattended workflow dependency waits

## Observed failure

CMP-5 explicitly depended on delegated QA CMP-10, itself waiting for visual CMP-9. Moving CMP-5 to blocked made the workflow stop and cancel the still-running visual worker. Descendant updates did not mark the owning workflow for reconciliation. Separately, deterministic workspace validation failures consumed three repair attempts before requiring intervention.

## Required behavior

- A task node blocked exclusively on agent-owned descendants remains running at the workflow level. Nested internal dependencies are accepted; external, cancelled, unassigned or backlog blockers still require intervention.
- Dependency completion respects native workspace finalization. Resume the same task and attempt with a fresh, durable continuation generation; retain stable wake identities and original time, cost and retry ceilings.
- Descendant changes signal the owning workflow. Startup recovery re-evaluates persisted dependencies, including completion events missed while the server was down.
- Workspace validation failures stop for configuration repair immediately instead of blind repair attempts.
- Explicit parent pause/cancel, human review, permissions, company boundaries and frozen objectives remain enforced.

## Verification

Use isolated PostgreSQL workflow integration tests, server typecheck and the relevant existing workflow/dependency suites. Then build a traceable release, back up and upgrade through the existing local-release scripts. Perform a real agent delegation that exits while the child is working and resumes after the child finishes; inspect child cancellation, attempt identity and final workflow outcome. This is a focused reliability check, not an overnight endurance claim.
