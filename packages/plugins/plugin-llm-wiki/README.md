# LLM Wiki

Local-file LLM Wiki plugin for source ingestion, wiki browsing, query, lint, and maintenance workflows.

## 本 Fork 的界面布局（0.1.3）

Wiki 保留 Paperclip 主侧栏，目录嵌在内容区左侧，文档和工具页面位于右侧。
本 Fork 不再注册接管主侧栏的 `routeSidebar` 插槽；原导出仅保留兼容性。
空间创建、切换、归档、目录展开状态、文档编辑与自动保存、查询、导入、历史和设置仍沿用原有功能及数据接口。
窄内容区可通过“显示 Wiki 目录”展开目录，选择页面后收起；工具页面按可用内容宽度调整布局。
文档标题、正文、路径及 Agent 名称保留原文，界面随宿主切换简体中文或 English。

部署需要同时更新宿主前端与插件：宿主为 Wiki 提供完整内容区高度及新增界面文案；
插件升级后才会移除旧的 `routeSidebar` 注册。保留原插件 ID、配置和 Wiki 根目录，使用正式 upgrade 接口更新。
按用户要求，此次只做必要构建和部署，没有运行测试、独立类型检查、界面验收或 Agent 执行流程。

## 后台批处理（0.1.5；兼容0.1.4队列）

每家公司独立选择业务项目，通过 `configure-background` action 启用，默认关闭。
`background-status` data 返回策略、持久队列、活动批次及最近回执；`background-tick` action 使用真实时钟执行同一门槛检查，不能绕过检查。

- 只采集启用后完成的业务总任务；子任务不会单独派发，整棵子树结束后合并已完成任务的描述、评论及文档。插件自身操作不进入业务队列。
- 插件宿主每 5 分钟执行程序检查；完成后先等待 5 分钟安静窗口，再合并最多 3 个总任务、24,000 字符。业务任务已完成，不等待 Wiki。
- 本公司仍有 todo / in_progress 业务任务时延后派发。已启动的后台运行不抢占取消，最多 600 秒；单公司单批次、每日最多 6 次模型任务。
- 先做长度/结论标志筛选、重复正文与时间戳归一化、SHA-256 去重。同公司已处理的相同内容不重复调用模型；语义相似但措辞不同的内容由维护员合并到已有页。
- 凌晨 03:00（默认 Asia/Shanghai）以后，若知识内容哈希改变，最多执行一次增量维护；未变化只记录程序检查结果。旧托管例程继续暂停，避免双重触发。
- 原始来源位于 `raw/background/<root>/<hash>.md`，不可覆盖。必须通过 `wiki_background_complete` 校验实际变更/来源或具体无需修改原因后，再完成后台任务并推进来源游标。
- 单来源最多 50 项任务、每项 25 份文档；任务或文档数量超限仍标记 needs_review，不调用模型、不跳过游标。正文超出单批字符窗口时按来源和字符位置连续分窗，保留原始排版，不丢弃剩余内容；每窗使用独立不可变 raw 路径。只在任务完成且插件已接收该窗回执后保存下一游标，最后一窗完成前原总任务来源保持 pending。失败最多两次尝试、间隔 30 分钟，之后人工检查。无新内容的程序检查不创建 Agent 任务。
- `background-status` 的 `blockedRoots` 返回最多25项待处理来源的任务ID和原因。升级分窗处理后，可通过操作员 action `resume-background-sources` 提交 `{"rootIssueIds":["总任务UUID"]}`，只将本公司所选 needs_review 来源放回 pending；不重置失败尝试、已处理游标或不可变来源，不唤醒模型。实际派发仍遵守原批次、每日上限、开发优先、暂停及公司权限。
- 重启保留队列与批次，使用稳定 originId 找回已有任务，避免重复。若派发结果不明且 15 分钟仍找不到任务，记录失败并进入有界重试。

`waitForBusinessIdle` 默认为 `true`，保留开发任务优先的行为。对于持续有内容待办的公司，可按公司显式设为 `false`：只要求目标总任务及其子树结束，不等待公司所有待办清空；仍保留维护员忙碌检查、单批次、安静窗口及预算上限。该选项不改变其他公司的策略。

启用例（通过正式插件 action，外层必须携带相同 companyId）：

```json
{"policy":{"enabled":true,"projectIds":["业务项目UUID"],"quietMinutes":5,"maxRootsPerBatch":3,"maxCharacters":24000,"maxRunsPerDay":6,"maintenanceHour":3,"timezone":"Asia/Shanghai"}}
```

维护员需要现有 Wiki 工具权限和新增的 `wiki_background_batch` / `wiki_background_complete` 两项工具。沿用公司权限、预算、暂停及 public 部署自动写入限制。停用策略不会取消已经启动的批次。此队列存储在插件数据库迁移 004 中，升级前备份，不能仅回退代码。

## Scope

This package is the standalone home for LLM Wiki behavior. Wiki-specific routes,
UI, prompts, tools, local-folder templates, migrations, fixtures, and tests live
here rather than in Paperclip core.

The alpha surface includes:

- manifest-declared Wiki page, sidebar entry, and settings page
- trusted local folder declaration for `raw/`, `wiki/`, `AGENTS.md`, `IDEA.md`, `wiki/index.md`, and `wiki/log.md`
- plugin database namespace migration for wiki instances, sources, pages, operations, query sessions, and resource bindings
- managed `Wiki Maintainer` agent, managed `LLM Wiki` project, and paused managed routines for wiki update processing, lint, and index refresh
- plugin-operation issue creation using `surfaceVisibility: "plugin_operation"`
- local source capture into `raw/` with metadata rows in the plugin DB namespace
- opt-in company-scoped Paperclip event ingestion controls for issues, comments, and documents; event ingestion is disabled by default and routes captured raw provenance into the default space only
- manual Paperclip project/root issue distillation and bounded backfill actions with explicit work items, operation issues, source caps, and estimated cost recording
- Paperclip-derived distillation (cursor windows, manual `distill-now`, backfill) always writes into the default wiki space in Phase 1; non-default spaces remain on manual / raw-file ingest until per-space Paperclip ingestion profiles ship
- Paperclip-derived distillation maintains `wiki/projects/<slug>/standup.md` as the executive current-state view for each represented project, alongside durable `wiki/projects/<slug>/index.md` knowledge pages
- wiki page writes with plugin path validation, atomic local-folder writes, metadata/revision rows, backlink extraction, and optional stale-hash protection
- wiki tools for search/read/write/propose patch/source/log/index/backlinks workflows

## Phase 5 Security Gate

Paperclip-derived text ingestion stays limited to issue titles/descriptions, issue comments, and issue documents.

- Issue attachments/assets are **metadata-only** in Phase 5.
- Issue work products are **metadata-only** in Phase 5.
- The wiki must not fetch `/api/assets/:id/content`, dereference work-product `url` fields, or store those capability-bearing links in source bundles/snapshots.

The accepted policy lives in [doc/plans/2026-05-06-llm-wiki-paperclip-asset-security-gate.md](../../../doc/plans/2026-05-06-llm-wiki-paperclip-asset-security-gate.md).

## Development

```bash
pnpm install
pnpm dev            # watch builds
pnpm dev:ui         # local dev server with hot-reload events
pnpm test
```

From the Paperclip repo root:

```bash
pnpm --filter @paperclipai/plugin-llm-wiki typecheck
pnpm --filter @paperclipai/plugin-llm-wiki test
pnpm --filter @paperclipai/plugin-llm-wiki build
```

## Alpha Verification

Run these commands from the Paperclip repo root before handing off alpha plugin
changes:

```bash
pnpm --filter @paperclipai/plugin-llm-wiki typecheck
pnpm --filter @paperclipai/plugin-llm-wiki test
pnpm --filter @paperclipai/plugin-llm-wiki build
```

The focused Vitest suite covers:

- standalone package boundaries and package-local harness dependencies
- required local folder bootstrap writes
- raw source capture plus ingest metadata persistence
- hidden plugin-operation issue creation for ingest/query/file-as-page workflows
- disabled and enabled Paperclip event ingestion paths
- managed routine declarations, manual distill/backfill work items, source cap handling, and backfill project/date scoping
- atomic page writes, metadata/revision rows, backlinks, and stale-hash refusal
- query session creation, run-id recording, stream event forwarding, and completion updates
- filing a streamed query answer back into the wiki through a hidden operation

Remaining alpha gaps:

- Browser screenshot capture is maintained separately under `tests/screenshots`;
  generated `screenshots/` outputs are local artifacts and are ignored by git.
- Host-level plugin install and live agent invocation still need Paperclip
  server/runtime smoke coverage when preparing a release candidate.



## Install Into Paperclip

```bash
curl -X POST http://127.0.0.1:3100/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"packageName":"/Users/dotta/paperclip/.paperclip/worktrees/PAP-3179-design-a-llm-wiki-plugin/packages/plugins/plugin-llm-wiki","isLocalPath":true}'
```

## Build Options

- `pnpm build` uses esbuild presets from `@paperclipai/plugin-sdk/bundlers`.
- `pnpm build:rollup` uses rollup presets from the same SDK.

After changing manifest-loaded assets such as skills, agent instructions, or
templates, recompile the local plugin before re-enabling it:

```bash
pnpm --filter @paperclipai/plugin-llm-wiki build
```

The package-local `dist/` directory is ignored by git, but local Paperclip
installs load the compiled `dist/manifest.js` and `dist/worker.js` files at
runtime. If activation failed before the rebuild, re-enable the plugin or
restart the Paperclip dev server so the host imports the fresh bundle.

## Local File Layout

```text
<configured-wiki-root>/
  AGENTS.md
  IDEA.md
  .gitignore
  raw/
    .gitkeep
  wiki/
    index.md
    log.md
    sources/
      .gitkeep
    projects/
      .gitkeep
      <project-slug>/
        index.md
        standup.md
        decisions.md
        history.md
    entities/
      .gitkeep
    concepts/
      .gitkeep
    synthesis/
      .gitkeep
```

Use the settings page or `bootstrap-root` action to configure the folder and
write the starter files. The plugin uses Paperclip's local folder API for path
containment, symlink checks, read/write validation, and atomic writes.

Bootstrap preserves existing files rather than overwriting operator edits. The
default first-install skeleton is copied from the vanilla LLM Wiki layout, with
`CLAUDE.md` renamed to `AGENTS.md` and Paperclip project overviews, standups,
decisions, and history kept together under `wiki/projects/<slug>/`.

## Managed Agent Instructions

Plugin-managed agent instruction bundles live under:

```text
agents/<agent-key>/AGENTS.md
```

For this plugin the Wiki Maintainer source bundle is `agents/wiki-maintainer/AGENTS.md`.
Any additional files in that folder are installed as sibling instruction files
for the managed agent. The settings health check reports drift from these
defaults, and resetting the managed agent asks for confirmation before replacing
customized instructions.
