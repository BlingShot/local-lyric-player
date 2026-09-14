import ts from 'typescript';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
// Explicit source conversion, never DOM rewriting: React owns translated text.
const catalog = new Set(); const apply = process.argv.includes('--apply');
async function visit(dir) {
 for (const item of await readdir(dir, {withFileTypes:true})) {
  const file=path.join(dir,item.name); if(item.isDirectory()) { await visit(file); continue; }
  if(!file.endsWith('.tsx') || file.includes(`${path.sep}i18n${path.sep}`))continue;
  const source=await readFile(file,'utf8'), ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX), edits=[];
  const add=(node,value,jsx=false)=>{if(!/[A-Za-z]/.test(value))return;catalog.add(value);edits.push({start:node.getStart(ast),end:node.end,text:jsx?`{t(${JSON.stringify(value)})}`:`t(${JSON.stringify(value)})`});};
  const text=(node)=>{const raw=node.getFullText(ast), value=raw.replace(/\s*\r?\n\s*/g,' ').trim().replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&').replaceAll('&quot;','"');if(value)add(node,value,true);};
  const expression=node=>{
   if(ts.isStringLiteral(node))add(node,node.text);
   else if(ts.isConditionalExpression(node)){expression(node.whenTrue);expression(node.whenFalse);}
   else if(ts.isBinaryExpression(node)&&[ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken,ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)){expression(node.right);}
   else if(ts.isTemplateExpression(node)) {
    const values=node.templateSpans.map(s=>s.expression.getText(ast)), fmt=node.head.text+node.templateSpans.map((s,i)=>`{${i}}`+s.literal.text).join('');
    if(/[A-Za-z]/.test(fmt)){catalog.add(fmt);edits.push({start:node.getStart(ast),end:node.end,text:`t(${JSON.stringify(fmt)}, ${values.join(', ')})`});}
   }
  };
  function walk(n){
   if(ts.isJsxText(n)){text(n);return;}
   if(ts.isJsxAttribute(n)&&['label','title','placeholder','aria-label','okText','cancelText'].includes(n.name.getText(ast))&&n.initializer&&ts.isStringLiteral(n.initializer)){add(n.initializer,n.initializer.text,true);return;}
   if(ts.isJsxExpression(n)&&n.expression&&(!ts.isJsxAttribute(n.parent)||['label','title','placeholder','aria-label','okText','cancelText'].includes(n.parent.name.getText(ast)))){expression(n.expression);}
   if(ts.isPropertyAssignment(n)&&n.name.getText(ast)==='label'&&ts.isStringLiteral(n.initializer)) {
    let parent=n.parent;while(parent&&!ts.isFunctionLike(parent))parent=parent.parent;
    if(parent)add(n.initializer,n.initializer.text);
   }
   ts.forEachChild(n,walk);
  }walk(ast);
  if(apply&&edits.length){
   const unique=[...new Map(edits.map(e=>[e.start,e])).values()].sort((a,b)=>b.start-a.start);let output=source;
   for(const e of unique)output=output.slice(0,e.start)+e.text+output.slice(e.end);
   const relative=path.relative(path.dirname(file),'src/i18n').replaceAll('\\','/');
   if(!/import.*\bt\b.*from.*i18n/.test(source))output=`import { t } from '${relative.startsWith('.')?relative:'./'+relative}';\n`+output;
   await writeFile(file,output);
  }
 }
}
await visit('src/components');await visit('src/pages');await visit('src/analysis');
await writeFile('test-results/ui-catalog.json',JSON.stringify([...catalog].sort(),null,2));console.log(catalog.size+' UI messages');
