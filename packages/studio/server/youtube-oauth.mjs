import {randomBytes, createHash} from 'node:crypto';

export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const fail = code => Object.assign(new Error('YouTube authorization could not be verified'), {code});
const validString = (v, max=4096) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);

export function validateYouTubeClient(input) {
  if (!input || Object.keys(input).some(k => !['clientId','clientSecret'].includes(k)) ||
      !validString(input.clientId,512) || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(input.clientId) ||
      input.clientSecret && !validString(input.clientSecret,512)) throw fail('invalid_client');
  return {clientId:input.clientId, ...(input.clientSecret ? {clientSecret:input.clientSecret} : {})};
}
function callback(value) {
  let u; try {u=new URL(value);} catch {throw fail('invalid_callback');}
  if (u.protocol!=='http:' || u.hostname!=='127.0.0.1' || !u.port || u.username || u.password || u.search || u.hash || u.pathname!=='/setup/youtube/callback') throw fail('invalid_callback');
  return u.href;
}
export async function youtubeJSON(fetchImpl,url,init={}) {
  try {
    const response=await fetchImpl(url,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw fail(`http_${response.status}`);
    const data=await response.json();
    if (!data || typeof data!=='object') throw fail('invalid_response');
    return data;
  } catch (error) {throw fail(/^http_\d+$/.test(error?.code||'') ? error.code : 'provider_request_failed');}
}
function tokenBody(client,values) {
  return new URLSearchParams({client_id:client.clientId,...(client.clientSecret?{client_secret:client.clientSecret}:{}),...values});
}
function tokens(data,now,refreshToken) {
  if (!validString(data.access_token) || !Number.isFinite(data.expires_in) || data.expires_in<=0 || data.expires_in>86400 ||
      data.token_type?.toLowerCase()!=='bearer' || !validString(data.refresh_token||refreshToken)) throw fail('invalid_token_response');
  if (data.scope && !YOUTUBE_SCOPES.every(scope=>data.scope.split(' ').includes(scope))) throw fail('missing_scope');
  return {accessToken:data.access_token,refreshToken:data.refresh_token||refreshToken,expiresAt:now()+data.expires_in*1000};
}
export async function readYouTubeChannel({accessToken,fetchImpl=fetch}) {
  if (!validString(accessToken)) throw fail('missing_token');
  const data=await youtubeJSON(fetchImpl,'https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',{headers:{Authorization:`Bearer ${accessToken}`}});
  if (!Array.isArray(data.items) || data.items.length!==1 || !/^UC[A-Za-z0-9_-]{22}$/.test(data.items[0]?.id||'')) throw fail('channel_not_unique');
  return {id:data.items[0].id,title:typeof data.items[0].snippet?.title==='string'?data.items[0].snippet.title.slice(0,200):''};
}
export function createYouTubeOAuth({fetchImpl=fetch,now=Date.now}={}) {
  const pending=new Map();
  function start({client,redirectURI}) {
    client=validateYouTubeClient(client);redirectURI=callback(redirectURI);
    for (const [state,p] of pending) if (p.expiresAt<=now()) pending.delete(state);
    if (pending.size>=3) throw fail('authorization_pending');
    const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
    pending.set(state,{client,redirectURI,verifier,expiresAt:now()+600000});
    const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.search=new URLSearchParams({client_id:client.clientId,redirect_uri:redirectURI,response_type:'code',scope:YOUTUBE_SCOPES.join(' '),state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'offline',prompt:'consent'}).toString();
    return {authorizeURL:u.href};
  }
  async function complete({state,code,redirectURI}) {
    if (!validString(state,128) || !validString(code,4096)) throw fail('invalid_callback');
    const p=pending.get(state);pending.delete(state);
    if (!p || p.expiresAt<=now() || callback(redirectURI)!==p.redirectURI) throw fail('invalid_state');
    const data=await youtubeJSON(fetchImpl,TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:tokenBody(p.client,{grant_type:'authorization_code',code,redirect_uri:p.redirectURI,code_verifier:p.verifier})});
    const grant=tokens(data,now),channel=await readYouTubeChannel({accessToken:grant.accessToken,fetchImpl});
    return {...p.client,...grant,channel};
  }
  async function refresh(saved) {
    if (!validString(saved.refreshToken)) throw fail('authorization_required');
    const data=await youtubeJSON(fetchImpl,TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:tokenBody(validateYouTubeClient({clientId:saved.clientId,...(saved.clientSecret?{clientSecret:saved.clientSecret}:{})}),{grant_type:'refresh_token',refresh_token:saved.refreshToken})});
    return tokens(data,now,saved.refreshToken);
  }
  return {start,complete,refresh,clearPending:()=>pending.clear()};
}
