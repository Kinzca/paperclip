# Shared Agent Instructions

Operators can maintain reusable instructions without editing every agent or
depending on `AGENTS.md` discovery in a particular filesystem directory.

In **Settings → General**, use **Global agent instructions** for guidance shared
by every organization in the instance. Use **Organization agent instructions**
for additional guidance scoped to the selected organization. Both accept up to
32,000 characters. Save an empty value to remove that layer.

The **Agent run rules** section groups the global layer and the selected
organization's additions, with separate save actions. Its read-only preview
shows saved shared rules with their sources; it excludes unsaved drafts and
individual role instructions.

Drafts are scoped to the account and organization and retained in this browser
tab across navigation and reloads using session storage, with an in-memory
fallback when storage is unavailable. Closing the tab ends that persistence.
Server refreshes update clean fields but preserve dirty drafts. A conflicting
external update is shown for comparison before the operator keeps or discards
their draft. Organization name and description drafts also survive independent
rule saves. The global layer is read-only for non-administrators.

Every agent uses the current configuration on its next run, including newly
hired agents, scheduled tasks, chat replies, and retries. Running provider turns
are not interrupted. Global, organization, and existing role instructions are
combined; organizations do not remove the global layer. A changed or cleared
effective shared instruction set invalidates the previous session configuration
so stale instructions do not survive through a reused session. Native compact
continuations also carry the current shared guidance.

Only instance administrators can edit the global layer. Organization settings
use the existing board access checks; agent-authorized branding edits cannot
change organization instructions. Instructions do not alter authorization,
approvals, company isolation, or budget enforcement. Changes are recorded in
the activity log without copying instruction text into the audit details.

## API

- `GET /api/instance/settings/general` reads `agentInstructions` with the other
  general settings. `PATCH` on that path updates the global layer.
- `GET /api/companies/:companyId` reads the organization's `agentInstructions`.
  `PATCH /api/companies/:companyId` updates it in board context.
- Missing or empty instructions mean that layer contributes no guidance.

The global layer is stored in `instance_settings.general.agentInstructions`.
Migration `0335` adds `companies.agent_instructions`, initially empty, for the
organization layer. Existing agents and their instruction bundles are preserved.

## Adapter delivery

Core resolves both layers from the database at run preparation, overwriting any
caller-provided value. Local model adapters and native runners receive the
shared instruction section through the server-owned wake prompt. HTTP adapters
receive `sharedAgentInstructions` alongside their normal context. Process
adapters receive `PAPERCLIP_SHARED_AGENT_INSTRUCTIONS_FILE`, a run-scoped UTF-8
Markdown file deleted after the child exits; a custom process must consume that
file. Third-party adapters receive `context.paperclipWake.sharedAgentInstructions`
and must render it when constructing their provider prompt.

Empty configuration preserves existing prompt behavior. This feature does not
copy a person's Codex profile, credentials, or installed skills into organizations.
