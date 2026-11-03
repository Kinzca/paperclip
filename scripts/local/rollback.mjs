import { activate } from "./upgrade.mjs";
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help")
  console.log(
    "用法：node scripts/local/rollback.mjs [--to <已保留版本>]。仅允许数据库及插件迁移完全兼容的代码回退；不自动还原或删除业务数据。",
  );
else {
  if (args.length && (args.length !== 2 || args[0] !== "--to"))
    throw new Error("仅支持 --to <版本> 或 --help。");
  await activate({ to: args[1], rollback: true });
}
