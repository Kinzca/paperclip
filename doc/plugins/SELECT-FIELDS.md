# 统一单选框

本 Fork 的普通单选控件由 Paperclip 共享 Select 绘制，使用同一主题、边框、图标、选中标记和键盘操作。弹层默认在触发按钮下方展开，空间不足时由组件避让。

## 宿主用法

```tsx
import { SelectField } from "@/components/ui/select-field";

<SelectField value={revisionId} onValueChange={setRevisionId} aria-label="选择草案">
  <option value="">选择草案</option>
  {drafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.name}</option>)}
</SelectField>
```

也可传入 `options: { value, label, disabled?, hidden?, group? }[]`。
`onValueChange` 接收原始字符串，不接收 DOM 事件。空字符串、分组选项及禁用项仍由原有业务数据决定；内部仅为 Radix 项目值编码，回调和 FormData 保留原值。

支持受控 `value`、非受控 `defaultValue`、`disabled`、`id`、ARIA 属性，以及 `name` / `form` / `required`。隐藏的原生字段用于表单提交、必填校验、自动填充和表单重置，不显示系统下拉弹层。没有给控件设置 name 的地方不会因此新增业务表单字段。

表单桥在选项更新时可能发出空重置事件；该事件不代表用户选择，不得清空业务状态。组件只解码实际选项值，用户主动选择空字符串仍正常回调。测试可用 `ui/src/test/select-field.ts` 定位可见触发按钮对应的原始表单字段，避免把 Radix 的编码字段当成业务值；键盘选择及空值提交另由真实组件交互用例覆盖。

需要搜索的大型选择器继续使用现有可搜索组件，不将其降级为普通单选框。多选和列表框不属于这次迁移。

## 插件用法

```tsx
import { SelectField } from "@paperclipai/plugin-sdk/ui";

<SelectField
  aria-label="最小处理间隔"
  defaultValue="15"
  options={[{ value: "5", label: "5 min" }, { value: "15", label: "15 min" }]}
/>
```

插件通过宿主 UI 桥共享组件，无需自行打包另一套菜单依赖。需要同时使用包含此桥的新宿主前端和对应 SDK。Wiki 设置中的两处原生下拉框已接入；Office 源码扫描没有发现原生 select，此次没有修改其独立仓库。第三方插件若自行绘制菜单或使用原生 select，仍需主动适配此接口，宿主不通过 DOM 扫描强制改写插件。

仓库内未安装的厨房水槽、文件浏览器示例插件仍有原生控件，不在本轮运行实例的改动范围；这不代表任意第三方插件已经自动统一。

## 本轮范围与交付边界

迁移脚本 `scripts/migrate-native-selects.mjs` 将宿主源码中 111 个普通单选控件迁移到共享组件，包括草案、Agent、环境、密钥、连接器、项目、例行任务和移动端页签等入口。脚本保留选项与业务表达式，只将读取 `event.target.value` 的事件改为字符串回调；遇到多选、列表框或读取其他事件字段的处理器会停止，要求人工处理。

共享 Select 的默认定位也改为 popper，显式传入定位方式的调用仍按原设置运行。Wiki 的两个设置控件保留原本的局部选值能力，本次没有新增持久化设置、任务执行或后台流程。

本轮完成构建和仓库要求的样式令牌检查；未运行测试、独立类型检查、设计检测、浏览器验收或 Agent 任务。原生表单语义、各入口与插件的实际交互仍交给用户检查。
