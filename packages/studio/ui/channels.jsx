import React from 'react';
import {Plus,Settings2,Send} from 'lucide-react';

const platformLabel=id=>({youtube:'YouTube',tiktok:'TikTok',instagram:'Instagram',telegram:'Telegram'})[id]||id;
const hostLabel=id=>({linux:'Linux',macbook:'MacBook'})[id]||(id?'Unknown device':'Not assigned');
const statusLabel=status=>({browser_verified:'Browser verified',archived:'Archived',active:'Active',manual:'Export only',unverified:'Verification needed'})[status]||'Saved connection';
const count=value=>Number.isFinite(value)?value:0;

export function Channels({s,onDirection,onExperiment,onConnections}){
 const channels=s.operations?.channels||[];
 return <section className="workflow-stack channels-page">
  <div className="page-heading channels-heading"><div><div className="eyebrow">CHANNELS</div><h1>Your channels, at a glance.</h1><p>See published videos and work in Studio for each saved account.</p></div><button className="secondary" onClick={onExperiment}><Plus size={16}/>New experiment</button></div>
  <p className="channels-count-note">Published counts include distinct public video links independently verified in Studio, including earlier releases without a direction.</p>
  {channels.length?<div className="channels-grid">{channels.map(channel=><article className="panel channel-card" key={channel.id}>
   <div className="channel-card-heading"><span className="channel-platform"><Send size={16}/>{platformLabel(channel.channel)}</span><span className="connection-status">{statusLabel(channel.status)}</span></div>
   <div className="channel-identity"><h2>{channel.label||channel.account}</h2><p>{channel.account}</p></div>
   <div className="channel-published"><strong>{count(channel.counts?.published)}</strong><span>Published videos</span></div>
   <dl className="channel-counts"><div><dt>In Studio</dt><dd>{count(channel.counts?.projects)}</dd></div><div><dt>For review</dt><dd>{count(channel.counts?.readyForReview)}</dd></div><div><dt>Active / unresolved</dt><dd>{count(channel.counts?.activeJobs)}</dd></div></dl>
   <div className="channel-directions"><h3>Directions</h3>{channel.directions?.length?channel.directions.map(direction=><button className="channel-direction" key={direction.id} aria-label={'Open direction: '+direction.name} onClick={()=>onDirection(direction.id)}><span><b>{direction.name}</b><small>{hostLabel(direction.ownerHost)} · {direction.mode==='production'?'Continuous production':'Experiment'}{direction.status==='paused'?' · Paused':''}</small></span></button>):<p className="subtle">No production direction is assigned to this account.</p>}</div>
  </article>)}</div>:<div className="panel channels-empty"><Send size={25}/><h2>No saved channels yet</h2><p>Your saved accounts will appear here with their Studio video counts.</p><button className="secondary" onClick={onConnections}><Settings2 size={16}/>Connections</button></div>}
  {channels.length>0&&<div className="channels-footer"><p className="subtle">New experiments use {hostLabel(s.compute?.target)} for the new production chat and media. Saved directions keep their assigned device.</p><button className="text-button" onClick={onConnections}><Settings2 size={15}/>Manage connections</button></div>}
 </section>;
}
