import * as React from "react";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "./select";

export interface SelectFieldOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
  hidden?: boolean;
  group?: string;
}

export interface SelectFieldProps extends React.AriaAttributes {
  children?: React.ReactNode;
  options?: readonly SelectFieldOption[];
  value?: string | number;
  defaultValue?: string | number;
  onValueChange?: (value: string) => void;
  id?: string;
  name?: string;
  form?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  title?: string;
  className?: string;
  "data-testid"?: string;
}

function optionText(node: React.ReactNode): string {
  return React.Children.toArray(node).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    return React.isValidElement<{ children?: React.ReactNode }>(child)
      ? optionText(child.props.children) : "";
  }).join("");
}

// 接受声明式 option / optgroup，迁移时不改动各页面的业务选项和翻译。
function readOptions(children: React.ReactNode, group?: string, disabled = false): SelectFieldOption[] {
  return React.Children.toArray(children).flatMap((child): SelectFieldOption[] => {
    if (!React.isValidElement<React.OptionHTMLAttributes<HTMLOptionElement> & { label?: string }>(child)) return [];
    if (child.type === "option") return [{
      value: String(child.props.value ?? optionText(child.props.children)),
      label: child.props.label ?? child.props.children,
      disabled: disabled || child.props.disabled,
      hidden: child.props.hidden,
      group,
    }];
    return readOptions(child.props.children, child.type === "optgroup" ? child.props.label : group, disabled || !!child.props.disabled);
  });
}

/** 统一单选控件：共享弹层；真实值保留给业务回调与原生表单。 */
export function SelectField({
  children, options: suppliedOptions, value, defaultValue, onValueChange,
  name, form, required, disabled, className, ...triggerProps
}: SelectFieldProps) {
  const options = suppliedOptions ?? readOptions(children);
  const [localValue, setLocalValue] = React.useState<string>();
  const [invalid, setInvalid] = React.useState(false);
  const nativeRef = React.useRef<HTMLSelectElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const controlled = value !== undefined;
  const requested = controlled ? String(value) : localValue ?? (defaultValue === undefined ? undefined : String(defaultValue));
  const selected = options.find((option) => option.value === requested) ?? options.find((option) => !option.disabled);
  const selectedValue = selected?.value ?? "";

  function change(next: string) {
    setInvalid(false);
    if (!controlled) setLocalValue(next);
    onValueChange?.(next);
  }

  React.useEffect(() => {
    const owner = nativeRef.current?.form;
    function reset() { setLocalValue(undefined); setInvalid(false); }
    owner?.addEventListener("reset", reset);
    return () => owner?.removeEventListener("reset", reset);
  }, [form]);

  // Radix 的选项不接受空字符串。编码只用于弹层，回调和表单仍使用原值。
  const encode = (raw: string) => `option:${raw}`;
  const groups = new Map<string | undefined, SelectFieldOption[]>();
  for (const option of options) {
    const entries = groups.get(option.group) ?? [];
    entries.push(option);
    groups.set(option.group, entries);
  }

  return <>
    <Select value={encode(selectedValue)} disabled={disabled} onValueChange={(next) => change(next.slice("option:".length))}>
      <SelectTrigger
        {...triggerProps}
        ref={triggerRef}
        aria-required={required || undefined}
        aria-invalid={invalid || triggerProps["aria-invalid"]}
        className={cn("w-full min-w-0 text-sm", className)}
      >
        <SelectValue>{selected?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {[...groups].map(([group, entries], index) => <SelectGroup key={index}>
          {group !== undefined && <SelectLabel>{group}</SelectLabel>}
          {entries.filter((option) => !option.hidden).map((option) => <SelectItem key={option.value} value={encode(option.value)} disabled={option.disabled} className="whitespace-normal break-words">
            {option.label}
          </SelectItem>)}
        </SelectGroup>)}
      </SelectContent>
    </Select>
    {/* 隐藏的原生字段只负责 FormData、必填校验和自动填充，不展示系统弹层。 */}
    <select
      ref={nativeRef}
      aria-hidden="true"
      tabIndex={-1}
      className="sr-only"
      name={name}
      form={form}
      required={required}
      disabled={disabled}
      value={selectedValue}
      onChange={(event) => change(event.target.value)}
      onInvalid={(event) => { event.preventDefault(); setInvalid(true); triggerRef.current?.focus(); }}
    >
      {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled} hidden={option.hidden}>{optionText(option.label)}</option>)}
    </select>
  </>;
}
