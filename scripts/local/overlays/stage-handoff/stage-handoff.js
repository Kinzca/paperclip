// 本地补丁：阶段交接必须在环境释放后继续，不能降级成一次性诊断。
const reasons = new Set(["execution_review_requested", "execution_approval_requested", "execution_changes_requested"]);
export function isStageHandoff(source, reason, context) {
    return source === "assignment" && reasons.has(reason) && context?.source === "issue.execution_stage";
}
export function stageWaitSnapshot(issue) {
    return JSON.stringify(issue.executionState ?? null);
}
export function isCurrentStageWait(issue, wake) {
    const payload = wake.payload ?? {};
    const context = payload._paperclipWakeContext;
    if (!issue || issue.companyId !== wake.companyId || issue.id !== payload.issueId ||
        ["done", "cancelled"].includes(issue.status) || issue.assigneeAgentId !== wake.agentId ||
        !isStageHandoff(wake.source, wake.reason, context) ||
        payload.executionStageWait !== stageWaitSnapshot(issue)) return false;
    const state = issue.executionState;
    if (wake.reason === "execution_changes_requested")
        return state?.status === "changes_requested" && state.returnAssignee?.type === "agent" && state.returnAssignee.agentId === wake.agentId;
    return state?.status === "pending" && state.currentParticipant?.type === "agent" &&
        state.currentParticipant.agentId === wake.agentId &&
        state.currentStageType === (wake.reason === "execution_approval_requested" ? "approval" : "review");
}
