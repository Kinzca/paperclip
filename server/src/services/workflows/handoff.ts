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
  if (node.requiredTools?.length)
    sections.push(`# Required tools\n${node.requiredTools.map(tool => `- ${tool.applicationKey}/${tool.toolName}`).join("\n")}\nConfiguration admission does not prove live app readiness or authorize tool calls. Report runtime permission, credential or application failures with concrete evidence.`);
  if (node.acceptanceCriteria)
    sections.push(`# Frozen acceptance criteria\n${node.acceptanceCriteria.map(item => `- [${item.id}] ${item.requirement}`).join("\n")}\nSubmit a structured review report for the exact artifact revision. Assess every criterion using its unchanged ID and requirement; mark checks you did not execute as unverified. Completing a report or a child task does not establish acceptance.`);
  if (snapshot.definition.handoffVersion !== 1) return sections.join("\n\n");
  sections.push(`# 通用交接协议 v1
先从原始任务和计划明确交付物、范围、约束与验收条件，给验收项稳定编号（如 ac-1）。必要信息缺失时说明阻塞，不猜测用户授权。
等待已委派的内部工作时，用 parentId 将下属关联到当前节点，使用 blockedByIssueIds 明确列出所等的下属并将当前任务设为 blocked，保存交接说明后退出本次运行。宿主会保持工作流及下属运行，在依赖完成且工作区归位后继续同一任务和尝试；无需轮询或另建返修任务。外部权限、工具配置、取消、人工决定等阻塞仍须如实上报，不能冒充内部依赖。in_review 仍须具备真实审查、审批或未耗尽的监视路径，不能作为没有续跑依据的占位状态。
执行者先记录简要计划，再实施；交付时登记可核查的 work product，并记录产物位置及确切版本、每项验证的方法与结果、未解决问题。
返修逐条回应上一轮问题编号：修改了什么、对应产物版本、重新验证结果。复审既检查这些问题，也检查原始验收项和关联回归。不得通过删改验收要求获得通过。
研究与文档使用来源、事实和内容覆盖证据；软件使用运行与测试证据；专业领域规则只来自所选模板和项目上下文。没有执行的检查标为未验证。
需要新工具、缺失权限或连续无进展时明确说明原因与下一步；保持现有尝试、时间和预算上限。经验建议附证据、适用范围、拟议改进和验证办法，作为候选提交，不直接改写全局规则。`);
  sections.push(`# 执行连续性与审批准备
已有用户目标及授权范围内的常规实现、返修、只读诊断和方案准备由原负责人推进；不得将一次审查退回自动理解为需要用户重新授权。新费用、范围变更、已明确停止或真实权限问题仍走正式人工决定，不代答human_only，不放宽安全或额度。
提交真实投入或路线决定前，先形成可审查的具体方案：不同于已失败路线的依据、保留收益、影响范围、代价、验证及停止条件。准备工作不依赖批准时，将它交给本节点下的独立可执行子任务，不把尚未实施的受批工作伪装成准备。不要只问“是否继续投入”。
内部问题、媒体核收和资源释放使用原任务上的具名正式问答交互及wake_assignee，退出等待真实答复；宿主记录交互身份，不通过评论猜测等待结束。人工问答只阻挡相关路径，不代表用户暂停整个工作流。明确的工作流暂停/取消仍停止整树。不要用无事件来源的blocked或backlog代替正常等待。
共享文件及运行窗口只保留一个实际owner；收到新反馈后由活动作者在安全边界接续。上级不得将其他正在执行的作者改回backlog或cancelled；先取得释放回执。任务PATCH可附expectedUpdatedAt，遇409须重新读取，禁止盲目重放旧计划。
派工前声明requiredTools并核对执行、查看、录制、正常速度播放与停止所需能力。工具列出不等于可调用；配置预检不等于真实运行。没有正常速度观看能力就标记未评，不以静帧/合成输入代正常动态或真人试玩。
候选交付记录metadata.verification：revision、真实执行类型、观看范围及可选媒体校验。版本、附件或源码身份变化后旧通过不沿用。媒体保留原始帧/真实时钟，候选副本显示版本与未验收标识；编码完成后完整解码核帧数和PTS，不得发布空文件、伪造时长或将检查成功写成独立QA通过。`);
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
