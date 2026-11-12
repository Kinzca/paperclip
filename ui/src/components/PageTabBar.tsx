import { uiText, useUiLocale } from "@/i18n/ui";
import { SelectField } from "@/components/ui/select-field";
import type { ReactNode } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSidebar } from "../context/SidebarContext";

export interface PageTabItem {
  value: string;
  label: ReactNode;
}

interface PageTabBarProps {
  items: readonly PageTabItem[];
  value?: string;
  onValueChange?: (value: string) => void;
  align?: "center" | "start";
}

export function PageTabBar({ items, value, onValueChange, align = "center" }: PageTabBarProps) {
  useUiLocale();
  const { isMobile } = useSidebar();

  if (isMobile && value !== undefined && onValueChange) {
    return (
      <div className="relative inline-flex">
        <SelectField
          value={value}
          onValueChange={(optionValue) => onValueChange(optionValue)}
          className="h-9 appearance-none rounded-md border border-border bg-background pl-3 pr-9 py-1 text-base focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label={uiText("Page section")}
        >
          {items.map((item) => (
            <option key={item.value} value={item.value}>
              {typeof item.label === "string" ? item.label : item.value}
            </option>
          ))}
        </SelectField>
      </div>
    );
  }

  return (
    <TabsList variant="line" className={align === "start" ? "justify-start" : undefined}>
      {items.map((item) => (
        <TabsTrigger key={item.value} value={item.value}>
          {item.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
