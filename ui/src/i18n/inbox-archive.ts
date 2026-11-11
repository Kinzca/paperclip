import { i18n } from "./index";

const messages = {
  "Archived {{count}} conversations": "已归档 {{count}} 条对话",
  "{{count}} unfinished sub-conversations were kept visible.": "{{count}} 条未结束的子对话已保留在列表中。",
  "Undo group archive": "撤销整组归档",
  "Restored {{count}} conversations": "已恢复 {{count}} 条对话",
  "More recent archives were kept.": "之后发生的归档操作已保留。",
};
i18n.addResourceBundle("zh-CN", "ui", messages, true, true);
