import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
// A stored, single-file ZIP. Fixed entry names; no dependencies or shell execution.
function zip(name,data){
  const filename=Buffer.from(name),crc=crc32(data),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);
  central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(0x0314,4);central.writeUInt16LE(20,6);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE((0o100755<<16)>>>0,38);
  const centralOffset=local.length+filename.length+data.length;
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+filename.length,12);end.writeUInt32LE(centralOffset,16);
  return Buffer.concat([local,filename,data,central,filename,end]);
}
for(const [name,script] of [['Masion-Uninstall-Mac.zip','uninstall-mac.command'],['Masion-Uninstall-Windows.zip','uninstall-windows.cmd']]){
  await fs.writeFile(path.join(root,name),zip(script,await fs.readFile(path.join(root,script))));
  console.log(`Built ${name}; no uninstaller has been executed.`);
}
