# 插件侧栏入口规范（本 Fork）

Plugins 分组中的普通入口由 Paperclip 宿主绘制，复用 SidebarNavItem：统一 16px 图标、行间距、缩进、字体、悬停、选中、折叠提示、移动端收起行为和路由匹配。插件不再为普通入口单独提供布局样式。

## 推荐声明

在现有 sidebar 插槽中添加可选的 `navigation`。名称仍使用 `displayName`，顺序仍使用 `order`；`exportName` 保留作为旧版兼容入口，不新增权限。

```ts
{
  type: "sidebar",
  id: "my-sidebar",
  displayName: "My Plugin",
  exportName: "SidebarLink",
  navigation: { routePath: "my-plugin", icon: "book-open" },
  order: 30,
}
```

同一个插件必须同时注册 `type: "page", routePath: "my-plugin"` 的页面。路径为单段小写字母、数字和连字符，由宿主路由自动补上当前公司前缀。不得放外部 URL、跨公司地址或完整 HTML。

`navigation` 仅允许用于 sidebar 插槽；图标使用受限字符串，不接受插件 SVG/HTML 注入。宿主支持：activity、bell、book-open、bot、boxes、building-2、calendar、chart-no-axes-combined、database、file-text、folder-open、git-branch、globe、layout-dashboard、message-square、puzzle、search、settings、shield、terminal、users。未声明或无法识别的图标回退为 puzzle。

Office 0.3.4 使用 `building-2`；LLM Wiki 0.1.1 使用 `book-open`。原页面、公司上下文、自动刷新和工作流实现没有修改。

## 旧插件兼容

- 没有 navigation，但只有一个 sidebar：如果仅有一个页面，或只有一个与入口名称完全相同的页面，宿主可以明确确定目标，自动使用原生导航行及 puzzle 图标。
- 目标不明确、多个自绘入口或特殊交互：保留原 React/Web Component 插槽。兼容容器对常见链接的字体、边距和 SVG 尺寸进行收敛，但不承诺任意自定义结构均能完全一致。
- 自定义入口可显式声明 `navigation: false`，阻止宿主自动推导。普通入口应优先采用推荐声明。
- sidebar launcher 的内部 navigate/deepLink 使用原生链接；其他动作使用共享行规格的原生按钮，继续交由原 launcher runtime 执行。弹窗、动作和外链不会被误写成普通内部页面链接。

本轮不改页面内部布局，不改变插件权限、业务动作或安装的公司范围。规范覆盖导航入口；自绘复杂入口仍需作者适配。

## 运行时兼容

本 Fork 固定 `2026.1023.0` 发布服务，安装脚本除已有修复外，还通过 `scripts/local/overlays/sidebar-schema/` 发布新增 navigation 校验字段。只增加可选元数据，不迁移数据库。覆盖入口同时校验包版本与原文件哈希，遇到其他修改时保留现场并停止。

升级顺序：先部署宿主的校验器和 UI、重启宿主，再通过正式 upgrade 接口升级 Office / Wiki。旧宿主不保证接受新 manifest，不能只单独升级插件。本 Fork 不需要给每个新插件增加专用 CSS。

按用户要求，此次只实现、构建、提交和部署，没有运行开发测试、单独类型检查、代码审查、设计检测或浏览器验收。自动兼容、多入口插件、折叠栏及移动端表现均待用户检查。
