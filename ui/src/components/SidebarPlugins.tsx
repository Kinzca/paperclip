import { useState } from "react";
import { SidebarSection } from "./SidebarSection";
import { PluginSlotOutlet, usePluginSlots, type PluginSlotContext } from "@/plugins/slots";
import { PluginLauncherOutlet, usePluginLaunchers } from "@/plugins/launchers";

/** 插件入口使用宿主分组，避免与内置工作导航混排。 */
export function SidebarPlugins({ context }: { context: PluginSlotContext }) {
  const [open, setOpen] = useState(true);
  const { slots } = usePluginSlots({ slotTypes: ["sidebar"], companyId: context.companyId, enabled: !!context.companyId });
  const { launchers } = usePluginLaunchers({ placementZones: ["sidebar"], companyId: context.companyId, enabled: !!context.companyId });

  if (slots.length === 0 && launchers.length === 0) return null;

  return (
    <SidebarSection label="Plugins" collapsible={{ open, onOpenChange: setOpen }}>
      <PluginSlotOutlet
        errorBehavior="hidden"
        slotTypes={["sidebar"]}
        context={context}
        className="flex flex-col gap-0.5"
        itemClassName="text-(length:--text-compact) font-medium"
        missingBehavior="placeholder"
      />
      <PluginLauncherOutlet
        errorBehavior="hidden"
        placementZones={["sidebar"]}
        context={context}
        className="flex flex-col gap-0.5"
        itemClassName="text-(length:--text-compact) font-medium"
      />
    </SidebarSection>
  );
}
