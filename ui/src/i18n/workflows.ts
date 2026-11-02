import { i18n } from "./index";

// Keep this surface's copy together without changing the global UI catalog.
const messages = {
  "Evaluation result": "验证结果",
  "Could not verify your account. Retry to load workflow settings.":
    "无法确认当前账号，请重试以加载工作流设置。",
  "Open revision workspace": "展开修订",
  "Close revision workspace": "收起修订",
  "Your unsaved changes for this company have been restored.":
    "已恢复此组织中未保存的修改。",
  "Save the edited draft as a new revision before running regressions or publishing.":
    "草案存在未保存的修改，请先保存为新修订，再运行回归或发布。",
  "Fixed verification rules cannot be changed: {{stage}}.":
    "验收规则必须保持固定，请恢复“{{stage}}”的原始定义。",
  "Company defaults": "公司默认规则",
  "Project defaults": "项目默认规则",
  "Current workflow": "当前生效工作流",
  "Saved rules": "已保存规则",
  "Unsaved preview": "待保存预览",
  "Edit rules": "调整规则",
  "Create revision": "创建修订",
  "Rules for future tasks. Existing runs keep their original rules.":
    "统一设置后续任务的执行规则，正在运行的任务保持原规则。",
  "Standard root tasks inherit these rules when first assigned. Conversations, routine tasks and existing assigned tasks are excluded.":
    "标准根任务在首次指派时继承这些规则；对话、定时任务和已有指派的任务不在此范围内。",
  "Execution limits": "执行限制",
  "Platform defaults": "平台默认规则",
  "Inherited from {{source}}": "继承自{{source}}",
  "Limited by {{source}}": "受{{source}}限制",
  "Per-stage attempts": "每阶段最多尝试",
  "{{count}} attempts": "{{count}} 次",
  "{{count}} minutes": "{{count}} 分钟",
  "{{count}} stages": "{{count}} 个阶段",
  "Active execution time": "累计执行时长",
  "Concurrent stages": "同时执行阶段",
  "Reported cost limit": "已记录费用上限",
  "Company budgets still apply": "仍受公司预算约束",
  "No additional limit": "不额外设限",
  "Built-in template": "内置模板",
  "Version {{version}}": "版本 {{version}}",
  "Policy version {{version}}": "规则版本 {{version}}",
  "Runs in parallel": "并行执行",
  "Stage {{number}}": "阶段 {{number}}",
  "Waits for: {{stages}}": "等待：{{stages}}",
  Execution: "执行",
  "Evidence check": "证据校验",
  "Independent review": "独立审查",
  "Human acceptance": "人工验收",
  "Execute, verify, review": "执行、验证与审查",
  "Bounded execution with a recorded run receipt and independent review.":
    "执行任务后核验证据，再由独立成员审查；失败时在既定限制内返工。",
  "Game development": "游戏开发",
  "Implementation followed by parallel code and playable-result verification.":
    "完成游戏修改并保留产物后，并行开展代码审查与试玩验证，最后由你验收。",
  "Execute task": "执行任务",
  "Check execution evidence": "核验执行证据",
  "Independent verification": "独立验证",
  "Implement game change": "实现游戏修改",
  "Check retained deliverables": "核验交付产物",
  "Review implementation": "代码审查",
  "Verify playable result": "试玩验证",
  "Accept game result": "人工验收",
  "Workflow unavailable": "工作流模板不可用",
  "Choose an available template in Edit rules, then save again.":
    "请在“调整规则”中选择可用模板后重新保存。",
  "Change defaults": "修改默认规则",
  "Leave a limit empty to inherit. A project can tighten its parent's limits, but cannot lift them.":
    "限制留空即继承上级规则。项目可以收紧上限，不能放宽上级限制。",
  "Cost limit (USD)": "费用上限（美元）",
  "Use whole numbers from {{min}} to {{max}}.":
    "请输入 {{min}}–{{max}} 之间的整数。",
  "Use an amount from $0.01 to $10,000.00, with at most two decimal places.":
    "请输入 0.01–10,000.00 美元，最多两位小数。",
  "Reported costs may arrive after execution. This is an additional stop condition, not a prepaid budget.":
    "费用在执行后记录；此上限是额外停止条件，不是预付预算。",
  "Before saving": "保存前",
  "After saving": "保存后",
  "Save rules": "保存规则",
  "Saving rules…": "正在保存规则…",
  "Discard changes": "放弃修改",
  "No changes to save": "没有待保存的修改",
  "Rules saved. Future eligible tasks will inherit them.":
    "规则已保存，后续符合条件的任务将自动继承。",
  "Rules changed elsewhere. Your edits are preserved. Reload saved rules before trying again.":
    "规则已在其他位置更新。你的修改已保留，请重新读取已保存规则后再操作。",
  "Reload saved rules": "重新读取已保存规则",
  "Could not save rules. Your edits are preserved. Try again.":
    "规则保存失败，修改已保留，请重试。",
  "You have unsaved changes. Discard them to change scope?":
    "当前有未保存的修改。是否放弃修改并切换范围？",
  "Keep editing": "继续编辑",
  "Discard and switch": "放弃并切换",
  "Available workflows": "可用工作流",
  "Use this workflow": "采用此工作流",
  "Current selection": "当前选择",
  "Improve this workflow": "改进此工作流",
  "Workflow revisions": "工作流修订",
  "Improve instructions, verify against successful tasks, then publish with evidence.":
    "改进执行指令，用成功任务验证效果，再依据证据发布修订。",
  "Edit draft": "修改草案",
  "Run regressions": "回归验证",
  "Review and publish": "检查并发布",
  "Draft ready to edit. Nothing has been saved yet.":
    "草案已准备，可开始编辑；当前尚未保存。",
  "A draft is already being edited. Keep it or replace it with this template?":
    "当前已有正在编辑的草案，是否用此模板替换？",
  "Replace draft": "替换草案",
  "Draft instructions": "草案指令",
  "Acceptance checks, review instructions and dependencies stay fixed. Change the execution instructions below.":
    "验收标准、审查指令和阶段依赖保持固定。你可以修改执行阶段的指令。",
  "Saved draft. Editing it creates a new draft revision.":
    "这是已保存的草案；修改并保存后会创建新的草案版本。",
  "Discard the unsaved draft to switch revisions?":
    "是否放弃未保存的草案并切换修订？",
  "Instructions for {{stage}}": "{{stage}}的指令",
  "Why is this revision needed?": "为什么需要这次改进？",
  "Explain the problem this change solves.": "说明本次修改要解决的问题。",
  "Advanced JSON editor": "高级 JSON 编辑器",
  "Saving draft…": "正在保存草案…",
  "Save draft": "保存草案",
  "Draft saved. Select baseline tasks to verify it.":
    "草案已保存，请选择基线任务进行验证。",
  "Enter a reason for this revision.": "请说明本次修订的原因。",
  "Invalid JSON. Check quotes, commas and brackets.":
    "JSON 格式无效，请检查引号、逗号和括号。",
  "Invalid workflow definition at {{path}}. Check the field and try again.":
    "工作流定义中的 {{path}} 不符合要求，请检查后重试。",
  "Could not save the draft. Your edits are preserved.":
    "草案保存失败，修改已保留。",
  "Select an existing draft": "选择已有草案",
  "No saved drafts yet": "还没有已保存的草案",
  "Save a draft in the first step to select baseline tasks.":
    "先在第一步保存草案，再选择基线任务。",
  "Search successful tasks": "查找成功任务",
  "Task title or identifier": "任务名称或编号",
  Search: "查找",
  "Only successful runs of the matching baseline version are listed.":
    "这里只列出符合基线版本要求、且工作流已成功完成的任务。",
  "{{count}} of 3 required objectives selected":
    "已选择 {{count}} 个目标，至少需要 3 个",
  "Select 3–10 tasks with different frozen objectives.":
    "请选择 3–10 个冻结目标互不相同的任务。",
  "This objective is already selected": "已选择相同目标的任务",
  "Selected baseline tasks": "已选基线任务",
  "Remove {{title}}": "移除 {{title}}",
  "No eligible baseline tasks": "暂无符合条件的基线任务",
  "Complete successful tasks with this workflow first, or try another search. No tasks are started automatically.":
    "请先积累此工作流的成功任务，或尝试其他搜索；系统不会为补齐基线自动启动任务。",
  "Could not load baseline tasks. Retry the search.":
    "基线任务加载失败，请重试搜索。",
  "Previous page": "上一页",
  "Next page": "下一页",
  "Start {{count}} candidate tasks": "启动 {{count}} 个候选任务",
  "Starting regressions…": "正在启动回归…",
  "This starts real agent tasks and may incur usage costs. Existing budgets and workflow limits apply.":
    "此操作会启动真实代理任务并产生使用费用，仍受既有预算与工作流限制约束。",
  "Candidate tasks started. Results update automatically.":
    "候选任务已启动，结果将自动更新。",
  "Could not start regressions. Your selection is preserved.":
    "回归启动失败，已保留你的选择。",
  "Regression results": "回归结果",
  "No regression results yet": "还没有回归结果",
  "Start regressions in the previous step, then review their evidence here.":
    "请在上一步启动回归，再到这里检查结果与证据。",
  Objective: "验证目标",
  "Baseline task": "基线任务",
  "Candidate task": "候选任务",
  "Open task": "打开任务",
  Passed: "已通过",
  "Needs attention": "待处理",
  "Waiting for results": "等待结果",
  "{{count}} distinct objectives passed": "{{count}} 个独立目标已通过",
  "At least 3 distinct objectives passed": "至少 3 个独立目标通过",
  "No failed or pending evaluations": "没有失败或待完成的验证",
  "Draft is saved and ready": "草案已保存并就绪",
  "Publish readiness": "发布条件",
  "Publication creates a new available revision. Unpinned defaults adopt it for future tasks; pinned versions and existing runs stay unchanged.":
    "发布后会新增可用版本。未固定版本的默认规则会用于后续任务，已固定版本和正在运行的任务保持不变。",
  "Publishing…": "正在发布…",
  "Publish revision": "发布修订",
  "Revision published. Existing runs keep their original rules.":
    "修订已发布，正在运行的任务保持原规则。",
  "Could not publish this revision. Refresh results and check the readiness list.":
    "修订发布失败，请刷新验证结果并检查发布条件。",
  "Refresh results": "刷新结果",
  "Advanced manual comparison": "高级手动对比",
  "Baseline run ID": "基线运行 ID",
  "Candidate run ID": "候选运行 ID",
  "Scenario label": "场景名称",
  "Compare matching frozen objectives only. Run IDs are available in each task's workflow details.":
    "只能对比相同的冻结目标，运行 ID 可在对应任务的工作流详情中查看。",
  "Evaluate comparison": "评估对比",
  "Evaluating…": "正在评估…",
  "Comparison saved. Review the result above.": "对比已保存，请查看上方结果。",
  "Could not evaluate this pair. Check the run IDs and their frozen objectives.":
    "对比失败，请检查运行 ID 和对应的冻结目标。",
  "Could not load workflow settings.": "工作流设置加载失败。",
  Retry: "重试",
  "Completed {{date}}": "完成于 {{date}}",
} as const;

i18n.addResourceBundle(
  "en",
  "ui",
  Object.fromEntries(Object.keys(messages).map((key) => [key, key])),
  true,
  false,
);
i18n.addResourceBundle("zh-CN", "ui", messages, true, false);
