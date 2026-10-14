import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=process.env.BASE_PATH||'/LTC/';
if(!/^\/[a-zA-Z0-9/_-]*\/$/.test(base)&&base!=='/')throw Error('BASE_PATH must begin and end with / and contain only path characters');
const out=path.join(root,'dist');
await fs.mkdir(out,{recursive:true});
for(const file of ['index.html','app.js','style.css']){
  let text=await fs.readFile(path.join(root,'public',file),'utf8');
  if(file==='index.html')text=text.replace('__BASE__',base);
  await fs.writeFile(path.join(out,file),text);
}
console.log(`Dashboard built in dist/ for ${base}. Downloads are distributed separately.`);
