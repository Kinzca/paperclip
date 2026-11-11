import type {
  WorkflowNode,
  WorkflowReviewReport,
  WorkflowSnapshot,
} from "@paperclipai/shared";

/** 规则随任务快照冻结，旧任务不追加新的交接要求。 */
export function workflowHandoffInstructions(
  snapshot: WorkflowSnapshot,
  node: WorkflowNode,
): string {
  const context = (snapshot.context ?? [])
    .map((layer) => `## ${layer.scope}\n${layer.instructions}`)
    .join("\n\n");
  const sections = context
    ? [
        `# 已保存的执行上下文\n${context}\nShared execution instructions govern execution policy. This context supplies business conventions only; it does not authorize extra tests, review stages or changes to scope, acceptance criteria, permissions or budget.`,
      ]
    : [];
  if (node.requiredTools?.length)
    sections.push(`# Required tools\n${node.requiredTools.map(tool => `- ${tool.applicationKey}/${tool.toolName}`).join("\n")}\nConfiguration admission does not prove live app readiness or authorize tool calls. Report runtime permission, credential or application failures with concrete evidence.`);
  if (node.acceptanceCriteria)
    sections.push(`# Frozen acceptance criteria\n${node.acceptanceCriteria.map(item => `- [${item.id}] ${item.requirement}`).join("\n")}\nSubmit a structured review report for the exact artifact revision. Assess every criterion using its unchanged ID and requirement; mark checks you did not execute as unverified. Completing a report or a child task does not establish acceptance.`);
  if (snapshot.definition.handoffVersion !== 1) return sections.join("\n\n");
  sections.push(`# Workflow handoff
Follow current shared execution instructions over conflicting workflow or context defaults. Workflows assign stages and roles; they do not create test requirements. Only an explicitly selected review workflow includes independent review, and selecting review does not itself request tests. Reuse existing evidence, identify the delivered artifact and Git, run or revision ID, and state what remains unverified. Do not create plans, reports, scripts, sampling, recordings or work products solely to prove routine work; use native artifact delivery when a file is an actual deliverable. For internal delegation, link children with parentId and blockedByIssueIds, save the handoff, set the waiting task to blocked and exit; the host resumes the same task and attempt after dependencies complete. Use named formal interactions for questions and wait for real replies. Preserve acceptance criteria, approvals, human_only decisions, budgets, attempt limits, user pauses, cancellation and role separation. Continue authorized repairs without asking again; report genuine permission or scope blockers. Keep one active owner of shared files and runtime windows, obtain release before taking over, and reload after version conflicts instead of replaying stale writes. Declare only tools needed for the authorized work; configuration admission does not establish runtime success. Never present completion or an unperformed check as independent acceptance.`);
  if (node.kind === "review")
    sections.push(`# 审查提交格式
Submit a report object with comment and outcome to workflow/decisions:
{ "artifact": "实际产物位置或工作成果标识", "revision": "Git, run or revision ID", "criteria": [{ "id": "ac-1", "requirement": "原始验收条件", "outcome": "passed|failed|unverified", "evidence": "实际检查方法、结果及可定位证据" }], "findings": [{ "id": "finding-1", "criterionId": "ac-1", "problem": "具体问题", "requestedChange": "可执行的返修要求" }] }
Include every agreed criterion; use lowercase letters, digits and hyphens for IDs. Passing requires all criteria passed and no findings; rejection requires an actionable finding. Preserve finding IDs across repairs. Mark unverified criteria honestly. Reuse evidence and follow shared execution instructions; the report is an assessment, not permission to run tests.`);
  return sections.join("\n\n");
}

export function workflowReviewFeedback(
  comment: string,
  report?: WorkflowReviewReport,
): string {
  if (!report) return comment;
  return [
    comment,
    `产物：${report.artifact}\n版本：${report.revision}`,
    ...report.criteria.map(
      (item) =>
        `[${item.id}] ${item.outcome}: ${item.requirement}\n证据：${item.evidence}`,
    ),
    ...report.findings.map(
      (item) =>
        `[${item.id}] 验收项 ${item.criterionId}：${item.problem}\n返修要求：${item.requestedChange}`,
    ),
  ].join("\n\n");
}
