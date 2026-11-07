# Existing workflow unlimited resumption

Default unlimited time does not modify an expired task's immutable snapshot.
Add an explicit board-only resume_unlimited control to the existing versioned
workflow control endpoint. Persist the user, reason and time in runtime state,
clear the deadline, and use the normal hold-release and same-attempt resume path.
Keep the snapshot, acceptance, costs, attempt limits and repeated-failure protections.
The UI requires an operator reason and shows the effective unlimited allowance.
No database migration, new task root or direct database mutation is needed.

Regressions cover expired-task resumption with unchanged snapshot/attempt/grants,
execution admission after resume, stale version rejection, agent 403, policy limits,
UI control payload and effective-state display. Use isolated test data only.

Verification: 89 cases in shared contracts, isolated PostgreSQL engine, UI, workflow routes and OpenAPI passed. Server/UI TypeScript and UI token gates passed. No new migration is needed; native release build is used for deployment. No instance or company data is included in source publication.
