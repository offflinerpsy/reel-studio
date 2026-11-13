// A retry shares a pending read; it never replays a production action.
export function createStartupLoader({connect,read,timeoutMs=20000}){
 let pending;
 return ()=>{
  if(!pending){pending=Promise.resolve().then(connect).then(read);pending.finally(()=>{pending=undefined;}).catch(()=>{});}
  const current=pending;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('The Studio connection is taking too long. Check the Studio connection and try again.')),timeoutMs);
   current.then(resolve,reject).finally(()=>clearTimeout(timer));
  });
 };
}
