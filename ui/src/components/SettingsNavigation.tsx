import { useState, type ReactNode } from "react";
import { Archive, Building2, Database, FolderOpen, History, Layers, ChevronRight, type LucideIcon } from "lucide-react";
import { Link } from "@/lib/router";
import { Input } from "@/components/ui/input";
import { useHiddenSettings } from "@/hooks/useHiddenSettings";
import { uiText, useUiLocale } from "@/i18n/ui";

export interface SettingsDestination {
  title: string;
  description: string;
  path: string;
  keywords?: string;
  hiddenSetting?: string;
  icon?: LucideIcon;
}

export const generalSettingsLinks: SettingsDestination[] = [
  { title: "Agent rules", description: "Shared instructions and AI assistance.", path: "/company/settings/agent-rules", keywords: "智能体 指令 提示词 决策 快速响应" },
  { title: "Storage", description: "Review usage, backups and cleanup.", path: "/company/settings/instance/storage", keywords: "存储 占用 清理 备份" },
  { title: "Members and permissions", description: "Manage people, hiring and interaction policies.", path: "/company/settings/members", hiddenSetting: "company.members" },
  { title: "Privacy and data", description: "Log privacy and AI feedback sharing.", path: "/company/settings/general/privacy", keywords: "隐私 日志 数据 分享" },
  { title: "Deployment and auth", description: "Inspect deployment mode and authentication status.", path: "/company/settings/general/deployment", hiddenSetting: "instance.general.deploymentStatus", keywords: "高级 部署 认证" },
  { title: "Organization management", description: "Manage the organization lifecycle.", path: "/company/settings/general/organization", keywords: "归档 组织 管理" },
];

export const agentRulesLinks: SettingsDestination[] = [
  { title: "Shared instructions", description: "Edit global rules and organization additions.", path: "/company/settings/agent-rules/instructions", keywords: "规则 智能体 提示词 全局 指令" },
  { title: "AI assistance", description: "Configure decision models and fast responses.", path: "/company/settings/agent-rules/ai", keywords: "模型 AI 决策 快速响应 连接 connections" },
];

export const storageSettingsLinks: SettingsDestination[] = [
  { icon: Database, title: "Database backups", description: "Manage restore points, retention and old backups.", path: "/company/settings/instance/storage/database-backups", keywords: "数据库 备份 清理" },
  { icon: Layers, title: "Program releases", description: "Review installed versions and remove unused historical releases.", path: "/company/settings/instance/storage/program-releases", keywords: "程序 版本 清理" },
  { icon: History, title: "Upgrade checkpoints", description: "Review pre-upgrade recovery files and choose which checkpoints to retain.", path: "/company/settings/instance/storage/upgrade-checkpoints", keywords: "升级 检查点 回退 清理" },
  { icon: Building2, title: "Company and project space", description: "Inspect local directories by company and project, with cleanup protection levels.", path: "/company/settings/instance/storage/project-space" },
  { icon: Archive, title: "Archived chats", description: "Review, restore or permanently delete individual archived conversations.", path: "/company/settings/instance/storage/archived-chats" },
  { icon: FolderOpen, title: "Managed workspaces", description: "Inspect workspaces and their tasks before deciding what to retain.", path: "/company/settings/instance/storage/workspaces" },
];

const searchableSettings = [...generalSettingsLinks, ...agentRulesLinks, ...storageSettingsLinks,
  { title: "Profile", description: "Manage your personal profile.", path: "/company/settings/instance/profile", hiddenSetting: "instance.profile" },
  { title: "Secrets", description: "Manage organization secrets.", path: "/company/settings/secrets", hiddenSetting: "company.secrets" },
  { title: "Environments", description: "Manage execution environments.", path: "/company/settings/instance/environments", hiddenSetting: "instance.environments" },
  { title: "Access", description: "Manage instance access.", path: "/company/settings/instance/access", hiddenSetting: "instance.access" },
  { title: "Plugins", description: "Manage installed plugins.", path: "/company/settings/instance/plugins", hiddenSetting: "instance.plugins" },
  { title: "Experimental", description: "Manage experimental features.", path: "/company/settings/instance/experimental", hiddenSetting: "instance.experimental" },
  { title: "Backup retention", description: "Choose how long automatic backups are kept.", path: "/company/settings/instance/storage/database-backups/retention", hiddenSetting: "instance.general.backupRetention", keywords: "数据库 备份 保留 策略" },
  { title: "Hiring and interaction policies", description: "Configure hiring approvals and who can resolve requests.", path: "/company/settings/members/policies", hiddenSetting: "company.members" },
];

/** Search only fixed settings destinations; business content is never translated or searched here. */
export function SettingsNavigation({ items, children }: { items: readonly SettingsDestination[]; children?: ReactNode }) {
  useUiLocale();
  const { hidden } = useHiddenSettings();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const visible = (needle ? searchableSettings : items).filter(item =>
    (!item.hiddenSetting || !hidden.has(item.hiddenSetting)) && (!needle ||
      [item.title, item.description, uiText(item.title), uiText(item.description), item.keywords ?? ""].join(" ").toLocaleLowerCase().includes(needle)));
  return <section className="flex flex-col gap-4">
    <Input value={query} onChange={event => setQuery(event.target.value)} type="search"
      placeholder={uiText("Search settings…")} aria-label={uiText("Search settings")} />
    {!needle && children}
    <nav aria-label={uiText(needle ? "Settings search results" : "Related settings")} className="divide-y rounded-xl border border-border">
      {visible.map(item => <Link key={item.path} to={item.path} className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {item.icon && <item.icon className="size-5 shrink-0 text-muted-foreground" />}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-medium">{uiText(item.title)}</span>
          <span className="text-sm text-muted-foreground">{uiText(item.description)}</span>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>)}
      {!visible.length && <p role="status" className="px-4 py-4 text-sm text-muted-foreground">{uiText("No matching settings. Try another keyword.")}</p>}
    </nav>
  </section>;
}
