import * as THREE from './three.module.js';
// Pure-time matte environment. No wall clock, remote assets, or foreground chrome.
const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('world'),antialias:true,preserveDrawingBuffer:true});
renderer.setSize(1080,1920,false);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(65,1080/1920,.05,90);
const style=window.__reelStyle,base=new THREE.Color(),shade=new THREE.Color();
const wallMats=Array.from({length:4},()=>new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide}));
const edge=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.11,side:THREE.DoubleSide});
scene.fog=new THREE.Fog(0x171717,2,24);
const parts=[];
if(style==='tunnel'){
 for(let i=0;i<13;i++){
  const g=new THREE.Group();scene.add(g);parts.push(g);
  for(let j=0;j<4;j++){
   const m=new THREE.Mesh(new THREE.PlaneGeometry(1,1),wallMats[j]);
   if(j<2){m.scale.set(2.15,9.1,1);m.rotation.y=j? -Math.PI/2:Math.PI/2;m.position.set(j?2.85:-2.85,0,-1.15)}
   else{m.scale.set(5.55,2.15,1);m.rotation.x=j===2?-Math.PI/2:Math.PI/2;m.position.set(0,j===2?-4.7:4.7,-1.15)}
   g.add(m);
  }
  for(const [w,h,x,y] of [[.06,9.4,-2.85,0],[.06,9.4,2.85,0],[5.7,.06,0,-4.7],[5.7,.06,0,4.7]]){
   const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),edge);m.position.set(x,y,.01);g.add(m);
  }
 }
}else if(style==='panels'){
 for(let i=0;i<18;i++){
  const m=new THREE.Mesh(new THREE.BoxGeometry(1.6,11,.28),wallMats[i%4]);m.position.set((i%2?1:-1)*(2.8+(i%3)*.4),0,-i*1.1);m.rotation.z=(i%2?1:-1)*.14;scene.add(m);parts.push(m);
 }
}else{
 for(let i=0;i<16;i++){
  const m=new THREE.Mesh(new THREE.RingGeometry(3.2,3.33,64),wallMats[i%4]);m.scale.y=1.5;scene.add(m);parts.push(m);
 }
}
function draw(time){
 const t=Math.max(0,Math.min(window.__reelDuration-.001,time)),scenes=window.__reelScenes;
 let chapter=scenes[0];for(const item of scenes)if(t>=item.start)chapter=item;
 base.set(chapter.bg);scene.background=base;scene.fog.color.copy(base);
 const dark=(base.r+base.g+base.b)<.35;
 for(let i=0;i<4;i++){shade.copy(base).lerp(new THREE.Color(i%2?0x000000:0xffffff),dark?.12:.075);wallMats[i].color.copy(shade)}
 edge.color.set(chapter.fg);
 parts.forEach((m,i)=>{
  const spacing=style==='tunnel'?2.3:style==='panels'?1.65:2.0,span=parts.length*spacing;
  m.position.z=-((i*spacing-t*.3+span)%span)+.6;
  if(style==='rings'){m.position.x=.22*Math.sin(t*.23+i*.2);m.rotation.z=t*.04}
  if(style==='panels')m.rotation.y=.06*Math.sin(t*.2+i*.3);
 });
 camera.position.set(.17*Math.sin(t*.32),.1*Math.cos(t*.23),0);camera.lookAt(.05*Math.sin(t*.2),.6,-10);renderer.render(scene,camera);
}
window.renderWorld=draw;window.addEventListener('hf-seek',e=>draw(e.detail.time));draw(window.__worldTime||0);
