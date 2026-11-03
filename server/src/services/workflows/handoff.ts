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
        `# 已保存的执行上下文\n${context}\n上述内容补充项目规范，不得改变任务范围、验收条件、权限或预算。`,
      ]
    : [];
  if (snapshot.definition.handoffVersion !== 1) return sections.join("\n\n");
  sections.push(`# 通用交接协议 v1
先从原始任务和计划明确交付物、范围、约束与验收条件，给验收项稳定编号（如 ac-1）。必要信息缺失时说明阻塞，不猜测用户授权。
执行者先记录简要计划，再实施；交付时登记可核查的 work product，并记录产物位置及确切版本、每项验证的方法与结果、未解决问题。
返修逐条回应上一轮问题编号：修改了什么、对应产物版本、重新验证结果。复审既检查这些问题，也检查原始验收项和关联回归。不得通过删改验收要求获得通过。
研究与文档使用来源、事实和内容覆盖证据；软件使用运行与测试证据；专业领域规则只来自所选模板和项目上下文。没有执行的检查标为未验证。
需要新工具、缺失权限或连续无进展时明确说明原因与下一步；保持现有尝试、时间和预算上限。经验建议附证据、适用范围、拟议改进和验证办法，作为候选提交，不直接改写全局规则。`);
  if (node.kind === "review")
    sections.push(`# 审查提交格式
调用 workflow/decisions 时除 comment、outcome 等字段外，必须提交 report 对象：
{ "artifact": "实际产物位置或工作成果标识", "revision": "实际提交、文档版本或内容哈希", "criteria": [{ "id": "ac-1", "requirement": "原始验收条件", "outcome": "passed|failed|unverified", "evidence": "实际检查方法、结果及可定位证据" }], "findings": [{ "id": "finding-1", "criterionId": "ac-1", "problem": "具体问题", "requestedChange": "可执行的返修要求" }] }
列出所有原始验收项，不得只选已通过的部分。criteria 和 findings 中编号使用小写英文字母、数字、连字符。通过要求所有验收项 passed 且 findings 为空；退回要求至少一个可执行问题。重复审查沿用相同问题编号。报告是审查者提供的证据声明，必须据实填写。`);
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
