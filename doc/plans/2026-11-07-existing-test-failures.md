# Repair the 97 pre-existing test failures

## Scope

Follow up the execution-reliability upgrade at `513ce171`. The recorded baseline
contained 92 UI failures, three Hermes environment failures, one Codex CLI version
failure and one OpenAPI route-coverage failure. Repair the underlying behavior and
test contracts without importing instance or company configuration, credentials,
business records or live task state.

## Root causes and fixes

- **SelectField form synchronization:** Radix can emit an unencoded empty reset
  during option updates inside a form. Decoding that as a user selection cleared
  a discovered saved credential. Ignore non-option events; the encoded empty
  option remains selectable. A real keyboard interaction test verifies the empty
  callback and raw FormData value; an AgentMail component regression rejects any
  unsolicited clear after account discovery.
- **UI migration drift:** accessible labels and IDs belong to the visible shared
  trigger, while a separate hidden input retains the raw form value. Business
  tests now locate that input through the visible trigger instead of reading a
  button as an HTMLSelectElement or reading Radix's encoded input. Error-state
  assertions check actual class tokens rather than CSS variant substrings. Failed
  renderer inspections still unmount their React root.
- **Incomplete fixtures and old UI contracts:** Sidebar mocks include the current
  plugin hooks and exercise declared host navigation plus legacy slot fallback.
  Navigation expectations include Task workflows. Plugin-page tests distinguish
  the generic Back link from Wiki's existing host navigation. IssueDetail explicitly
  mocks an absent workflow instead of using an attachment-only fetch response for
  the workflow panel. API mutation and governance assertions remain intact.
- **Hermes host dependency:** successful environment tests use a disposable Python
  version executable. A Python 3.9 negative case still requires the production
  `hermes_python_old` error; the Python 3.10 minimum is unchanged. Local PATH is
  restored and the fixture removed after every use.
- **Codex prerelease versions:** recognize prerelease/build version suffixes while
  retaining the real concurrent-home isolation and CLI override checks. The test
  does not send model requests or use account credentials.
- **Missing workflow API documentation:** document all 13 mounted operations with
  their current validators, response statuses and actor restrictions. Share the
  existing platform-update validator with OpenAPI, including rejection of
  company-agent bindings in instance defaults. Keep exact route coverage; add no
  exclusions and change no runtime permissions.

## Verification and publication

Completed on macOS with Node 24 and repository-pinned pnpm 9.15.4:

| Check | Result |
| --- | --- |
| Original failing files and added regressions | Passed; all 97 baseline failures resolved |
| `pnpm -r typecheck` | Passed |
| General server CI shards | All 886 files covered; 880 passed, six conditional skips after full-file correction runs |
| Serialized route CI shards | All 158 files passed |
| Non-server CI groups | All 20 projects passed |
| UI project | 734 files, 8,202 cases passed |
| CLI project | 66 files, 528 cases passed |
| `pnpm build` | Passed with build concurrency two |
| `pnpm check:token-gates` | Passed |

Verified that server shards form a complete disjoint selection and that workspace
groups cover every project exactly once. General server coverage comprised four
`pnpm test:run -- --mode general --group general-server --shard-count 4
--shard-index <0..3>` runs. Routes used the corresponding `--mode serialized`
shards. Workspace groups used `VITEST_MAX_WORKERS=2` with
`general-workspaces-a`, `general-workspaces-b` and `general-workspaces-c`.
Tests used synthetic instances and canonical temporary paths; server Git fixtures
used a temporary test identity/default-branch configuration, not a changed user
or company configuration.

The first high-concurrency pass exposed three route import timeouts, a short
synthetic provider-startup polling failure, and a real Git filename stress timeout.
Reran all three interrupted route shards at lower concurrency and both failed
general files in full. All passed with unchanged assertions, timeouts and stress
data sizes. The Git test still covered four 40,000-filename lanes above 32 MiB and
passed within its existing 300-second limit. Retained unaffected complete shard
passes instead of rerunning them. There are no unresolved failures after these
correction runs; conditional host/service-dependent skips remain skips.

Source publication does not deploy the service or run database migrations. Only
reusable source, synthetic tests and documentation belong in the commit. No live
company workflow, external editor or browser end-to-end acceptance is claimed.
