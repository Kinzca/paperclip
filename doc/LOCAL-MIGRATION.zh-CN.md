# 本地定制版：安装与迁移

适用范围：`codex/native-workflow-engine` 分支，固定服务 `2026.1023.0`、Office `0.4.0`、Wiki `0.1.3`。新电脑全新安装见 [FORK.md](../FORK.md)。本文的完整迁移使用**逻辑数据库备份 + 文件复制**，目标数据库采用单独启动的 PostgreSQL 18；新装仍可使用安装入口默认的嵌入式 PostgreSQL。

开发主线已统一为 `codex/native-workflow-engine`，旧 `codex-local` 分支停止使用。已有电脑的分支切换见 [FORK.md](../FORK.md#已有电脑切换主线)。本主线另含 `0334`、`0335` 后端迁移；本文的文件 / 数据迁移不等于部署这些源码功能，固定运行时与源码后端升级需分别安排。

按用户要求，本次仅补齐脚本与说明，没有执行备份恢复、另一台电脑安装、接口演练或界面验收。下面是供用户操作的步骤，不是已经通过的迁移记录。

## 选择迁移范围

| 目标 | 做法 |
| --- | --- |
| 新环境、新公司、新员工 | 按 FORK.md 安装，不恢复旧数据 |
| 复用一套组织与员工配置 | 使用 Paperclip 的组织导出 / 导入功能，并重新设置本地路径和授权；组织包不等于全实例备份 |
| 保留原公司、员工、任务、审查记录、附件及 Wiki | 按本文完整迁移；迁移数据库、文件、密钥与配置，不是只 git pull |

不要直接在运行中的数据库目录上复制文件；不同平台或架构也不要直接复用原 PostgreSQL 的 `db/` 数据目录。数据库逻辑备份包含插件命名空间和迁移记录，附件、Wiki 文件及加密主密钥需另外携带。

## 1. 记录旧实例位置，冻结写入

记录旧电脑的：

- Paperclip 仓库分支和提交：`git branch --show-current`、`git rev-parse HEAD`。
- 实际数据根目录和 config.json 位置。脚本默认是 `.paperclip-local/home/instances/default/config.json`；早期手工安装可能使用仓库外的 `paperclip-data/home/instances/default/config.json`。
- 配置中的数据库模式 / 端口、存储目录、日志目录、加密密钥路径；实际值以 config 为准。
- 所有公司的 Wiki 根目录及额外空间位置、Agent 工作目录、项目仓库、指令文件、外部技能目录、本地插件包目录。
- 通过环境变量提供的数据库连接或加密主密钥，以及实例 `.env` 中的配置。无需把这些值打印出来或粘贴到聊天中。

先在旧界面暂停员工与例程、停止正在执行的任务，并暂停插件自动导入和外部写入。确认没有未完成的文件写入，再进入备份窗口。在数据库备份到文件复制完成之间，不进行界面操作或恢复自动工作。旧电脑留作回退，不与新电脑同时运行同一套自动任务。

## 2. 在旧电脑导出数据库

数据库备份时原数据库需要可连接。使用这次新增的本地 CLI 入口，它继承相同的数据配置。以下变量请改为真实**绝对路径**；不使用系统 HOME 作为任务变量。

```sh
export PAPERCLIP_LOCAL_DIR="/旧电脑的绝对路径/paperclip-data"
export MIGRATION_BUNDLE="/旧电脑的绝对路径/paperclip-migration"
mkdir -p "$MIGRATION_BUNDLE/database"
chmod 700 "$MIGRATION_BUNDLE"
node scripts/local/cli.mjs db:backup \
  --dir "$MIGRATION_BUNDLE/database" \
  --filename-prefix paperclip-move --json
```

原来使用默认 `.paperclip-local` 时，可用 `export PAPERCLIP_LOCAL_DIR="$PWD/.paperclip-local"`。如果环境里设置了 `DATABASE_URL`，备份命令会优先使用它：先明确它就是待迁移数据库；否则取消该变量，使用 config 指定的数据库。

记下命令返回的具体 `.sql.gz` 文件路径，后面恢复就使用这一份文件。备份命令可能调用 `pg_dump` 或已有 JavaScript 备份实现，不包含文件存储。保留命令的退出结果；失败时停止迁移，不把空文件当备份。

这是 PG18 数据源时，准备 PG18 客户端可避免旧版 pg_dump 不兼容。本文的新集群步骤也采用 PG18；如果你的源数据库已经升级到别的主版本，先制定对应版本的恢复方案，不照搬此处版本。

## 3. 停服务并复制实例文件、Wiki 和项目

逻辑备份完成后停止旧 Paperclip 服务，确认没有员工或其他程序继续写入。通过本安装入口启动的服务使用 Ctrl+C；若由原手工脚本、launchd 或其他服务管理器启动，使用它自己的停止方式。

复制 home 时排除数据库物理目录，保留配置、文件存储、密钥、运行日志和工作目录：

```sh
mkdir -p "$MIGRATION_BUNDLE/home"
rsync -a --exclude='/instances/default/db/' \
  "$PAPERCLIP_LOCAL_DIR/home/" "$MIGRATION_BUNDLE/home/"
```

上例排除的是默认 `instances/default/db/`。如果实际 embeddedPostgresDataDir 指向 home 内其他位置，增加对应排除项；数据库位于 home 外则本来不会被复制。

另外将第 1 步记录的 home 外文件分别复制到迁移包，保留目录映射清单：

- `storage.localDisk.baseDir` 指向的附件存储；如果已在 home 内，则无需重复。
- 所有 Wiki 根目录（包括 `raw/`、`wiki/`、AGENTS.md、IDEA.md，以及额外空间文件），不能只复制插件 dist。
- 项目仓库的完整工作目录及 `.git`、未提交文件、外部技能和指令文件。git clone 不会带回旧电脑尚未提交的工作。
- `secrets.localEncrypted.keyFilePath` 指向的原密钥；在 home 外必须单独携带。如果密钥来自环境变量，需要通过自己的安全配置渠道重新设置同一密钥。
- home 外的执行工作区、日志或其他业务文件；S3 等外部存储需要保留其资源及重新配置访问权限。

复制时明确记录每个旧绝对路径对应的新位置。不要把 node_modules、构建缓存当作迁移所需数据；新电脑重新安装它们。符号链接会保留旧目标，必须检查它们指向的文件是否另外复制，并在新电脑调整。Codex 登录使用新电脑正常授权，不依赖拷贝 `codex/` 或 `codex-host/`；home 中如果带有员工自己的登录文件，也不要假设其在新电脑仍有效。

迁移包可能包含登录会话、加密密钥和业务数据，应通过你自己的受控或加密传输方式搬运，不要上传到 GitHub。源电脑和迁移包在新电脑通过你的检查前都保留。

## 4. 新电脑拉取、构建，暂不启动 Paperclip

安装 Git、npm、Node.js >= 24.11：

```sh
git clone --branch codex/native-workflow-engine https://github.com/Kinzca/paperclip.git
cd paperclip
export PAPERCLIP_LOCAL_DIR="/新电脑的绝对路径/paperclip-local"
node scripts/local/setup.mjs
```

这一步只准备运行时及宿主 / Office / Wiki 构建，不创建空公司，也不恢复数据库。不要先运行 start 或 install 插件。

将迁移包放到新电脑，设置新的 MIGRATION_BUNDLE 路径。恢复到尚无 home 的新数据根目录；如已有 home，请先保留并改用另一个新目录，不直接覆盖：

```sh
export MIGRATION_BUNDLE="/新电脑的绝对路径/paperclip-migration"
test ! -e "$PAPERCLIP_LOCAL_DIR/home" || { echo '目标已有 home，请使用新的数据根目录。'; exit 1; }
mkdir -p "$PAPERCLIP_LOCAL_DIR/home"
rsync -a "$MIGRATION_BUNDLE/home/" "$PAPERCLIP_LOCAL_DIR/home/"
```

把 home 外的 Wiki、附件、项目等按路径映射分别恢复到新位置。

## 5. 单独准备空 PostgreSQL 18，恢复数据库

本节不启动 Paperclip，避免恢复期间发生自动迁移或任务调度。先在新电脑准备 PostgreSQL **18** 的 `initdb`、`pg_ctl`、`createdb` 和 `psql`，并加入 PATH；这是完整迁移路线的额外前提。不要复制旧电脑的数据库程序。不要以 root 身份运行 initdb。

以下在专用的新目录、新端口创建集群；54329 若已占用，选另一个空闲端口并同步后续命令与连接配置。initdb 的 `-W` 会让你为新集群的 paperclip 用户设置密码。

```sh
export MIGRATION_PGDATA="$PAPERCLIP_LOCAL_DIR/migration-postgres"
test ! -e "$MIGRATION_PGDATA" || { echo '目标集群目录已存在，请停止并保留现场。'; exit 1; }
initdb -D "$MIGRATION_PGDATA" -U paperclip \
  --encoding=UTF8 --locale=C \
  --auth-local=trust --auth-host=scram-sha-256 -W
pg_ctl -D "$MIGRATION_PGDATA" -o "-h 127.0.0.1 -p 54329" \
  -l "$PAPERCLIP_LOCAL_DIR/migration-postgres.log" -w start
createdb -h 127.0.0.1 -p 54329 -U paperclip -W paperclip
```

每条命令成功后再继续。createdb 若提示同名数据库已存在，停止，不使用已有业务数据库。选择第 2 步产生的具体备份文件：

```sh
export DB_BACKUP="$MIGRATION_BUNDLE/database/替换为实际备份文件名.sql.gz"
set -o pipefail
gzip -dc "$DB_BACKUP" | psql -h 127.0.0.1 -p 54329 \
  -U paperclip -W -d paperclip -v ON_ERROR_STOP=1
```

备份可能包含清理原对象的语句，因此只恢复到上面新建的专用空库。任一命令失败时停止，保留原备份和报错，不在正在使用的数据库上反复重放。

## 6. 在启动前调整配置及插件包路径

编辑恢复后的 `home/instances/default/config.json` 和实例 `.env`，保持原身份、密钥及公司数据，至少调整：

| 字段 | 新电脑值 |
| --- | --- |
| `database.mode` | `postgres`（本节使用单独管理的集群） |
| `database.connectionString` | `postgresql://paperclip:<URL编码后的新密码>@127.0.0.1:54329/paperclip`，用自己设置的密码替换占位符 |
| `database.backup.dir` | 新电脑的备份目录 |
| `logging.logDir` | 新电脑日志目录 |
| `storage.localDisk.baseDir` | 恢复后的附件目录 |
| `secrets.localEncrypted.keyFilePath` | 对应原数据库的原密钥在新电脑的位置 |
| `server.host`、`server.port` | 保持本机回环监听，端口与插件命令一致 |

旧 embeddedPostgresDataDir 字段在 postgres 模式不使用。不要顺手删除或重新生成加密主密钥；数据库里的密文需要原密钥。恢复后的密钥文件仅允许本人读取，例如对实际文件执行 `chmod 600`。检查 `.env`、终端 `DATABASE_URL`、`CODEX_HOME` 等是否仍指向旧电脑或其他实例；环境变量可能覆盖配置。配置中含密码，不提交到 Git。

数据库中的本地插件包路径也需要更新。该固定版本的 upgrade 接口只能读取已有 package_path，不支持传入新路径。因此，在**新恢复副本、Paperclip 未启动**时，使用下列有明确插件 key 限制的 SQL 重新定位两项包目录，保留插件 ID、配置和命名空间；这不是通用的在线修改方式。

在新仓库根目录执行，保持 PostgreSQL 运行：

```sh
psql -h 127.0.0.1 -p 54329 -U paperclip -W -d paperclip \
  -v ON_ERROR_STOP=1 \
  -v office_path="$PAPERCLIP_LOCAL_DIR/Agent-Pixels" \
  -v wiki_path="$PWD/packages/plugins/plugin-llm-wiki" <<'SQL'
BEGIN;
UPDATE plugins SET package_path = :'office_path', updated_at = now()
WHERE plugin_key = 'agent-pixels.compat';
UPDATE plugins SET package_path = :'wiki_path', updated_at = now()
WHERE plugin_key = 'paperclipai.plugin-llm-wiki';
COMMIT;
SQL
```

只有旧实例本来安装过的插件会命中；没有安装过的插件后续走首次安装。其他本地插件须逐项维护路径，不批量替换数据库所有字符串。不要为了修路径卸载并 purge 插件。

## 7. 登录、启动并通过正式接口升级

```sh
node scripts/local/codex.mjs login
node scripts/local/start.mjs
```

新终端进入同一仓库，设置相同数据根目录和实际服务端口：

```sh
export PAPERCLIP_LOCAL_DIR="/新电脑的绝对路径/paperclip-local"
export PAPERCLIP_PORT=3100
node scripts/local/install-office.mjs --upgrade
node scripts/local/install-wiki.mjs --upgrade
```

原实例没安装过的插件去掉 `--upgrade`。认证实例请用管理员界面完成对应操作。不要把接口返回 ready 当作功能验收。

这两个命令会激活对应插件，请保持旧实例的自动导入、例程和员工暂停，先完成路径调整：

- Wiki → 设置：把 Wiki 根目录与每个额外空间指向恢复后的资料位置。已存在资料使用原目录，修复 / 初始化会保留已有文件；不要选择空目录当作迁移完成。
- Agent：更新工作目录、指令文件和环境中的绝对路径，重新完成员工实际使用的 Codex 连接或独立登录授权。
- 项目 / 工作空间：重新定位本地仓库及外部文件。历史执行工作区中的路径不会自动重写，不存在的旧工作区需要手动处理或为后续任务建立新工作区。
- Wiki Maintainer：只有 Codex 订阅时，确认使用 codex_local，而非上游默认 claude_local；原公司设置正常则继续沿用，不重新创建维护员。
- 其他插件、技能、外部存储及连接：逐项检查新机器路径、授权和可达性。浏览器语言偏好需在新电脑重新选择。

此迁移路线使用外部 PostgreSQL，今后启动 Paperclip 前，需要用自己的服务管理方式启动该集群，例如执行第 5 步的 pg_ctl start 命令。Paperclip 不负责自动启动 postgres 模式的数据库；不要同时启动另一个占用54329端口的嵌入式实例。

## 8. 用户检查与回退

由你检查公司、员工、任务 / 审查记录、附件、Wiki 目录及正文、编辑保存、Office 状态和 Codex 授权。记录仍指向旧路径的项目。检查完成后再逐项恢复员工、例程、插件事件和外部连接，并自行选择一项任务检查执行与审查。

若不符合预期，停止新 Paperclip，必要时停止新集群：

```sh
pg_ctl -D "$MIGRATION_PGDATA" -w stop
```

保留新电脑副本供排查，回到原电脑的原目录启动原实例。原电脑在迁移期间保持冻结；新电脑产生的新任务或文件不会自动合并回去。不要在新电脑通过检查前删除旧电脑数据和迁移包。
