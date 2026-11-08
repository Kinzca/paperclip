import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { issueThreadInteractions, type Db } from "@paperclipai/db";
import { issueThreadInteractionAttentionAgentAllowed } from "./issue-thread-interaction-resolution.js";

const pendingWakeSchema = z.object({
  source: z.literal("issue.interaction.created"),
  interactionId: z.string().uuid(),
});

export function isPendingInteractionWakeContext(context: Record<string, unknown>) {
  // Resource retries replace wakeReason but retain the server-authored origin.
  return context.wakeReason === "interaction_pending" || context.source === "issue.interaction.created";
}

/** A responder may answer a current addressed question without becoming the issue owner.
 * Re-read persisted authority at every admission/retry boundary; wake context is only a locator.
 * This does not exempt subtree pauses or authorize implementation mutations.
 */
export async function isVerifiedPendingInteractionWake(db: Db, input: {
  companyId: string;
  issueId: string;
  agentId: string;
  contextSnapshot: Record<string, unknown>;
}) {
  const context = pendingWakeSchema.safeParse(input.contextSnapshot);
  if (!context.success) return false;
  const [interaction] = await db.select().from(issueThreadInteractions).where(and(
    eq(issueThreadInteractions.id, context.data.interactionId),
    eq(issueThreadInteractions.companyId, input.companyId),
    eq(issueThreadInteractions.issueId, input.issueId),
    eq(issueThreadInteractions.addresseeAgentId, input.agentId),
    eq(issueThreadInteractions.status, "pending"),
  )).for("share");
  if (!interaction) return false;
  return issueThreadInteractionAttentionAgentAllowed({
    agentId: input.agentId,
    interaction,
    governedAction: interaction.kind === "request_confirmation"
      && "toolAction" in interaction.payload && interaction.payload.toolAction !== undefined,
  });
}
