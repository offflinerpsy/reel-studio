import test from 'node:test';
import assert from 'node:assert/strict';
import {macInputFiles,revisionInput} from '../server/revision-inputs.mjs';
const home='/owned/studio',version={path:home+'/media/master.mp4',sourceDir:'/linux-only/source',sha256:'master',artifacts:{editableSource:{path:home+'/media/version/source.zip',sha256:'archive'},captions:[{language:'en',path:home+'/media/version/en.srt',sha256:'caption'}]}};
test('Mac revision receives immutable editable ZIP and captions when source belongs to Linux',()=>{
 assert.deepEqual(macInputFiles({uploads:[],versions:[version]},home),[
  {path:version.path,isDir:false,sha256:'master'},
  {path:version.artifacts.editableSource.path,isDir:false,sha256:'archive'},
  {path:version.artifacts.captions[0].path,isDir:false,sha256:'caption'}]);
 assert.equal(revisionInput(version).editableSource.sha256,'archive');
});
test('archive avoids copying an entire old job while legacy owned source remains supported',()=>{
 const previous={...version,sourceDir:home+'/jobs/old'};
 assert.equal(macInputFiles({versions:[previous]},home).some(x=>x.isDir),false);
 assert.deepEqual(macInputFiles({versions:[{...previous,artifacts:undefined}]},home).at(-1),{path:home+'/jobs/old',isDir:true});
});
test('revision preparation does not widen access to unrelated folders or accounts',()=>{
 assert.deepEqual(macInputFiles({uploads:[{path:'/another/client.png'},{path:home+'/secrets/key'}],versions:[{path:'/another/master.mp4',sourceDir:'/another/work'}]},home),[]);
 assert.equal(revisionInput(),null);
});
