import { agents, toolApplications, type Db } from "@paperclipai/db";
import { and, eq, inArray } from "drizzle-orm";
import { isToolConnectionAttentionHealth, type WorkflowNode } from "@paperclipai/shared";
import { toolAccessService } from "../tool-access.js";
import { localMcpToolReadiness } from "./local-mcp-readiness.js";

/** Configuration admission only: never invokes tools, resolves secrets or grants access. */
export async function workflowToolReadiness(
  db: Db,
  companyId: string,
  agentId: string,
  requirements: NonNullable<WorkflowNode["requiredTools"]>,
): Promise<string[]> {
  if (!requirements.length) return [];
  const missing: string[] = [];
  const local = requirements.filter(item => item.transport === "local_mcp");
  if (local.length) {
    const [agent] = await db.select({ adapterType: agents.adapterType, adapterConfig: agents.adapterConfig })
      .from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
    for (const item of local) {
      const reason = agent ? localMcpToolReadiness(agent.adapterType, agent.adapterConfig, item.applicationKey, item.toolName)
        : "agent is not available in this company";
      if (reason) missing.push(`${item.applicationKey}/${item.toolName}: ${reason}`);
    }
  }
  const profile = requirements.filter(item => item.transport !== "local_mcp");
  if (!profile.length) return missing;
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
      inArray(toolApplications.applicationKey, profile.map(item => item.applicationKey)),
    ));
  const applicationKeys = new Map(applications.map(application => [application.id, application.key]));
  const usableConnections = new Set(
    effective.installedConnections
      .filter(connection => connection.status === "active" && connection.enabled &&
        (connection.credentialPolicy === "per_user" || !isToolConnectionAttentionHealth(connection.healthStatus)))
      .map(connection => connection.id),
  );
  return [...missing, ...profile
    .filter(requirement => !effective.allowedTools.some(tool =>
      tool.entryKind === "tool" &&
      tool.applicationId &&
      applicationKeys.get(tool.applicationId) === requirement.applicationKey &&
      tool.toolName === requirement.toolName &&
      usableConnections.has(tool.connectionId),
    ))
    .map(requirement => `${requirement.applicationKey}/${requirement.toolName}`)];
}
