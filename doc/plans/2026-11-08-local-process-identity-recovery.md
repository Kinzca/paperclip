# Local process identity during recovery

Terminal conversation runs can retain a PID and process group ID after the
original provider exits. A later process that reuses those numbers must not
keep the historical task blocked or be stopped to satisfy reconciliation.

Conversation admission and operator reconciliation now share a read-only
identity probe. A live PID with a positively later OS start time belongs to a
replacement generation. An earlier OS start remains conservative: legacy
capture may have fallen back to post-spawn wall time or a coarser timestamp.
On POSIX, when the recorded group ID equals that original PID,
PID reuse also establishes that the old group ended: the kernel reserves the
leader's PID for the group's lifetime. Apple XNU's
[PID allocation loop](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_fork.c)
checks process, process-group and session identifiers before reuse.

A missing leader does **not** establish group termination. A surviving group,
a different recorded group ID, missing/unreadable start identity, or inaccessible
process keeps the existing conservative hold. Environment lease and remote stop
receipt checks remain independent. Windows does not use the POSIX group reuse
inference.

The probe only uses signal zero and reads start identity. It never terminates a
process, mutates historical run fields, clears leases, changes approval policy,
or creates replacement tasks. There is no schema migration. Existing deferred
deliveries resume through their normal admission path when the stale ownership
hold no longer applies; no historical tool execution is replayed by this change.

Regression coverage includes reused leader PID/PGID, live matching providers,
surviving children, different groups, inaccessible or missing identities, and
fully exited groups. An isolated PostgreSQL integration test uses a disposable
replacement Node process to exercise both admission and reconciliation, verifies
that it remains alive and source rows remain present, then verifies an active
environment lease still blocks recovery. It never targets the live instance.
