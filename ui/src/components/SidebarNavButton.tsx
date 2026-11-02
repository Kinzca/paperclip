import type { MouseEventHandler } from "react";
import { Puzzle, type LucideIcon } from "lucide-react";
import { sidebarNavRowClassName, useSidebarNavExpanded } from "./SidebarNavItem";
import { useSidebar } from "../context/SidebarContext";
import { SIDEBAR_RAIL_HIDDEN_LABEL } from "../lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** 侧栏动作保持按钮语义，尺寸和视觉规格沿用原生导航行。 */
export function SidebarNavButton({ label, icon: Icon = Puzzle, onClick }: {
  label: string;
  icon?: LucideIcon;
  onClick: MouseEventHandler<HTMLButtonElement>;
}) {
  const { collapsed, peeking, isMobile, setSidebarOpen } = useSidebar();
  const forceExpanded = useSidebarNavExpanded();
  const rail = collapsed && !peeking && !forceExpanded;
  const button = (
    <button type="button" className={sidebarNavRowClassName()} aria-label={rail ? label : undefined}
      onClick={(event) => { onClick(event); if (isMobile) setSidebarOpen(false); }}>
      <span data-slot="sidebar-nav-icon" className="relative shrink-0"><Icon className="h-4 w-4" /></span>
      <span className={rail ? SIDEBAR_RAIL_HIDDEN_LABEL : "truncate"}>{label}</span>
    </button>
  );
  return rail ? <Tooltip><TooltipTrigger asChild><div className="flex flex-col">{button}</div></TooltipTrigger><TooltipContent side="right">{label}</TooltipContent></Tooltip> : button;
}
