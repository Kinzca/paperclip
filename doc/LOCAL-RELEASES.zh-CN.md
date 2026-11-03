# 本地安装、升级与回退

适用于 `codex/native-workflow-engine`。同一版本以 **完整 Git 提交 SHA + 发布清单** 标识，不以分支名或 UI 上的 npm 版本号标识。拉取代码、构建、切换运行版本、数据库迁移是不同步骤。

## 前提和版本边界

安装 Git、npm 和 **Node.js 24.22.2**。脚本固定 pnpm 9.15.4，并使用已提交的两个锁文件。Windows 可使用原来的 `.paperclip-local/node-v24.22.2-win-x64/node.exe`，或 PATH 中的同版本 Node；旧稀疏检出必须先运行 `git sparse-checkout disable`，取得 server、skills、cli 等完整目录。

当前提交的 server、db、shared、插件 SDK、UI 和 Wiki 从源码构建，Office 固定为 `a3fff4a71eeca595572decfdca7adffeadd26a85`。runner、原生二进制、适配器和 CLI 使用锁定的 `paperclipai@2026.1023.0` 依赖套件；这不是对上游所有组件的全量源码编译。后续修改这些组件时，应同步调整构建器和依赖套件，不能仅修改源码就声称运行时已接入。

不同电脑应使用同一提交和工具链，在各自平台构建。不要跨平台复制 node_modules、PostgreSQL 程序或 releases。清单记录平台、工具版本、插件版本、SQL 哈希与产物哈希；同一逻辑版本不保证不同平台的构建字节完全一致。

以下命令在仓库根目录执行。示例为 Bash；Windows PowerShell 设置变量用 `$env:PAPERCLIP_LOCAL_DIR='D:\数据\paperclip-local'`。`node` 必须指向上述固定版本。默认数据目录为 `.paperclip-local`，自定义时每个终端保持一致：

```sh
export PAPERCLIP_LOCAL_DIR="/你的绝对路径/paperclip-local"
export PAPERCLIP_PORT=3100
```

原有自定义 `CODEX_HOME` 继续沿用；不要把登录、密钥、数据库或 Wiki 资料提交到 Git。

## 新电脑：安装同一版本

在旧电脑执行 `node scripts/local/status.mjs`，记录**当前运行版本清单中的完整 commit**。仓库 HEAD 可能已更新，不一定等于运行版本。

```sh
git clone --branch codex/native-workflow-engine https://github.com/Kinzca/paperclip.git
cd paperclip
# 用 status 输出的完整提交替换占位符；复现旧版本时使用临时 detached 检出。
git checkout --detach <完整提交SHA>
node scripts/local/setup.mjs
node scripts/local/status.mjs
node scripts/local/codex.mjs login
node scripts/local/start.mjs
```

`setup` 要求已跟踪文件没有未提交修改，构建到 `releases/<SHA前12位>`，不覆盖已有版本。空实例会记录初始版本；它不创建公司、员工、任务，也不启动 Agent。`start` 首次调用本机 onboard 初始化配置与数据库，之后直接启动对应源码后端。停止服务使用 Ctrl+C。

服务运行后，在相同环境的第二个终端首次登记插件：

```sh
node scripts/local/install-office.mjs
node scripts/local/install-wiki.mjs
```

这两个命令使用本机正式管理接口。认证实例需在管理员界面登记。公司、成员、Wiki 根目录与 Codex 适配器仍由用户配置；详情见 [FORK.md](../FORK.md)。要保留原数据，按[迁移步骤](LOCAL-MIGRATION.zh-CN.md)，不要先初始化空公司再覆盖。

Windows 的 `Setup-Paperclip.cmd`、`Login-Codex.cmd`、`Start-Paperclip.cmd` 是同一脚本的快捷入口，支持自定义数据目录与 CODEX_HOME。

## 现有手工安装：一次性接管

先暂停业务写入并正常停止原服务。保留原目录及启动脚本，记录实际后端提交；不要凭仓库 HEAD 推断。

```sh
node scripts/local/adopt.mjs \
  --runtime /原发布包根目录 \
  --commit <原后端完整提交SHA> \
  --office /原Office包目录 \
  --wiki /原Wiki包目录
node scripts/local/status.mjs
```

runtime 根目录必须包含 `node_modules/@paperclipai/server/dist/build-info.json`，其提交与参数一致；配置位于该数据根目录的 `home/instances/default/config.json`。接管会复制代码产物、检查当前数据库迁移、保留插件登记路径，并标记 `legacy: true`。该记录仅证明接管时的产物，不把旧包冒充成新构建器产出的可复现版本。不复制或改变 Codex 登录、公司资料与 Wiki 正文。已有新版本指针时拒绝重复接管。

## 日常升级

先暂停员工、例程和其他业务写入，并正常停止服务。若是系统服务管理器启动，还需停止它的自动重启。脚本检查 HTTP 端口空闲及独占部署锁；它不能停止其他电脑对外部数据库的写入。

```sh
git status --short
git switch codex/native-workflow-engine
git pull --ff-only origin codex/native-workflow-engine
node scripts/local/setup.mjs --prepare-only
node scripts/local/status.mjs
# 使用 setup 输出的确切版本号，例：12位提交SHA
node scripts/local/upgrade.mjs --to <目标版本号>
node scripts/local/start.mjs
```

升级依次检查当前插件无未记录修改、保存逻辑数据库备份及配置／插件代码检查点、应用目标数据库迁移、更新两项托管插件文件、原子切换 `current.json`。数据库步骤失败时不切换；留下 `pending-deployment.json` 后禁止直接启动。定位报错后，对同一版本重试原 upgrade 命令，它会继续完成该部署，不覆盖原备份。

启动确认后端返回目标提交后，通过正式接口重新加载已安装且 ready 的 Office / Wiki。不会登记缺失插件或激活暂停的插件；非 ready 状态保留待同步标记。认证实例自动接口被拒绝时，服务仍运行，由管理员在界面升级对应插件。保留原插件 ID、配置与资料路径。

若构建中断，保留日志，将对应 `.building-<版本>` 目录移到其他位置后重试；成功版本目录不可原地覆盖。构建期间不要编辑源码。旧目录、备份和历史发布包不自动清理。

## 回退

停止服务后：

```sh
node scripts/local/rollback.mjs
# 或指定已保留的旧版本
node scripts/local/rollback.mjs --to <旧版本号>
node scripts/local/start.mjs
```

只有宿主数据库迁移清单与插件迁移文件都相同，才允许直接回退代码。回退前也会备份，并检查插件是否存在未保存的改动。它不会撤销新版本产生的任务或 Wiki 内容；这是代码回退，不是业务数据还原。

若升级增加或改变了数据库迁移，脚本会拒绝代码回退。使用检查点里的 `.sql.gz`、升级前配置、原密钥和对应文件备份，按[迁移文档](LOCAL-MIGRATION.zh-CN.md)恢复到**独立数据根目录及空数据库**，配套旧版本。不要覆盖当前库，不自动执行降级 SQL。检查点中的配置和 SQL 含业务数据／密钥引用，仅本地保管。附件、Wiki、项目文件不在数据库检查点中，完整恢复还需要另外备份这些目录。

## 状态、目录和默认额度

`node scripts/local/status.mjs` 显示实际选定版本、上一版本、待完成操作和检查点。`release.json` 记录精确提交及构建来源；`current.json` 是本机选择，不提交到 Git。

| 数据根目录中的路径                                   | 内容                                         |
| ---------------------------------------------------- | -------------------------------------------- |
| `releases/<版本>/`                                   | 独立后端、UI、插件包和 release.json          |
| `current.json`                                       | 当前／上一版本、数据库迁移清单、插件实际路径 |
| `checkpoints/`                                       | 升级／回退前数据库备份、配置和插件代码       |
| `pending-deployment.json`                            | 中断的部署记录；完成前禁止启动               |
| `dependency-kits/`、`build-tools/`、`build-sources/` | 锁定依赖缓存、工具和隔离 Office 源码         |
| `plugins/office`、`plugins/wiki`                     | 新装时的稳定插件路径；接管使用原实际路径     |
| `home/`、`codex/`                                    | 实例数据和默认 CLI 登录；不会随版本切换重建  |

工作流平台出厂默认是**每阶段 5 次、累计执行 180 分钟、同时 2 个阶段**，人工验收等待停表；人工追加额度和无效循环识别见[运行控制说明](WORKFLOW-RUNTIME-CONTROLS.zh-CN.md)。已有平台／公司／项目设置与运行快照继续沿用，升级脚本不强行改写为出厂值。

工程检查、构建、迁移状态和服务健康只说明对应步骤完成。另一台电脑安装、跨平台恢复、页面与真实 Agent 工作流仍由用户验收。
