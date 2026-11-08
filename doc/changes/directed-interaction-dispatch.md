# Directed pending interaction dispatch

An agent addressed by a pending issue-thread interaction can answer on the source
issue without owning that issue. Previously these runs were cancelled as
`issue_assignee_changed` because the interaction classifier required a comment ID.

Admission, queued claim, scheduled resource retries and the final provider handoff
now re-read the interaction by company, issue, ID and addressee, require pending
status, and use the canonical resolver audience evaluator. A withdrawn, resolved,
retargeted, human-only or governed tool-action interaction cannot authorize a run.
The final handoff holds the interaction's share lock through synchronous dispatch.
Resource retries retain the interaction origin even when their wake reason changes.

Answering may proceed while implementation dependencies remain unfinished. It does
not take checkout/execution ownership, change the assignee, bypass a subtree pause,
raise any resource limit, or change mutation/answer authorization. Existing resolved
interaction continuations still require their original task ownership and lease.

Regression coverage includes real wake/queue/provider dispatch with unresolved
dependencies, withdrawal between claim and dispatch, resolver/isolation denials,
resource retry revalidation, and preservation of ownership, pause and budget gates.
No database migration is required.

After repair, a Board caller can redeliver an existing still-pending interaction
through the normal agent wakeup API using reason `interaction_pending` and payload
`{ issueId, interactionId, mutation: "interaction" }`. Current stored audience is
checked again. This preserves the original interaction and task; it neither answers
the question nor revives an ended interaction. Avoid duplicate redelivery when the
recipient already has an active run.
