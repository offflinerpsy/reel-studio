import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile, rename, lstat, readdir} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const version = '0.4.0';
export const hash = data => createHash('sha256').update(data).digest('hex');
export async function digest(path) { try { return hash(await readFile(path)); } catch(e) { if(e.code==='ENOENT') return null; throw e; } }
export async function atomic(path, data) { await mkdir(dirname(path),{recursive:true}); const tmp=`${path}.tmp-${process.pid}-${crypto.randomUUID()}`; await writeFile(tmp,data,{flag:'wx'}); await rename(tmp,path); }
export async function walk(base, rel='') { const out=[]; for(const entry of await readdir(join(base,rel),{withFileTypes:true})) { const next=join(rel,entry.name); if(entry.isSymbolicLink()) throw Error(`Symlink not allowed: ${join(base,next)}`); if(entry.isDirectory()) out.push(...await walk(base,next)); else if(entry.isFile()) out.push(next); } return out; }
export async function assertNoSymlink(path) { try { if((await lstat(path)).isSymbolicLink()) throw Error(`Refusing symlink: ${path}`); } catch(e) { if(e.code!=='ENOENT') throw e; } }
