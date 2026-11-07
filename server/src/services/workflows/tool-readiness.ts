import { toolApplications, type Db } from "@paperclipai/db";
import { and, eq, inArray } from "drizzle-orm";
import { isToolConnectionAttentionHealth, type WorkflowNode } from "@paperclipai/shared";
import { toolAccessService } from "../tool-access.js";

/** Configuration admission only: never invokes tools, resolves secrets or grants access. */
export async function workflowToolReadiness(
  db: Db,
  companyId: string,
  agentId: string,
  requirements: NonNullable<WorkflowNode["requiredTools"]>,
): Promise<string[]> {
  if (!requirements.length) return [];
  const effective = await toolAccessService(db).getEffectiveProfilesForAgent(
    companyId,
    agentId,
  );
  const applications = await db
    .select({ id: toolApplications.id, key: toolApplications.applicationKey })
    .from(toolApplications)
    .where(and(
      eq(toolApplications.companyId, companyId),
      eq(toolApplications.status, "active"),
      inArray(toolApplications.applicationKey, requirements.map(item => item.applicationKey)),
    ));
  const applicationKeys = new Map(applications.map(application => [application.id, application.key]));
  const usableConnections = new Set(
    effective.installedConnections
      .filter(connection => connection.status === "active" && connection.enabled &&
        (connection.credentialPolicy === "per_user" || !isToolConnectionAttentionHealth(connection.healthStatus)))
      .map(connection => connection.id),
  );
  return requirements
    .filter(requirement => !effective.allowedTools.some(tool =>
      tool.entryKind === "tool" &&
      tool.applicationId &&
      applicationKeys.get(tool.applicationId) === requirement.applicationKey &&
      tool.toolName === requirement.toolName &&
      usableConnections.has(tool.connectionId),
    ))
    .map(requirement => `${requirement.applicationKey}/${requirement.toolName}`);
}
