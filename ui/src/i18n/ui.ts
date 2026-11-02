import { useSyncExternalStore } from "react";
import { i18n } from "./index";
import en from "./messages/en-ui.json";
import zh from "./messages/zh-CN-ui.json";

export type UiLocale = "en" | "zh-CN";
const storageKey = "paperclip.ui.locale";
const english = en as Record<string, string>;
const chinese = zh as Record<string, string>;

function readPreference(): UiLocale {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "en" || saved === "zh-CN") return saved;
  } catch { /* 存储不可用时仍允许当前会话切换。 */ }
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function getUiLocale(): UiLocale {
  return i18n.resolvedLanguage === "zh-CN" || i18n.language === "zh-CN" ? "zh-CN" : "en";
}

function syncDocument(locale: UiLocale) {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

i18n.addResourceBundle("en", "ui", english, true, true);
i18n.addResourceBundle("zh-CN", "ui", chinese, true, true);
i18n.on("languageChanged", () => syncDocument(getUiLocale()));
void i18n.changeLanguage(readPreference());
syncDocument(getUiLocale());

/** 仅用于显式接入的固定界面文案；不翻译任务、代码或名称等用户内容。 */
export function uiText(source: string, values: Record<string, unknown> = {}): string {
  const key = source.trim();
  const leading = source.match(/^\s*/)?.[0] ?? "";
  const trailing = source.match(/\s*$/)?.[0] ?? "";
  if (english[key] === key && chinese[key] === key && Object.keys(values).length === 0) return source;
  const fallback = getUiLocale() === "en" ? english[key] ?? key : key;
  const template = String(i18n.t(key, { ns: "ui", keySeparator: false, nsSeparator: false, defaultValue: fallback, skipInterpolation: true }));
  // 仅插入显式传入的值，保留示例代码中的模板标记，不递归处理用户内容。
  const translated = template.replace(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match);
  return leading + translated + trailing;
}

function subscribe(notify: () => void) {
  i18n.on("languageChanged", notify);
  return () => { i18n.off("languageChanged", notify); };
}

export function useUiLocale(): UiLocale {
  return useSyncExternalStore(subscribe, getUiLocale, () => "en");
}

/** 返回是否成功保存；失败时当前会话的语言切换仍然生效。 */
export async function setUiLocale(locale: UiLocale): Promise<boolean> {
  let saved = true;
  try { localStorage.setItem(storageKey, locale); } catch { saved = false; }
  await i18n.changeLanguage(locale);
  return saved;
}

if (typeof window !== "undefined") window.addEventListener("storage", (event) => {
  if (event.key === storageKey) void i18n.changeLanguage(readPreference());
});

/** 为固定枚举标签创建只读的按需译文，不改动原状态码或共享标签表。 */
export function localizedLabels(source: Record<string, string>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [key, text] of Object.entries(source)) {
    Object.defineProperty(labels, key, { enumerable: true, get: () => uiText(text === "General" ? "General role" : text) });
  }
  return labels;
}
