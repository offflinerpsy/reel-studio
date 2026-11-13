// Editable archives are portable across computers; source folders may belong to
// the computer that made the import. Never broaden the worker's path boundary.
export function revisionInput(version){
 if(!version)return null;
 return {path:version.path,sourceDir:version.sourceDir,sha256:version.sha256,
  ...(version.artifacts?.editableSource?{editableSource:version.artifacts.editableSource}:{}),
  ...(version.artifacts?.captions?{captions:version.artifacts.captions}:{})};
}
export function macInputFiles(brief,remoteHome){
 const previous=brief.versions?.at(-1),files=[];
 const add=(path,sha256,isDir=false)=>{
  if(typeof path!=='string'||!path.startsWith(remoteHome+'/'))return;
  if(!path.startsWith(remoteHome+'/jobs/')&&!path.startsWith(remoteHome+'/media/'))return;
  if(!files.some(f=>f.path===path))files.push({path,isDir,...(sha256?{sha256}:{})});
 };
 for(const input of brief.uploads||[])add(input.path,input.sha256);
 add(previous?.path,previous?.sha256);
 if(previous?.artifacts?.editableSource?.path)add(previous.artifacts.editableSource.path,previous.artifacts.editableSource.sha256);
 else add(previous?.sourceDir,undefined,true);
 for(const caption of previous?.artifacts?.captions||[])add(caption.path,caption.sha256);
 return files;
}
