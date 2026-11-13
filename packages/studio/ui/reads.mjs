const safeReads=new Set(['reel_board','reel_state','reel_models','reel_project']);
export function singleFlightReads(invoke){
 const pending=new Map();
 return (name,args={})=>{
  if(!safeReads.has(name))return invoke(name,args);
  const key=name+JSON.stringify(args);if(pending.has(key))return pending.get(key);
  const result=Promise.resolve().then(()=>invoke(name,args));pending.set(key,result);
  result.finally(()=>{if(pending.get(key)===result)pending.delete(key);}).catch(()=>{});
  return result;
 };
}
export function pollReads(read,{delay=15000,visible=()=>true,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let stopped=false,timer;
 async function tick(){
  let next=delay;
  try{if(!stopped&&visible())await read();}catch{next=Math.max(delay,30000);}
  if(!stopped)timer=setTimer(tick,next);
 }
 timer=setTimer(tick,delay);
 return ()=>{stopped=true;clearTimer(timer);};
}
