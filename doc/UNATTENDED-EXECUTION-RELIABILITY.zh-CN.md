# 内部等待、交接与本地持续运行

本契约处理宿主执行可靠性，不改变用户目标、审查标准、安全模式、预算或员工权限。具体公司配置、任务、视频及参考资料不属于源码交付。

## 正常等待与人工决定

实现分支真实运行或排队时，后置评审可以等待尚未开放的采录任务；该等待不会取消另一条有效依赖链上的员工运行。此保留仅依据同公司、依赖可达、负责人一致且依赖已就绪的实际运行，不会激活 backlog、通过审批或改变任务权限。没有这类运行后，未能继续的等待仍交人工处理；无关任务、其他公司的运行、已暂停员工和已经结束的运行不能掩盖阻塞。

工作流执行节点使用真实 `blockedByIssueIds` 等待本节点子树内的自动工作；已完成任务仍须通过既有工作区归位屏障。没有续跑依据的 blocked 仍要求介入，外部、取消或待排期任务不会被冒认为自动工作。

已撤回或过期的旧交互不再污染等待快照；当前有效人工决定与否决仍保留。队列因 `issue_dependencies_blocked` 在进程启动前取消续跑时，有效内部等待继续使用原任务和尝试，不作为实现失败扣除次数。旧版本已误记失败的节点，可由有权用户通过原工作流 `resume` 定向纠正：系统核对原任务/执行者、最新未启动的依赖门禁回执、对应失败证据及当前合法依赖，保留旧回执和失败证据并增加纠正审计。真实执行失败、已启动运行、用户取消或归属变化不走此恢复路径；不自动追加额度或修改验收。

正式 `ask_user_questions` 交互使用 `wake_assignee`。具名自动收件人必须仍是本公司的活动员工；human_only 或具名用户问题保持人工决定。宿主将事件身份保存到节点的 `delegatedWait`，显示 dependencies、agent_interaction 或 human_interaction，并在真实答复后沿原任务和尝试接续。不会自动回答、撤销或批准卡片。

人工问题只等待相关执行路径；独立可执行的诊断或方案准备不因此被整树取消。先完成可审查方案再请用户决定真实新增投入，方案须包含不同路线的依据、影响、代价、验证和停止条件。准备任务不得偷偷执行尚未获批的工作。用户显式暂停/取消、到期、预算、重复失败和权限保护仍停止执行。升级不自动恢复此前已暂停任务。

## 交接与并发写入

PATCH任务可附 `expectedUpdatedAt`（读取结果中的ISO时间）；服务在行锁内比较，过期返回409/issue_changed，不覆盖新状态。显式旧快照在任务控制副作用之前先拒绝。不能以此代替资源所有权或用户授权。

代理员工不能把另一正在执行的作者改为backlog/cancelled，返回active_task_owner_release_required，先协调作者安全保存与释放。用户显式停止保持原权限。工作流节点不得先blocked等待仍在backlog的直接下属；先激活下属，再建立等待，否则409/delegated_handoff_not_activated。不要重放失败交接或为绕过冲突重建任务。

## 工具预检

节点已有requiredTools配置预检；普通条目沿用有效工具档案和连接健康检查。Codex本地MCP可声明：

```json
{"applicationKey":"editor","toolName":"inspect","transport":"local_mcp"}
```

预检只接受该员工显式配置中的服务器enabled=true、精确工具approval_mode="approve"及允许的工具列表。继承home配置无法证明、其他适配器、被排除工具或缺少精确批准均报具体缺口，不在派工时试错消耗一个阶段尝试，也不扩大权限。该检查不读取凭据、不调用MCP、不关闭沙箱，更不证明应用连接、现场版本、正常速度播放或实际执行成功。需要真实运行的能力仍由执行证据确认。

## 候选版本与媒体

work product可附metadata.verification，明确revision、execution（scripted_runtime/manual_runtime/offline/not_assessed）、viewing（sampled_frames/normal_speed/not_assessed）和可选源哈希、runId、媒体校验。它是证据声明，不是独立QA通过。附件规范化保留该声明，但附件路径、类型、大小仍由宿主记录决定；空视频不能发布。

更新附件身份、URL、版本、源哈希或媒体哈希时，不得沿用旧approved状态；宿主将旧通过改为ready_for_review并清除旧通过，不自动新增人工审批。已有或明确请求的needs_board_review保持，工作流内的独立审查与人工决定也保持。审查必须针对准确的新版本。旧提供方的无结构扩展元数据在普通更新中继续保留，不作为新版本证据。

macOS提供受控本地编码器，原始帧不修改，输出路径必须全新。输入capture.json示例：

```json
{
  "schema":1,"revision":"candidate-r1","execution":"scripted_runtime",
  "width":960,"height":540,"sourceRoot":"frames","endWallSeconds":12.1,
  "frames":[{"path":"frame-0.jpg","wallSeconds":10.0},{"path":"frame-1.jpg","wallSeconds":11.9}]
}
```

```sh
node scripts/local/media.mjs /absolute/capture.json /absolute/new-candidate.mp4
```

只读取sourceRoot内的非空原始图像，拒绝路径和符号链接逃逸、未结束的时钟、维度不一致或已有输出。副本首3秒标记CANDIDATE/NOT ACCEPTED、版本与真实输入方式。AVFoundation按真实墙钟PTS编码，完整解码核对帧数及全部时间误差≤1ms，并核源帧哈希未变；输出verification.json和实际解码first.png。该过程不证明正常速度观感、完整可玩或独立QA；viewing固定not_assessed，实际观看另行如实登记。原生编码当前仅macOS，其他平台明确报未支持，不冒签验证。

## 本地宿主监督

使用同一个源码目录和同一个PAPERCLIP_LOCAL_DIR：

```sh
node scripts/local/service.mjs start
node scripts/local/service.mjs status
node scripts/local/service.mjs stop
```

start创建独立于终端会话的本地监督进程，启动现有current发布版本。使用PID、出生时间和命令校验身份；重复start不再启动第二个有效实例。进程异常退出会有限退避重启，连续3次启动失败后停止并保留日志；重启后的任务接管沿用宿主已有持久工作流对账，不重放结果不明的命令或代答审批。stop只向核实的监督进程发信号，后者只转发给自己实际创建的直接子进程，不按旧PID/PGID误停数据库。

macOS运行期间防空闲休眠，但不保证合盖、手动休眠、断电或重启后自动开机执行。服务日志仅保留当前8MiB及一份轮转。部署前必须stop并等待原服务退出；服务部署锁也记录出生身份，旧PID被复用不会占据新部署或导致误停该进程。身份不明时保守拒绝。

这是宿主进程持续运行，不是额外模型轮询、Codex提醒或修改公司的后台例程。业务进展、真实人工决定仍由Paperclip的正式任务与事件管理。

## 回归与发布边界

针对等待/重启/独立路径/取消、交接旧快照/活动owner/backlog中间态、版本变化撤回旧通过，以及本地工具执行：

```sh
pnpm exec vitest run server/src/services/workflows/engine.integration.test.ts server/src/services/workflows/local-mcp-readiness.test.ts server/src/__tests__/work-product-workspace-validation.test.ts packages/shared/src/validators/work-product.test.ts
pnpm test:local-reliability
```

广泛变更按AGENTS.md执行全量检查，统一发布脚本重编译宿主与配套插件。此次契约使用已有JSON节点状态和元数据，无新增数据库迁移，不改写已有公司政策或工作流快照。一个源码项目可以生成当前运行的构建产物；不要为修复复制源码仓库、创建长期分支或额外开发实例。
