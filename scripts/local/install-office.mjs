import { office, port } from './common.mjs';
// 仅通过受信任本机实例的正式安装接口登记，不代替用户运行任务。
const response = await fetch(`http://127.0.0.1:${port}/api/plugins/install`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ packageName: office, isLocalPath: true }),
});
const result = await response.json();
if (!response.ok) throw new Error(`Office 安装失败：HTTP ${response.status} ${JSON.stringify(result)}`);
console.log('Office 安装请求已完成，请到界面核查插件和权限。');
