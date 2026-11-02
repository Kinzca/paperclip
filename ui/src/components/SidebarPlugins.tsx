import { uiText, useUiLocale } from "@/i18n/ui";
import { useState } from "react";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarNavButton } from "./SidebarNavButton";
import { PluginSlotMount, usePluginSlots, type PluginSlotContext, type ResolvedPluginSlot } from "@/plugins/slots";
import { usePluginLaunchers, usePluginLauncherRuntime, launcherDisplayName } from "@/plugins/launchers";
import { pluginSidebarHref, pluginSidebarIcon, resolvePluginSidebarNavigation } from "@/plugins/sidebar-navigation";

function LegacyPluginSidebarSlot({ slot, context }: { slot: ResolvedPluginSlot; context: PluginSlotContext }) {
  usePluginSlots({ slotTypes: ["sidebar"], pluginId: slot.pluginId, companyId: context.companyId, enabled: !!context.companyId });
  return <div className="plugin-sidebar-legacy"><PluginSlotMount slot={slot} context={context} missingBehavior="placeholder" /></div>;
}

/** 插件导航由宿主绘制，插件只提供名称、路径和图标等元数据。 */
export function SidebarPlugins({ context }: { context: PluginSlotContext }) {
  useUiLocale();
  const [open, setOpen] = useState(true);
  const { slots } = usePluginSlots({
    slotTypes: ["sidebar", "page"], companyId: context.companyId,
    enabled: !!context.companyId, loadModules: false,
  });
  const { launchers, contributionsByPluginId } = usePluginLaunchers({
    placementZones: ["sidebar"], companyId: context.companyId, enabled: !!context.companyId,
  });
  const { activateLauncher } = usePluginLauncherRuntime();
  const sidebars = slots.filter(slot => slot.type === "sidebar");
  if (sidebars.length === 0 && launchers.length === 0) return null;

  return (
    <SidebarSection label={uiText("Plugins")} collapsible={{ open, onOpenChange: setOpen }}>
      <div className="flex flex-col gap-0.5">
        {sidebars.map(slot => {
          const navigation = resolvePluginSidebarNavigation(slot, slots);
          return navigation ? (
            <SidebarNavItem key={`${slot.pluginKey}:${slot.id}`} label={slot.pluginKey === "agent-pixels.compat" ? uiText("Office") : slot.pluginKey === "paperclipai.plugin-llm-wiki" ? uiText("Wiki") : slot.displayName}
              to={pluginSidebarHref(`/${navigation.routePath}`, context.companyPrefix, slots)} icon={pluginSidebarIcon(navigation.icon)} />
          ) : (
            <LegacyPluginSidebarSlot key={`${slot.pluginKey}:${slot.id}`} slot={slot} context={context} />
          );
        })}
        {launchers.map(launcher => {
          const contribution = contributionsByPluginId.get(launcher.pluginId);
          if (!contribution) return null;
          const label = launcherDisplayName(launcher, contribution);
          const target = launcher.action.target;
          const internalLink = (launcher.action.type === "navigate" || launcher.action.type === "deepLink")
            && target.startsWith("/") && !target.startsWith("//");
          const key = `${launcher.pluginKey}:launcher:${launcher.id}`;
          return internalLink ? (
            <SidebarNavItem key={key} label={label}
              to={pluginSidebarHref(target, context.companyPrefix, contribution.slots)} icon={pluginSidebarIcon()} />
          ) : (
            <SidebarNavButton key={key} label={label}
              onClick={event => { void activateLauncher(launcher, context, contribution, event.currentTarget); }} />
          );
        })}
      </div>
    </SidebarSection>
  );
}
