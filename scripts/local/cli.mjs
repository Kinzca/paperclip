import { cli, runNode } from './common.mjs';

// 复用本安装入口的配置与数据目录，避免操作到其他 Paperclip 实例。
runNode([cli, ...(process.argv.slice(2).length ? process.argv.slice(2) : ['--help'])]);
