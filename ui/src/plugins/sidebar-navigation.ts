import {
  Activity, Bell, BookOpen, Bot, Boxes, Building2, Calendar, ChartNoAxesCombined,
  Database, FileText, FolderOpen, GitBranch, Globe, LayoutDashboard, MessageSquare,
  Puzzle, Search, Settings, Shield, Terminal, Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ResolvedPluginSlot } from "./slots";
import { isGlobalPath, normalizeCompanyPrefix } from "@/lib/company-routes";

/** 通用路由无法识别动态插件路径；仅给已注册的插件页面补上当前公司前缀。 */
export function pluginSidebarHref(
  target: string,
  companyPrefix: string | null | undefined,
  slots: ReadonlyArray<Pick<ResolvedPluginSlot, "type" | "routePath">>,
): string {
  const pathname = target.split(/[?#]/, 1)[0]!;
  if (!companyPrefix || !target.startsWith("/") || target.startsWith("//") || isGlobalPath(pathname)) return target;
  const root = target.slice(1).split(/[/?#]/, 1)[0];
  if (!slots.some(slot => slot.type === "page" && slot.routePath === root)) return target;
  return `/${normalizeCompanyPrefix(companyPrefix)}${target}`;
}

const icons: Record<string, LucideIcon> = {
  activity: Activity, bell: Bell, "book-open": BookOpen, bot: Bot, boxes: Boxes,
  "building-2": Building2, calendar: Calendar, "chart-no-axes-combined": ChartNoAxesCombined,
  database: Database, "file-text": FileText, "folder-open": FolderOpen, "git-branch": GitBranch,
  globe: Globe, "layout-dashboard": LayoutDashboard, "message-square": MessageSquare,
  puzzle: Puzzle, search: Search, settings: Settings, shield: Shield, terminal: Terminal, users: Users,
};

export function pluginSidebarIcon(name?: string) {
  return name ? icons[name] ?? Puzzle : Puzzle;
}

/** 只在路径明确时将旧 sidebar 转成宿主行，避免猜错多入口插件的目的地。 */
export function resolvePluginSidebarNavigation(slot: ResolvedPluginSlot, allSlots: ResolvedPluginSlot[]) {
  const declared = slot.navigation;
  if (declared === false) return null;
  const siblings = allSlots.filter(candidate => candidate.pluginId === slot.pluginId);
  const pages = siblings.filter(candidate => candidate.type === "page" && candidate.routePath);
  if (declared) {
    const page = pages.find(candidate => candidate.routePath === declared.routePath);
    return page ? { routePath: page.routePath!, icon: declared.icon } : null;
  }
  const sidebars = siblings.filter(candidate => candidate.type === "sidebar");
  if (sidebars.length !== 1) return null;
  const namedPages = pages.filter(candidate => candidate.displayName === slot.displayName);
  const page = namedPages.length === 1 ? namedPages[0] : pages.length === 1 ? pages[0] : null;
  return page ? { routePath: page.routePath!, icon: undefined } : null;
}
