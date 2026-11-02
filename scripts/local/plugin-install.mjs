import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { port } from './common.mjs';

// 仅调用本机正式接口，不自动初始化公司、知识库或唤醒 Agent。
export async function registerLocalPlugin({ pluginKey, displayName, packageName, packagePath }) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(`用法：node scripts/local/install-${displayName.toLowerCase()}.mjs [--upgrade]\n默认：首次安装；已安装则保留。--upgrade：显式升级同路径的已有插件。`);
    return;
  }
  if (args.some(arg => arg !== '--upgrade') || args.length > 1) throw new Error('仅支持 --upgrade 或 --help。');
  const upgrade = args.includes('--upgrade');
  const parsedPort = Number(port);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) throw new Error('PAPERCLIP_PORT 必须是有效端口。');
  const packageFile = path.join(packagePath, 'package.json');
  if (!existsSync(packageFile)) throw new Error(`${displayName} 尚未准备，请先执行 node scripts/local/setup.mjs。`);
  const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
  if (pkg.name !== packageName) throw new Error(`${displayName} 包名不匹配，停止登记。`);
  for (const file of ['dist/manifest.js', 'dist/worker.js', 'dist/ui/index.js']) {
    if (!existsSync(path.join(packagePath, file))) throw new Error(`${displayName} 缺少构建产物 ${file}，请先执行 setup.mjs。`);
  }
  const targetPath = realpathSync(packagePath);
  const base = `http://127.0.0.1:${parsedPort}/api/plugins`;
  async function request(url, { allowMissing = false, body } = {}) {
    let response;
    try {
      response = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      throw new Error(`无法连接本地插件接口，请确认服务已启动且 PAPERCLIP_PORT 与配置一致：${error.message}`);
    }
    const result = await response.json().catch(() => null);
    if (allowMissing && response.status === 404 && result?.error === 'Plugin not found') return null;
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403
        ? '此入口适用于 local_trusted 本机实例；认证实例请在插件管理界面使用管理员身份操作。'
        : '请检查服务终端及插件管理界面，不要卸载或清除插件数据重试。';
      throw new Error(`${displayName} 接口 HTTP ${response.status}：${result?.error ?? '无法读取 JSON 响应'}。${hint}`);
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('插件接口返回格式不正确，停止登记。');
    return result;
  }
  const existing = await request(`${base}/${encodeURIComponent(pluginKey)}`, { allowMissing: true });
  const installed = existing && existing.status !== 'uninstalled';
  if (installed && !upgrade) {
    console.log(`${displayName} 已登记（${existing.version}，${existing.status}），没有更改。更新请备份后加 --upgrade；迁移路径请阅读 doc/LOCAL-MIGRATION.zh-CN.md。`);
    return;
  }
  if (upgrade) {
    if (!installed) throw new Error(`${displayName} 尚未安装，请去掉 --upgrade 首次登记。`);
    if (!existing.packagePath || !existsSync(existing.packagePath) || realpathSync(existing.packagePath) !== targetPath) {
      throw new Error(`${displayName} 已登记的包路径与本仓库不同。停止升级；请按迁移文档重新定位 package_path，或维护原安装位置。`);
    }
  }
  const result = upgrade
    ? await request(`${base}/${encodeURIComponent(pluginKey)}/upgrade`, { body: {} })
    : await request(`${base}/install`, { body: { packageName: targetPath, isLocalPath: true } });
  if (result.pluginKey !== pluginKey || !result.id || !result.status) throw new Error('插件登记响应缺少预期标识，请查看插件管理界面后再操作。');
  console.log(`${displayName} ${upgrade ? '升级' : '安装'}接口已完成：${result.version}，状态 ${result.status}。请在界面核查权限和功能；此响应不代表功能验收。`);
}
