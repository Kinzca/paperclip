import { and, eq, inArray, sql } from "drizzle-orm";
import { issues, workflowRuns, type Db } from "@paperclipai/db";
import { forbidden } from "../../errors.js";

/** Recheck at execution/write boundaries so queued or superseded work cannot run. */
export async function assertWorkflowIssueExecutionAllowed(
  db: Pick<Db, "select">,
  companyId: string,
  issueId: string,
) {
  const [root] = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.companyId, companyId),
        eq(workflowRuns.issueId, issueId),
        inArray(workflowRuns.status, [
          "pending",
          "running",
          "paused",
          "waiting_human",
        ]),
      ),
    )
    .limit(1);
  if (root)
    throw forbidden(
      "Workflow roots coordinate work; execute the assigned node task instead",
      { code: "workflow_root_not_executable" },
    );
  const [node] = await db
    .select({ id: issues.id, originId: issues.originId })
    .from(issues)
    .where(
      and(
        eq(issues.companyId, companyId),
        eq(issues.originKind, "workflow_node"),
        sql`${issues.id} in (with recursive ancestry as (
      select id, parent_id from issues where id = ${issueId} and company_id = ${companyId}
      union select parent.id, parent.parent_id from issues parent join ancestry child on parent.id = child.parent_id where parent.company_id = ${companyId}
    ) select id from ancestry)`,
      ),
    )
    .limit(1);
  if (!node?.originId) return;
  const [run] = await db
    .select({
      status: workflowRuns.status,
      nodes: workflowRuns.nodes,
      deadlineAt: workflowRuns.deadlineAt,
      runtime: workflowRuns.runtime,
    })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.companyId, companyId),
        eq(workflowRuns.id, node.originId),
      ),
    );
  if (
    !run ||
    run.status !== "running" ||
    (run.deadlineAt && !run.runtime.humanWaitStartedAt &&
      run.deadlineAt.getTime() <= Date.now()) ||
    !Object.values(run.nodes).some(
      (state) => state.issueId === node.id && state.status === "running",
    )
  ) {
    throw forbidden("Workflow node is stopped, expired or superseded", {
      code: "workflow_node_inactive",
    });
  }
}
