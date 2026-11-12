import { uiText, useUiLocale } from "@/i18n/ui";
import { cn } from "../lib/utils";

interface OpenCodeLogoIconProps {
  className?: string;
}

export function OpenCodeLogoIcon({ className }: OpenCodeLogoIconProps) {
  useUiLocale();
  return (
    <>
      <img
        src="/brands/opencode-logo-light-square.svg"
        alt={uiText("OpenCode")}
        className={cn("dark:hidden", className)}
      />
      <img
        src="/brands/opencode-logo-dark-square.svg"
        alt={uiText("OpenCode")}
        className={cn("hidden dark:block", className)}
      />
    </>
  );
}
