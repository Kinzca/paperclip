# Paperclip 本地定制版

此 Fork 基于官方 `v2026.1023.0`，定制分支是 **codex-local**。为保持现有本地实例兼容，不直接追随上游 master 升级。

## 本次改动

- 侧栏新增可折叠的 Plugins 分组，复用原生分组、字体和间距。插件 sidebar 插槽和 sidebar launcher 从 Work 移入该组；没有插件入口时隐藏分组。主界面顺序为 Work → Org → Plugins → Agents。原有 sidebarPanel 扩展保留原位置。
- Office 来自 [Kinzca/Agent-Pixels](https://github.com/Kinzca/Agent-Pixels)，固定在 `5b0a435a288cd7164b2d79aeb5aa84006ed2ce6e`（0.3.4）。去掉页面内重复标题、徽标、说明，将刷新状态移到任务工具栏旁。保留自动刷新、防闪烁画布、任务摘要和真实流程状态。
- 将此前本地的阶段交接修复纳入版本管理：环境暂未释放时保存交接回执，释放后重新进入原队列，按公司、任务、负责人和完整阶段快照复核，过期回执取消。没有增加新的权限或数据库结构。

按用户要求，此次只实现、构建、部署并交付，**未执行测试、类型检查、代码审查、设计检测或浏览器验收**。源码移植、跨电脑安装、不同平台和完整双 Agent 闭环均等待用户检查；构建完成不表示验收通过。

构建兼容处理：该官方标签引用了未包含在 Git 仓库中的公告动画示例；此 Fork 从同版本已发布 UI 中恢复原示例到 `ui/src/lib/fixtures/announcement-animation.html`，不依赖外部缺失路径。同时让 service worker 构建钩子在构建提前失败时保留原始错误，避免被缺失产物错误遮盖。

## 在另一台电脑安装

前提：Git、npm、Node.js >= 24.11；当前提供终端安装入口，适用于 macOS / Linux。Windows 可用 WSL2，但本轮未做跨平台验证。使用包内嵌入式 PostgreSQL；不用配置 GPT API Key。

```sh
git clone --branch codex-local https://github.com/Kinzca/paperclip.git
cd paperclip
node scripts/local/setup.mjs
```

安装内容默认位于仓库内被 Git 忽略的 `.paperclip-local/`：发布版服务、构建工具、Office 仓库、Codex 登录目录、本地配置与数据库。完整依赖下载可能较大。`setup.mjs` 固定 pnpm 9.15.4 和发布版 npm lock，构建 UI，再按版本及哈希应用运行时覆盖；不会创建公司、员工或任务，也不运行测试。再次 setup 会重建其隔离的 node_modules，但保留 home 数据及 codex 登录目录。

在新电脑用你自己的订阅登录 Codex：

```sh
node scripts/local/codex.mjs login
# 没有本机浏览器时可使用：
# node scripts/local/codex.mjs login --device-auth
node scripts/local/start.mjs
```

Codex 登录保存在 `.paperclip-local/codex/`。已登录桌面应用不等于此独立 CLI 目录自动完成登录，需要上述一次授权；不必购买 API。也可以为登录命令和启动命令设置同一 `CODEX_HOME`，复用你已配置好的 Codex CLI 目录。启动入口移除继承的 `OPENAI_API_KEY`，其余登录交给 Codex 正常处理，不复制或上传凭据。

首次启动调用官方本机 quickstart，仅监听回环地址，默认访问 [http://127.0.0.1:3100](http://127.0.0.1:3100)。服务启动本身会执行官方内置的配置诊断；这与本轮未运行的开发测试、代码审查和功能验收不同。保持该终端运行，在第二个终端进入同一仓库：

```sh
node scripts/local/install-office.mjs
```

此命令通过正式本机安装接口登记 Office。若宿主通过 `PAPERCLIP_HIDDEN_SETTINGS` 隐藏 `instance.plugins`，需要由该实例的配置管理者开放插件管理；独立本机默认配置不设置此限制。新增权限按界面正常批准。此安装命令供首次安装使用，已安装同标识插件的实例请走原生升级入口，不要重复安装或清除插件数据。之后新建公司、配置该公司的 Codex Agent，即可在 Plugins → Office 进入界面。

自定义数据位置：在 setup、登录、启动、安装 Office 时始终设置同一个绝对路径 `PAPERCLIP_LOCAL_DIR`。改变位置不会迁移已有数据。`PAPERCLIP_PORT` 供新实例初始端口和插件安装脚本使用，已有实例端口以其配置为准。

## 源码、运行时和数据的边界

- `ui/src/components/SidebarPlugins.tsx` 负责分组；两种侧栏均复用该组件。
- `server/src/services/heartbeat/{queue,run-control,run-preparation,stage-handoff}.ts` 保存阶段交接修复的源码形式。
- 为复用当前已发布服务，安装器使用固定版本 `paperclipai@2026.1023.0`，覆盖自定义 UI，以及 `scripts/local/overlays/stage-handoff/` 内此前部署的三个 JS 文件。运行时覆盖与源码需要在后续升级时一起维护；本轮没有构建完整 TS 服务端，也没有重新验证源码移植。
- `scripts/local/overlays/postgres/` 是同版本上游 `patches/postgres@3.4.9.patch` 的发布运行时形式。npm 安装不会执行 pnpm patchedDependencies，所以安装器补齐此官方补丁。文件包含其他修改或版本不同会停止，不会强行覆盖。
- 阶段交接沿用此前受限扫描恢复方式，并非新增无轮询或休眠安全保证。升级调度器时应另行适配和验证，本轮只保留现有行为。
- 不包含当前电脑的公司、员工、任务、附件、数据库、密钥或 Codex 登录。新电脑默认是全新实例。已有公司需要导入员工模板/重新配置；同一台电脑现有实例中的公司继续使用原数据。若要完整迁移，需通过数据库备份及对应文件存储、加密密钥的安全迁移单独操作，不能只 git pull。

## 后续维护

```sh
git pull --ff-only origin codex-local
node scripts/local/setup.mjs
```

更新前停止此安装入口启动的服务，并备份本地数据库与文件。不要在生产运行期间直接重建 node_modules。自定义 UI、运行时覆盖、Office 固定提交及 release lock 共同构成本地版本，不能只替换其中某一部分升级上游。

保留上游：`git remote add upstream https://github.com/paperclipai/paperclip.git`，后续按需要选择性同步。官方文档和原始 README 保留；本文件只描述定制范围及安装方式。

## 插件侧栏规格统一（待用户检查）

新增 sidebar 的可选 `navigation: { routePath, icon }` 元数据，普通入口由宿主 SidebarNavItem 绘制。Office / Wiki 已分别声明 building-2 / book-open；兼容旧单入口插件的自动页面推导，并保留复杂自绘入口的兼容挂载。详细契约、图标名、退出自动推导的方法和部署顺序见 [侧栏入口规范](doc/plugins/SIDEBAR-NAVIGATION.md)。

本地发布服务通过 `scripts/local/overlays/sidebar-schema/` 获得同样的可选字段校验；不新增数据库迁移或业务权限。宿主和插件需要配套更新。本轮构建不等于验收，仍由用户检查。
