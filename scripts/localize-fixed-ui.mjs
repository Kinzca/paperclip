// Source-only localization codemod. Transforms explicit UI literals, never DOM or user data.
import { parse } from '../node_modules/.pnpm/@babel+parser@7.29.8/node_modules/@babel/parser/lib/index.js';
import fs from 'node:fs';
import path from 'node:path';
const dictionary = JSON.parse(fs.readFileSync('ui/src/i18n/messages/zh-CN-ui.json','utf8'));
const write = process.argv.includes('--write');
const messages = new Set();
const attributeNames = new Set(['title','label','description','placeholder','aria-label','alt','emptyMessage','subtitle','tooltip','confirmLabel','cancelLabel','loadingText','emptyText','heading','hint','helpText']);
const excluded = new Set(['pre','code','script','style','Markdown','CodeBlock','SyntaxHighlighter','Highlight']);
const eligible = text => /[A-Za-z]/.test(text) && !/^(?:https?:|\/|@|#[\da-f]|res:\/)/i.test(text.trim()) && !/[{}]|=>|\b(?:const|import)\s/.test(text);
function files(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]); }
for (const file of [...files('ui/src/pages'),...files('ui/src/components'),...files('packages/plugins/plugin-workspace-diff/src/ui'),...files('packages/plugins/plugin-llm-wiki/src/ui')].filter(f=>f.endsWith('.tsx')&&!/\.test\.|\/__tests__\/|UxLab|Uxlab|UXLab|DesignGuide|TaskChatLab|\/demo\/|\/demos\//.test(f))) {
 const source=fs.readFileSync(file,'utf8');
 let tree;
 try { tree=parse(source,{sourceType:'module',plugins:['typescript','jsx']}).program; }
 catch(error) { error.message = `${file}: ${error.message}`; throw error; }
 const edits=[];const componentFunctions=[];let changed=false;let needsLocaleGetter=false;
 const plugin=file.startsWith('packages/');
 const ignored=node=>{for(let p=node.parent;p;p=p.parent) if(p.type==='JSXElement'&&excluded.has(source.slice(p.openingElement.name.start,p.openingElement.name.end)))return true;return false;};
 const use=text=>{messages.add(text.trim());changed=true;};
 function visit(node) {
  if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)) {
   let name=node.id?.name;
   for(let p=node.parent;!name&&p&&(['VariableDeclarator','CallExpression','ParenthesizedExpression'].includes(p.type));p=p.parent)if(p.type==='VariableDeclarator')name=p.id.name;
   if(name&&/^[A-Z]/.test(name)&&node.body&&/[<][A-Za-z]/.test(source.slice(node.body.start,node.body.end))&&!/\buseUiLocale\s*\(|\buseHostLocale\s*\(/.test(source.slice(node.body.start,node.body.end)))componentFunctions.push(node);
  }
  if(node.type==='ObjectProperty' && node.key.name==='label' && node.value.type==='StringLiteral' && eligible(node.value.value)) {
   let parent=node.parent;
   while(parent && !['CallExpression','FunctionDeclaration','ArrowFunctionExpression','FunctionExpression'].includes(parent.type))parent=parent.parent;
   if(parent?.type==='CallExpression' && parent.callee.name==='setBreadcrumbs') {use(node.value.value);edits.push({start:node.value.start,end:node.value.end,text:`uiText(${JSON.stringify(node.value.value)})`});}
  }
  if(node.type==='CallExpression' && !plugin && ['useMemo','useCallback','useEffect'].includes(node.callee.name) && node.arguments[1]?.type==='ArrayExpression') {
   const body=source.slice(node.arguments[0].start,node.arguments[0].end);
   if(/\buiText\(/.test(body) && (node.callee.name!=='useEffect'||/\bsetBreadcrumbs\(/.test(body)) && !source.slice(node.arguments[1].start,node.arguments[1].end).includes('getUiLocale()')) {
    const deps=node.arguments[1];needsLocaleGetter=true;changed=true;edits.push({start:deps.end-1,end:deps.end-1,text:deps.elements.length&&!source.slice(deps.start,deps.end-1).trimEnd().endsWith(',')?', getUiLocale()':'getUiLocale()'});
   }
  }
  if(node.type==='JSXElement' && node.openingElement.name.name==='option' && !node.openingElement.attributes.some(a=>a.name?.name==='value')) {
   const children=node.children.filter(c=>c.type!=='JSXText'||c.value.trim());
   if(children.length===1) {
    const child=children[0];
    const expression=child.type==='JSXExpressionContainer'?child.expression:null;
    const original=child.type==='JSXText'?child.value.trim():expression?.type==='CallExpression'&&expression.callee.name==='uiText'&&expression.arguments[0]?.type==='StringLiteral'?expression.arguments[0].value:null;
    if(original!==null) {changed=true;edits.push({start:node.openingElement.name.end,end:node.openingElement.name.end,text:` value=${JSON.stringify(original)}`});}
   }
  }
  if(node.type==='JSXText'&&!ignored(node)) {
   const lines=node.value.replace(/\t/g,' ').split(/\r\n|\n|\r/);
   const text=lines.map((line,i)=>{if(i)line=line.replace(/^ +/,'');if(i<lines.length-1)line=line.replace(/ +$/,'');return line;}).filter(Boolean).join(' ');
   if(eligible(text)) {use(text);edits.push({start:node.start,end:node.end,text:`{uiText(${JSON.stringify(text)})}`});}
  } else if(node.type==='JSXAttribute'&&attributeNames.has(node.name.name)&&node.value&&node.value.type==='StringLiteral'&&!ignored(node)) {
   const text=node.value.value;
   if(eligible(text)) {use(text);edits.push({start:node.value.start,end:node.value.end,text:`{uiText(${JSON.stringify(text)})}`});}
  } else if(node.type==='JSXExpressionContainer'&&node.expression&&!ignored(node)) {
   function displayed(expression) {
    if(expression.type==='StringLiteral') {
     if(eligible(expression.value)){use(expression.value);edits.push({start:expression.start,end:expression.end,text:`uiText(${JSON.stringify(expression.value)})`});}
    } else if(expression.type==='TemplateLiteral' && eligible(expression.quasis.map(q=>q.value.cooked ?? q.value.raw).join(''))) {
     const text=expression.quasis.map((q,i)=>(q.value.cooked ?? q.value.raw)+(i<expression.expressions.length?`{{value${i}}}`:'')).join('');
     const values=expression.expressions.map((e,i)=>`value${i}: ${source.slice(e.start,e.end)}`).join(', ');
     use(text);edits.push({start:expression.start,end:expression.end,text:`uiText(${JSON.stringify(text)}, { ${values} })`});
    } else if(expression.type==='ConditionalExpression'){displayed(expression.consequent);displayed(expression.alternate);}
    else if(expression.type==='LogicalExpression')displayed(expression.right);
    else if(expression.type==='ParenthesizedExpression')displayed(expression.expression);
   }
   // Only child expressions; attributes may be commands/configuration and must not be rewritten.
   if(node.parent.type!=='JSXAttribute'||attributeNames.has(node.parent.name.name))displayed(node.expression);
  }
  for(const [key,value] of Object.entries(node)) {
   if(['loc','extra','comments','tokens'].includes(key))continue;
   for(const child of Array.isArray(value)?value:[value])if(child&&typeof child==='object'&&typeof child.type==='string') {Object.defineProperty(child,'parent',{value:node,configurable:true});visit(child);}
  }
 }
 visit(tree);
 if(changed) {
  for(const fn of componentFunctions) {
   if(fn.body.type==='BlockStatement')edits.push({start:fn.body.start+1,end:fn.body.start+1,text:'\n  useUiLocale();'});
   else { const start=fn.body.extra?.parenStart ?? fn.body.start; edits.push({start,end:start,text:'{ useUiLocale(); return '});edits.push({start:fn.end,end:fn.end,text:'; }'});}
  }
  const importSource=plugin?'@paperclipai/plugin-sdk/ui':'@/i18n/ui';
  const existing=tree.body.filter(n=>n.type==='ImportDeclaration').flatMap(n=>n.specifiers.map(s=>s.local.name));
  const add=[];if(needsLocaleGetter&&!existing.includes('getUiLocale'))add.push('getUiLocale');if(!existing.includes('uiText'))add.push(plugin?'translateUi as uiText':'uiText');if(!existing.includes('useUiLocale'))add.push(plugin?'useHostLocale as useUiLocale':'useUiLocale');
  if(add.length)edits.push({start:0,end:0,text:`import { ${add.join(', ')} } from "${importSource}";\n`});
  if(write) {let next=source;for(const edit of edits.sort((a,b)=>b.start-a.start||b.end-a.end))next=next.slice(0,edit.start)+edit.text+next.slice(edit.end);fs.writeFileSync(file,next);}
 }
}
process.stdout.write(JSON.stringify([...messages].filter(s=>!dictionary[s]).sort(),null,2)+'\n');
