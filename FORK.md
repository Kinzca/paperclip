# Paperclip 本地定制版

设置新增已归档对话管理与只读存储统计；搜索、取消归档、永久删除的范围及保护条件见[说明](doc/ARCHIVED-CHATS-AND-STORAGE.zh-CN.md)。不自动清理文件或恢复暂停任务。

内部问答等待、局部人工决定、交接并发保护、工具预检、候选版本与原生媒体校验、本地宿主监督见[执行可靠性说明](doc/UNATTENDED-EXECUTION-RELIABILITY.zh-CN.md)。不新增业务数据迁移、不自动解除原暂停或人工审批。

此 Fork 基于官方 `v2026.1023.0`，定制分支是 **codex/native-workflow-engine**。为保持现有本地实例兼容，不直接追随上游 master 升级。

## 统一主线与跨电脑协作

本 Fork 唯一长期开发主线和 GitHub 默认分支统一为 **`codex/native-workflow-engine`**。
`origin` 指向 `Kinzca/paperclip`，是正常推送目标；`upstream` 指向官方 `paperclipai/paperclip`，用于只读获取、比较和选择性移植更新。官方代码不自动混入本主线。

### 开始、结束与换电脑

1. 开始任务先查看 `git status --short`、`git branch --show-current` 和 `git remote -v`，确认工作目录、分支和仓库；保留已有未提交内容，不自动丢弃或覆盖。
2. 日常开发在主线上先执行以下命令。只有快进成功后才以这份代码继续；如出现分叉，先明确两端改动，不用强推、硬重置或丢弃提交解决。

   ```sh
   git switch codex/native-workflow-engine
   git pull --ff-only origin codex/native-workflow-engine
   ```

3. 完成本次任务后，提交对应文件并推送 `origin` 的同名主线。报告分支、提交 SHA、北京时间，以及是否构建、是否部署、是否执行数据库迁移；提交成功不等于已经部署或功能通过验收。
4. 换电脑前先提交并推送；另一台电脑先拉取再开始。两台电脑尽量不同时修改同一批内容。
5. 并行或隔离任务可以使用临时分支 / worktree，但开始时必须明确归并目标为本主线，完成后整合并按任务授权清理；不自动创建新的长期主线。临时分支上的工作不视为主线已更新。
6. 主线使用普通快进推送，不强推覆盖其他电脑的提交。不要向官方 `upstream` 推送本 Fork 的改造。公司数据、Wiki 资料、数据库、密钥、登录和机器环境不提交到 Git。

建议每台电脑在此仓库设置一次以下 Git 选项。它们是仓库级的本机配置，不会随着 Git 拉取自动同步到另一台电脑：

```sh
git config remote.pushDefault origin
git config push.default simple
git config checkout.defaultRemote origin
```

### 已有电脑切换主线

先保存未提交工作，再获取远程信息：

```sh
git fetch origin
```

如果本地已经有目标分支，执行日常开发的 switch / pull 命令；尚无目标分支时执行：

```sh
git switch --create codex/native-workflow-engine --track origin/codex/native-workflow-engine
git pull --ff-only origin codex/native-workflow-engine
```

旧 `codex-local` 分支停止作为开发和推送目标。迁移前它位于 `83112b373956ec0559d055ef015aaece562e92dd`，是目标主线中 `9e9025c9730ce36ec0a0d3411849bb5d852294f6` 的祖先；当前电脑已有的改造与另一台电脑新增的 5 条提交全部保留。只有确认目标主线保留这些提交并推送成功后，才删除旧的本地 / 远程分支。

其他电脑若还保留本地 `codex-local`，先核对是否有尚未推送的独有提交，再切换和清理，不能直接按旧电脑的状态删除。不要重新推送已退役的远程分支。

### 分支统一与运行环境的边界

统一分支只迁移代码与协作入口，不自动升级服务、运行迁移或同步业务数据。
本主线含原生工作流、共享 Agent 规则和运行控制。统一安装器配套编译当前提交的后端、db、shared、SDK 与 UI；已有实例通过 upgrade 备份、迁移和切换，单独 git pull 不会升级运行服务。参见[统一发布流程](doc/LOCAL-RELEASES.zh-CN.md)。参见 [原生工作流](doc/NATIVE-WORKFLOWS.md) 和 [共享 Agent 规则](doc/shared-agent-instructions.md)。

## 早期改造记录（2026-11-02）

- 侧栏新增可折叠的 Plugins 分组，复用原生分组、字体和间距。插件 sidebar 插槽和 sidebar launcher 从 Work 移入该组；没有插件入口时隐藏分组。主界面顺序为 Work → Org → Plugins → Agents。原有 sidebarPanel 扩展保留原位置。
- Office 来自 [Kinzca/Agent-Pixels](https://github.com/Kinzca/Agent-Pixels)，固定在 `a3fff4a71eeca595572decfdca7adffeadd26a85`（0.4.0）。去掉页面内重复标题、徽标、说明，将刷新状态移到任务工具栏旁。保留自动刷新、防闪烁画布、任务摘要和真实流程状态。
- Wiki 保留 Paperclip 主侧栏，目录位于内容区左侧，窄窗口可收起；setup 同时构建 Wiki，独立登记入口支持首次安装和显式升级。
- 将此前本地的阶段交接修复纳入版本管理：环境暂未释放时保存交接回执，释放后重新进入原队列，按公司、任务、负责人和完整阶段快照复核，过期回执取消。没有增加新的权限或数据库结构。

按用户要求，此次只实现、构建、部署并交付，**未执行测试、类型检查、代码审查、设计检测或浏览器验收**。源码移植、跨电脑安装、不同平台和完整双 Agent 闭环均等待用户检查；构建完成不表示验收通过。

构建兼容处理：该官方标签引用了未包含在 Git 仓库中的公告动画示例；此 Fork 从同版本已发布 UI 中恢复原示例到 `ui/src/lib/fixtures/announcement-animation.html`，不依赖外部缺失路径。同时让 service worker 构建钩子在构建提前失败时保留原始错误，避免被缺失产物错误遮盖。

## 在另一台电脑全新安装

前提：Git、npm、Node.js **24.22.2**。pnpm 固定 9.15.4，Office 固定提交，Wiki 随当前仓库构建。完整版本来源、Windows 旧安装接管及回退步骤见[统一发布流程](doc/LOCAL-RELEASES.zh-CN.md)。Windows 旧稀疏检出先执行 `git sparse-checkout disable`。不同平台重新构建同一提交，不复制旧二进制。

如果要保留旧电脑的公司与工作记录，先阅读 [迁移文档](doc/LOCAL-MIGRATION.zh-CN.md)，不要先初始化另一套空白公司再覆盖。

### 1. 拉取代码并构建

```sh
git clone --branch codex/native-workflow-engine https://github.com/Kinzca/paperclip.git
cd paperclip
node scripts/local/setup.mjs
```

默认数据根目录是仓库内被 Git 忽略的 `.paperclip-local/`。如需自定义，在本流程所有终端里先设置同一个**绝对路径**：

```sh
export PAPERCLIP_LOCAL_DIR="/你的绝对路径/paperclip-local"
```

`setup.mjs` 将当前干净提交构建为独立 `releases/<提交前12位>`，不覆盖成功版本；只有空实例自动记录初始版本。已有实例必须先停止服务，构建后显式 upgrade。安装不启动服务、不登记插件、不创建公司或任务；保留 home、登录目录和插件资料。复现另一台电脑前先 checkout 它的实际运行提交。下载与保留发布包需要足够磁盘空间。

### 2. 用现有订阅账号登录 Codex

```sh
node scripts/local/codex.mjs login
# 无法打开本机浏览器时，使用 CLI 提供的设备授权入口：
# node scripts/local/codex.mjs login --device-auth
```

默认登录目录是 `.paperclip-local/codex/`，无需配置 GPT API Key。桌面应用登录与此独立 CLI 目录不是自动同步关系，需在新电脑授权一次。已有自定义 `CODEX_HOME` 时，在登录与启动命令所在终端保持相同值。不要将登录文件提交到仓库。

启动入口移除继承的 `OPENAI_API_KEY`；Codex 本身的授权及账户可用额度由正常登录流程决定。Agent 如果使用独立 Codex home 或 Paperclip 的连接管理，仍需在该 Agent 的配置界面完成对应授权，不能把主 CLI 登录等同于所有员工已经登录。

### 3. 启动本机服务

```sh
node scripts/local/start.mjs
```

首次调用官方本机 onboard，默认仅在回环地址 [http://127.0.0.1:3100](http://127.0.0.1:3100) 提供服务，使用嵌入式 PostgreSQL。已有配置则复用该配置。保持此终端运行；Ctrl+C 停止通过此入口启动的服务。新实例初始化可以执行迁移；已有实例由 upgrade 或 migrate 显式迁移，start 不自动升级数据库。启动成功不等于跨机或功能验收。

### 4. 在第二个终端登记插件

进入同一仓库，保持相同 `PAPERCLIP_LOCAL_DIR`。如果使用自定义 HTTP 端口，在第二个终端设置 `PAPERCLIP_PORT` 与实际配置一致：

```sh
node scripts/local/install-office.mjs
node scripts/local/install-wiki.mjs
```

两个命令仅通过本机正式安装接口登记已构建插件。已有同标识插件时默认保留，不重复安装，也不自动升级。安装响应中的 ready 只表示登记状态；权限与实际页面由你检查。

此终端入口适用于 `local_trusted` 实例。认证模式需要在插件管理界面用管理员身份操作；401/403 或隐藏了 `instance.plugins` 时，不要卸载插件或绕过权限。默认地址可用后再进入界面创建公司，Office / Wiki 链接由宿主添加实际公司前缀，不能直接打开不带公司前缀的 `/wiki`。

### 5. 配置公司、员工与 Wiki

- 新环境不会自动带入原电脑的公司、执行者或独立审查者；按需创建，或者按迁移文档恢复已有实例。
- 在 Agent 配置中选择 Codex 本地适配器、可用模型和新电脑的工作目录，完成所需授权。Office 读取当前公司已有成员与真实任务状态，不负责替你创建员工。
- 在 Wiki → 设置选择该公司的本地 Wiki 根目录，例如数据根目录中的 `wiki/<公司前缀>`，由你执行首次初始化。资料本身保存在此目录，不能只备份插件代码。
- Wiki 的上游 manifest 默认维护员适配器为 `claude_local`，且默认暂停。只有 Codex 订阅时，要在 Wiki / Agent 设置中改为 `codex_local`、选择可用模型，并完成该员工的授权与工作目录配置，再决定是否启用；安装脚本不自动修改它。
- Wiki 维护 Agent 和例程默认暂停，Paperclip 自动事件导入默认关闭。脚本不唤醒员工、不运行演示或导入公司历史；由你按业务需要开启。

### 数据目录

新安装的代码位于 `releases/`，运行选择位于 `current.json`，备份位于 `checkpoints/`，稳定插件包位于 `plugins/office` 和 `plugins/wiki`。旧安装接管保留原插件路径。Wiki 正文位于公司设置的资料目录，与插件包不同。完整目录表见[发布说明](doc/LOCAL-RELEASES.zh-CN.md#状态目录和默认额度)。

`home/instances/default/` 保存实例配置、数据库、日志、存储和密钥；实际位置以 config 为准。`codex/` 是默认 CLI 登录目录。它们不随 Git 同步，也不随版本切换重建。`PAPERCLIP_PORT` 必须与实例端口一致；改变 `PAPERCLIP_LOCAL_DIR` 只改变目标，不搬运旧数据。

## 源码、运行时和数据的边界

- `ui/src/components/SidebarPlugins.tsx` 负责分组；两种侧栏均复用该组件。
- `server/src/services/heartbeat/{queue,run-control,run-preparation,stage-handoff}.ts` 保存阶段交接修复的源码形式。
- 宿主核心从当前提交编译；锁定发布依赖只提供 runner、原生程序、CLI 与外部依赖。新构建不再将旧 stage-handoff 或 sidebar-schema JS 覆盖到新后端；这些修复已在源码中。release.json 明确记录来源。
- `scripts/local/overlays/postgres/` 是同版本上游 `patches/postgres@3.4.9.patch` 的发布运行时形式。npm 安装不会执行 pnpm patchedDependencies，所以安装器补齐此官方补丁。文件包含其他修改或版本不同会停止，不会强行覆盖。
- 阶段交接沿用此前受限扫描恢复方式，并非新增无轮询或休眠安全保证。升级调度器时应另行适配和验证，本轮只保留现有行为。
- 不包含当前电脑的公司、员工、任务、附件、数据库、密钥或 Codex 登录。新电脑默认是全新实例。已有公司需要导入员工模板/重新配置；同一台电脑现有实例中的公司继续使用原数据。若要完整迁移，需通过数据库备份及对应文件存储、加密密钥的安全迁移单独操作，不能只 git pull。

## 后续维护与升级

统一执行：停服务 → 快进拉取 → `setup.mjs --prepare-only` → `upgrade.mjs --to <确切版本>` → `start.mjs`。首次从旧手工 runtime / source-releases 迁移需要先 `adopt.mjs`。升级前自动保存数据库逻辑备份、配置与插件代码检查点，启动后通过正式接口同步已安装且 ready 的 Office / Wiki。失败保留 pending 记录，不能跳过失败直接启动。

停止服务后 `rollback.mjs` 可回到迁移清单兼容的上一版本；数据库或插件迁移不兼容时，恢复到独立实例。命令、失败恢复和数据备份范围均见[统一发布流程](doc/LOCAL-RELEASES.zh-CN.md)。不自动卸载插件、清空知识库或重建登录。

## 交付证据与未验证范围

版本工具包含隔离检查与构建步骤，部署状态在实际交付说明中报告。UI、真实 Agent 闭环、另一台电脑全新安装和跨平台数据库恢复由用户检查；不得从健康接口或构建成功推导这些验收通过。下方早期记录保留其原有时间和验证范围。

工作流出厂默认额度为**每阶段 5 次、不设工作流总时长上限、并发 2**；人工验收等待停表，支持人工追加额度和无效循环识别。已有显式配置和运行快照保持原规则，详见[运行控制说明](doc/WORKFLOW-RUNTIME-CONTROLS.zh-CN.md)。

## 插件侧栏规格统一（待用户检查）

新增 sidebar 的可选 `navigation: { routePath, icon }` 元数据，普通入口由宿主 SidebarNavItem 绘制。Office / Wiki 已分别声明 building-2 / book-open；兼容旧单入口插件的自动页面推导，并保留复杂自绘入口的兼容挂载。详细契约、图标名、退出自动推导的方法和部署顺序见 [侧栏入口规范](doc/plugins/SIDEBAR-NAVIGATION.md)。

早期发布服务通过 `scripts/local/overlays/sidebar-schema/` 获得可选字段校验；新安装器直接编译包含该能力的源码，不新增数据库迁移或业务权限。宿主和插件需要配套更新。本轮构建不等于验收，仍由用户检查。

## 简体中文／English（待用户检查）

公司菜单底部和个人资料设置新增语言选择；默认按浏览器语言选择中文或英文，使用 `paperclip.ui.locale` 保存到当前浏览器的 localStorage。切换通过 i18next 和组件订阅更新，不重载页面或重建任务。其他同源标签页接收 storage 事件同步；不同电脑或浏览器不会自动同步该偏好。

优先接入侧栏、任务列表及详情、Agent 列表及详情与配置、组织图、公司／个人／实例／插件设置，以及 Office 0.4.0、LLM Wiki 0.1.3 的主要固定界面文案。底层状态码、路由、任务标题与正文、评论、代码、Agent 名称、用户填写的职位和知识库内容均保留原值。后台原始诊断、第三方连接器提供的内容及未接入的次级界面仍可能保留原文，不使用页面文字扫描或机器翻译覆盖用户内容。

固定 UI 资源位于 `ui/src/i18n/messages/{en,zh-CN}-ui.json`，与原有 app 命名空间分开。SDK 前端桥新增 `useHostLocale` / `translateUi`，为插件提供同一语言选择和译文。Office / Wiki 与宿主配套升级，不单独升级到缺少接口的旧宿主。详细维护说明见 [双语界面说明](doc/plugins/UI-LANGUAGE.md)。

本轮只实现、构建、提交和部署，没有运行开发测试、单独类型检查、代码审查、机械设计检测、浏览器或 Agent 任务验收。构建包含生成必需 SDK 产物的 TypeScript 编译。


## Windows 电脑历史安装记录（2026-11-02）

以下是另一台电脑当时的安装记录，路径和验证结论只适用于该环境，不是其他电脑的固定配置。

安装目录：`D:\Projects\Tool\paperclip`。使用目录内独立的 Node.js 24.22.2，不替换系统 Node。双击 `Start-Paperclip.cmd` 启动服务，再打开 http://127.0.0.1:3100 。双击 `Login-Codex.cmd` 完成此工具独立 Codex 目录的订阅登录；本次没有复制其他应用的凭据。后续重建可使用 `Setup-Paperclip.cmd`，先停止服务。

本机兼容修正：npm 通过 Node 调用 JS 入口；补齐原 npm 锁文件缺失的 fsevents@2.3.3 记录，保留其余版本；Office 安装使用 --ignore-workspace；补丁目录强制 LF，保留原 SHA256 校验。源码采用部分克隆，仅检出根文件、scripts、patches、packages、ui，缺少的其他目录可按需通过 git sparse-checkout add 获取。

已验证宿主 UI、SDK、Office 0.4.0、Wiki 0.1.3 构建成功，嵌入式数据库首次初始化、服务健康接口及正式插件登记通过。浏览器自动化因不能可靠确认当前网址而停止，页面渲染及实际 Agent 任务未验收。没有创建公司、员工或任务。详细版本与检查结果见 .paperclip-local/installation.json。

## 共享 Agent 规则与设置草稿（2026-11-03）

`codex/native-workflow-engine` 分支新增实例全局 Agent 提示词和组织补充规则。
“设置 → 常规 → Agent 运行规则”集中展示两层规则，分别保存，并可查看已保存的共享规则预览。
后续运行使用最新规则；修改或清空规则会更新会话配置，不会改变沙箱、审批和预算约束。

草稿按账号和组织保留在当前浏览器标签页中。外部更新不会直接覆盖未保存内容，
保存组织规则也不会清掉同页尚未保存的名称和描述。全局编辑入口对非实例管理员只读。
接口、存储、迁移及适配器接入说明见 [共享规则文档](doc/shared-agent-instructions.md)。

后端源码包含迁移 `0335`。固定安装器仍以发布服务 `2026.1023.0` 为基础；
仅替换 UI 或运行旧的安装入口，不能视为已经升级这些后端功能。
从其他电脑部署时，需要配套构建本分支后端并应用迁移；本机运行时覆盖和实例数据位于被忽略的
`.paperclip-local/` 中，不随源码提交同步。

## 通用工作流分层（2026-11-03，待用户审查）

内置通用任务、应用开发、问题修复、研究分析、文档编写；游戏开发作为可选专业模板保留。公司／项目规则支持上下文与阶段职责绑定，新通用任务接入版本化交接及结构化审查证据，候选优化保存适用范围、来源和验证计划。已有任务与显式配置不自动迁移。

详见 [通用工作流契约与用户检查步骤](doc/GENERIC-WORKFLOWS.zh-CN.md)。使用现有 JSON 存储，无新增数据库迁移。需配套部署 shared、server 与 UI，固定旧版 setup 不会自动获得这些后端功能。实际构建、提交和部署状态以本轮交付说明为准。

## 工作流运行控制（2026-11-03）

平台上限、人工验收停表、人工追加额度续跑和连续重复失败转人工的操作说明见[工作流运行控制](doc/WORKFLOW-RUNTIME-CONTROLS.zh-CN.md)。该版本当时默认每阶段 5 次、180 分钟、并发 2（后续不限时默认见下文）；已有任务和显式公司／项目规则保持原值。此次新增数据库迁移 `0336_calm_rocket_racer.sql`，迁移前备份。代码提交、构建和本机部署状态分别记录，界面及真实 Agent 流程仍交由用户验收。

## Workspace Diff Viewer（2026-11-03）

固定使用本仓库的 `@paperclipai/plugin-workspace-diff@0.1.0`，纳入统一发布清单。首次登记执行 `node scripts/local/install-workspace-diff.mjs`；入口在项目工作区或执行工作区的 Changes 页签，仅读取 Git 差异。该插件不增加独立侧栏入口。安装、升级和跨机路径说明见[发布流程](doc/LOCAL-RELEASES.zh-CN.md#workspace-diff-viewer)。页面和真实工作区内容由用户检查。

## Wiki 后台批处理（2026-11-06）

Wiki 插件 0.1.4 新增按公司选择项目的后台队列、程序去重和开发优先门槛。只有已完成业务总任务的新资料才可能唤醒维护员；空队列和未变化的夜间维护不调用模型。默认关闭，旧托管例程保持暂停；配置与检查入口见 [Wiki README](packages/plugins/plugin-llm-wiki/README.md#后台批处理014)。新增插件迁移 004，按统一升级流程备份、迁移及正式重载插件。公司启用状态和真实验收保存在本机公司资料中，不提交到源码仓库。

## 无人值守的内部依赖等待（2026-11-06）

执行节点用真实 blockedByIssueIds 等待本节点下的自动化子任务时，工作流继续运行，不再停止仍在工作的下属。依赖结束且工作区归位后，沿用原节点、任务和尝试续跑；下属状态变化会通知所属工作流，重启可补处理持久依赖。外部、取消、无人负责或待排期的阻塞仍走人工介入；明确的工作目录校验失败先要求修复配置，不盲目消耗返修次数。时间、预算、权限、独立审查和人工暂停／取消均沿用原规则。见 [原生工作流](doc/NATIVE-WORKFLOWS.md#delegated-dependency-waits) 与 [实施记录](doc/plans/2026-11-06-unattended-dependency-waits.md)。


### 工作流不限总时长（2026-11-07）
新工作流出厂默认 `timeoutMinutes: null`，表示不设工作流总时长上限；显式整数 1–1440 表示有限分钟数。省略字段继承上级，null 不可绕过上级显式有限额度。平台时长留空保存 null；公司/项目可选择“不设时长上限”或留空继承。费用、尝试次数、并发、权限、取消、单次工具/运行超时及重复失败保护仍独立生效。数据库以 `deadline_at IS NULL` 表示不限时，命令检查仍使用自己的有限超时与租约，不使用超远日期或反复自动续时。已有配置、任务快照、暂停与到期决定不被追溯改写；升级不会自动恢复旧任务。需要先执行随代码提供的数据库迁移，再运行新版本。
