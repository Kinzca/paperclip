# Paperclip 本地定制版

此 Fork 基于官方 `v2026.1023.0`，定制分支是 **codex-local**。为保持现有本地实例兼容，不直接追随上游 master 升级。

## 本次改动

- 侧栏新增可折叠的 Plugins 分组，复用原生分组、字体和间距。插件 sidebar 插槽和 sidebar launcher 从 Work 移入该组；没有插件入口时隐藏分组。主界面顺序为 Work → Org → Plugins → Agents。原有 sidebarPanel 扩展保留原位置。
- Office 来自 [Kinzca/Agent-Pixels](https://github.com/Kinzca/Agent-Pixels)，固定在 `a3fff4a71eeca595572decfdca7adffeadd26a85`（0.4.0）。去掉页面内重复标题、徽标、说明，将刷新状态移到任务工具栏旁。保留自动刷新、防闪烁画布、任务摘要和真实流程状态。
- Wiki 保留 Paperclip 主侧栏，目录位于内容区左侧，窄窗口可收起；setup 同时构建 Wiki，独立登记入口支持首次安装和显式升级。
- 将此前本地的阶段交接修复纳入版本管理：环境暂未释放时保存交接回执，释放后重新进入原队列，按公司、任务、负责人和完整阶段快照复核，过期回执取消。没有增加新的权限或数据库结构。

按用户要求，此次只实现、构建、部署并交付，**未执行测试、类型检查、代码审查、设计检测或浏览器验收**。源码移植、跨电脑安装、不同平台和完整双 Agent 闭环均等待用户检查；构建完成不表示验收通过。

构建兼容处理：该官方标签引用了未包含在 Git 仓库中的公告动画示例；此 Fork 从同版本已发布 UI 中恢复原示例到 `ui/src/lib/fixtures/announcement-animation.html`，不依赖外部缺失路径。同时让 service worker 构建钩子在构建提前失败时保留原始错误，避免被缺失产物错误遮盖。

## 在另一台电脑全新安装

前提：Git、npm、Node.js >= 24.11。终端脚本面向 macOS / Linux；Windows 可在 WSL2 内操作，原生 Windows 与 WSL2 均尚未做安装验收。本入口固定发布服务 `2026.1023.0`、pnpm `9.15.4`、Office `0.4.0`；Wiki 随当前仓库构建，目前为 `0.1.3`。不要用上游 README 的最新版 quickstart 替换这套固定运行时。

如果要保留旧电脑的公司与工作记录，先阅读 [迁移文档](doc/LOCAL-MIGRATION.zh-CN.md)，不要先初始化另一套空白公司再覆盖。

### 1. 拉取代码并构建

```sh
git clone --branch codex-local https://github.com/Kinzca/paperclip.git
cd paperclip
node scripts/local/setup.mjs
```

默认数据根目录是仓库内被 Git 忽略的 `.paperclip-local/`。如需自定义，在本流程所有终端里先设置同一个**绝对路径**：

```sh
export PAPERCLIP_LOCAL_DIR="/你的绝对路径/paperclip-local"
```

`setup.mjs` 安装隔离的发布服务和构建工具，应用固定运行时覆盖，构建宿主 UI、Fork SDK、Wiki 和固定提交的 Office。它不启动服务、不登记插件、不创建公司或任务；再次运行会重建其 node_modules，但保留 home、登录目录和插件数据。已有服务必须先停止再 setup。完整下载可能较大。

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

首次调用官方本机 onboard，默认仅在回环地址 [http://127.0.0.1:3100](http://127.0.0.1:3100) 提供服务，使用嵌入式 PostgreSQL。已有配置则复用该配置。保持此终端运行；Ctrl+C 停止通过此入口启动的服务。官方启动可能执行内置诊断和数据库迁移，不等于此 Fork 已做开发测试或跨机验收。

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

| 路径（相对于数据根目录） | 用途 |
| --- | --- |
| `runtime/` | 固定发布服务，可重新安装 |
| `build-tools/`、`npm-cache/` | 构建工具及缓存，可重新生成 |
| `Agent-Pixels/` | 固定版本 Office 代码与产物 |
| `home/instances/default/` | 配置、数据库、日志、存储和密钥等实例文件，实际路径以 config 为准 |
| `codex/` | 本入口默认 Codex 登录目录，不随 Git 同步 |
| `installation.json` | 发布版本、Office 提交和 Wiki 版本记录，不包含验收结论 |

Wiki 的默认安装包位置是当前 Paperclip 仓库的 `packages/plugins/plugin-llm-wiki`，与存放资料的 Wiki 根目录不同。安装后不要随意移动仓库；需要改位置时按迁移文档重新定位插件登记路径。

`PAPERCLIP_PORT` 用于新实例环境和安装接口；已有服务实际端口以 config 为准。改变 `PAPERCLIP_LOCAL_DIR` 只会指向别的位置，不会搬运旧数据。

## 源码、运行时和数据的边界

- `ui/src/components/SidebarPlugins.tsx` 负责分组；两种侧栏均复用该组件。
- `server/src/services/heartbeat/{queue,run-control,run-preparation,stage-handoff}.ts` 保存阶段交接修复的源码形式。
- 为复用当前已发布服务，安装器使用固定版本 `paperclipai@2026.1023.0`，覆盖自定义 UI，以及 `scripts/local/overlays/stage-handoff/` 内此前部署的三个 JS 文件。运行时覆盖与源码需要在后续升级时一起维护；本轮没有构建完整 TS 服务端，也没有重新验证源码移植。
- `scripts/local/overlays/postgres/` 是同版本上游 `patches/postgres@3.4.9.patch` 的发布运行时形式。npm 安装不会执行 pnpm patchedDependencies，所以安装器补齐此官方补丁。文件包含其他修改或版本不同会停止，不会强行覆盖。
- 阶段交接沿用此前受限扫描恢复方式，并非新增无轮询或休眠安全保证。升级调度器时应另行适配和验证，本轮只保留现有行为。
- 不包含当前电脑的公司、员工、任务、附件、数据库、密钥或 Codex 登录。新电脑默认是全新实例。已有公司需要导入员工模板/重新配置；同一台电脑现有实例中的公司继续使用原数据。若要完整迁移，需通过数据库备份及对应文件存储、加密密钥的安全迁移单独操作，不能只 git pull。

## 后续维护与升级

先停止服务并备份数据及插件文件，再在代码干净、可快进更新的仓库执行：

```sh
git pull --ff-only origin codex-local
node scripts/local/setup.mjs
node scripts/local/start.mjs
```

保持服务运行，第二个终端进入同一仓库，使用相同环境变量：

```sh
node scripts/local/install-office.mjs --upgrade
node scripts/local/install-wiki.mjs --upgrade
```

`--upgrade` 只用于已安装且 package_path 对应当前构建位置的插件，走正式 upgrade 接口，沿用原插件 ID 和配置。未安装则去掉参数；登记位置不同会停止，不会偷偷改旧路径、卸载或清空插件数据。历史手工安装位置需要维护原包目录，或按迁移文档在恢复副本上重新定位后再升级。升级激活插件不等于启动维护 Agent，但已启用的插件事件和作业按现有配置恢复运行。

自定义 UI、SDK 桥、运行时覆盖、Office 固定提交和 Wiki 构建应配套更新，不能只替换其中某部分或直接升级上游服务。保留上游可用 `git remote add upstream https://github.com/paperclipai/paperclip.git`，后续选择性同步。

## 交付证据与未验证范围

先前本地宿主、Office / Wiki 部署已有构建及正式登记记录；最新 Wiki 布局为 0.1.3。本次进一步修改的是安装入口和文档，不能把先前构建通过当成新安装脚本已验收。

按要求不执行 setup、首次安装、升级登记演练、数据库备份恢复、跨电脑安装、跨平台兼容、Agent 任务或浏览器验收。新命令与完整迁移仍由用户检查。必要的插件构建记录在本次交付说明中单独列出。

## 插件侧栏规格统一（待用户检查）

新增 sidebar 的可选 `navigation: { routePath, icon }` 元数据，普通入口由宿主 SidebarNavItem 绘制。Office / Wiki 已分别声明 building-2 / book-open；兼容旧单入口插件的自动页面推导，并保留复杂自绘入口的兼容挂载。详细契约、图标名、退出自动推导的方法和部署顺序见 [侧栏入口规范](doc/plugins/SIDEBAR-NAVIGATION.md)。

本地发布服务通过 `scripts/local/overlays/sidebar-schema/` 获得同样的可选字段校验；不新增数据库迁移或业务权限。宿主和插件需要配套更新。本轮构建不等于验收，仍由用户检查。

## 简体中文／English（待用户检查）

公司菜单底部和个人资料设置新增语言选择；默认按浏览器语言选择中文或英文，使用 `paperclip.ui.locale` 保存到当前浏览器的 localStorage。切换通过 i18next 和组件订阅更新，不重载页面或重建任务。其他同源标签页接收 storage 事件同步；不同电脑或浏览器不会自动同步该偏好。

优先接入侧栏、任务列表及详情、Agent 列表及详情与配置、组织图、公司／个人／实例／插件设置，以及 Office 0.4.0、LLM Wiki 0.1.3 的主要固定界面文案。底层状态码、路由、任务标题与正文、评论、代码、Agent 名称、用户填写的职位和知识库内容均保留原值。后台原始诊断、第三方连接器提供的内容及未接入的次级界面仍可能保留原文，不使用页面文字扫描或机器翻译覆盖用户内容。

固定 UI 资源位于 `ui/src/i18n/messages/{en,zh-CN}-ui.json`，与原有 app 命名空间分开。SDK 前端桥新增 `useHostLocale` / `translateUi`，为插件提供同一语言选择和译文。Office / Wiki 与宿主配套升级，不单独升级到缺少接口的旧宿主。详细维护说明见 [双语界面说明](doc/plugins/UI-LANGUAGE.md)。

本轮只实现、构建、提交和部署，没有运行开发测试、单独类型检查、代码审查、机械设计检测、浏览器或 Agent 任务验收。构建包含生成必需 SDK 产物的 TypeScript 编译。
