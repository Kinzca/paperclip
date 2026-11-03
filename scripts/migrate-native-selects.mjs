// 将宿主的原生单选框迁移到共享控件；不改选项、翻译及业务表达式。
// 使用现有前端依赖树中的 Babel parser，无需安装额外依赖。
import { createRequire } from "node:module";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { parse } = require(require.resolve("@babel/parser", { paths: [root, join(root, "node_modules/.pnpm/node_modules")] }));
let total = 0;
function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc") continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else walk(value, visit);
  }
}
function migrate(path) {
  const text = readFileSync(path, "utf8");
  const ast = parse(text, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const edits = [];
  let count = 0;
  walk(ast, (node) => {
    if (node.type !== "JSXElement" || !["select", "NativeSelect"].includes(node.openingElement.name.name)) return;
    if (node.openingElement.attributes.some((attr) => ["multiple", "size"].includes(attr.name?.name))) throw new Error(`需要人工处理多选/列表框：${path}`);
    count++;
    edits.push([node.openingElement.name.start, node.openingElement.name.end, "SelectField"]);
    if (node.closingElement) edits.push([node.closingElement.name.start, node.closingElement.name.end, "SelectField"]);
    for (const attr of node.openingElement.attributes) {
      if (attr.name?.name !== "onChange") continue;
      const fn = attr.value?.expression;
      if (fn?.type !== "ArrowFunctionExpression" || fn.params.length !== 1 || fn.params[0].type !== "Identifier") throw new Error(`需要人工处理事件：${path}`);
      const parameter = fn.params[0];
      let nextName = "optionValue";
      while (text.slice(fn.body.start, fn.body.end).includes(nextName)) nextName += "Next";
      edits.push([attr.name.start, attr.name.end, "onValueChange"], [parameter.start, parameter.end, nextName]);
      const replaced = new Set();
      walk(fn.body, (child) => {
        if (child.type === "MemberExpression" && child.property.name === "value" && child.object.type === "MemberExpression" && child.object.property.name === "target" && child.object.object.name === parameter.name) {
          edits.push([child.start, child.end, nextName]);
          walk(child, (part) => { if (part.type === "Identifier") replaced.add(part.start); });
        }
      });
      walk(fn.body, (child) => {
        if (child.type === "Identifier" && child.name === parameter.name && !replaced.has(child.start)) throw new Error(`事件不只读取选中值，需人工处理：${path}:${child.loc.start.line}`);
      });
    }
  });
  if (!count) return;
  // 清理旧名称的导入；共享输入框样式常量继续保留。
  for (const node of ast.program.body) {
    if (node.type !== "ImportDeclaration") continue;
    for (const specifier of node.specifiers) {
      if (specifier.imported?.name !== "NativeSelect") continue;
      const others = node.specifiers.filter((item) => item !== specifier);
      if (!others.length) edits.push([node.start, node.end, ""]);
      else {
        const next = node.specifiers[node.specifiers.indexOf(specifier) + 1];
        edits.push(next ? [specifier.start, next.start, ""] : [node.specifiers[node.specifiers.indexOf(specifier) - 1].end, specifier.end, ""]);
      }
    }
  }
  let output = text;
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) output = output.slice(0, start) + replacement + output.slice(end);
  output = 'import { SelectField } from "@/components/ui/select-field";\n' + output;
  writeFileSync(path, output);
  total += count;
  console.log(`${count} ${path.slice(root.length + 1)}`);
}
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (entry.name.endsWith(".tsx") && !/\.(test|stories)\./.test(entry.name) && !path.includes("/components/ui/")) migrate(path);
  }
}
scan(join(root, "ui/src"));
console.log(`迁移 ${total} 个单选控件。`);
