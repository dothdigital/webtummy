type Event={eventName:string;sessionId:string|null;path:string;referrer?:string|null;occurredAt:Date;metadataJson:unknown};
const pathOnly=(raw:string)=>{try{return new URL(raw,'https://tracking.invalid').pathname||'/';}catch{return '/';}};
export function websiteAnalytics(events:Event[],start:Date,end:Date,rootUrl:string,limited=false){
 const rows=events.filter(e=>e.occurredAt>=start&&e.occurredAt<=end).sort((a,b)=>a.occurredAt.getTime()-b.occurredAt.getTime());
 const days=new Map<string,{date:string;views:number;sessions:Set<string>;successes:number}>();
 for(let d=new Date(start);d<=end;d.setUTCDate(d.getUTCDate()+1)){const key=d.toISOString().slice(0,10);days.set(key,{date:key,views:0,sessions:new Set(),successes:0});}
 const pages=new Map<string,{path:string;views:number;sessions:Set<string>;successes:number}>(),sessions=new Map<string,{pages:string[];success:boolean;source:string;successPages?:string[]}>(),forms=new Map<string,{path:string;form:string;starts:number;attempts:number;successes:number;errors:number}>();
 let missingSessionEvents=0;let hostname='';try{hostname=new URL(rootUrl).hostname;}catch{}
 for(const e of rows){const path=pathOnly(e.path),day=days.get(e.occurredAt.toISOString().slice(0,10));if(!day)continue;
  const sid=e.sessionId?.trim();if(sid)day.sessions.add(sid);else missingSessionEvents++;
  let session=sid?sessions.get(sid):undefined;
  if(sid&&!session){let source='Direct / unknown';try{const host=new URL(e.referrer||'').hostname;if(host&&host!==hostname)source=host;else if(host)source='Internal / unknown entry';}catch{}session={pages:[],success:false,source};sessions.set(sid,session);}
  if(e.eventName==='page_view'||e.eventName==='form_success'){
   const page=pages.get(path)||{path,views:0,sessions:new Set<string>(),successes:0};pages.set(path,page);
   if(e.eventName==='page_view'){page.views++;day.views++;if(sid)page.sessions.add(sid);if(session&&session.pages.at(-1)!==path)session.pages.push(path);}
   else {page.successes++;day.successes++;if(session){if(!session.success)session.successPages=session.pages.at(-1)===path?[...session.pages]:[...session.pages,path];session.success=true;}}
  }
  if(['form_start','form_submit','form_success','form_error'].includes(e.eventName)){
   const meta=e.metadataJson&&typeof e.metadataJson==='object'&&!Array.isArray(e.metadataJson)?e.metadataJson as Record<string,unknown>:{};
   const form=typeof meta.formId==='string'?meta.formId.slice(0,120):'Unidentified form';const key=JSON.stringify([path,form]);const row=forms.get(key)||{path,form,starts:0,attempts:0,successes:0,errors:0};forms.set(key,row);
   if(e.eventName==='form_start')row.starts++;if(e.eventName==='form_submit')row.attempts++;if(e.eventName==='form_success')row.successes++;if(e.eventName==='form_error')row.errors++;
  }
 }
 const paths=new Map<string,{pages:string[];sessions:number;convertedSessions:number;truncated:boolean}>(),sources=new Map<string,{source:string;sessions:number;convertedSessions:number}>();
 for(const session of sessions.values()){
  const source=sources.get(session.source)||{source:session.source,sessions:0,convertedSessions:0};sources.set(session.source,source);source.sessions++;if(session.success)source.convertedSessions++;
  if(!session.pages.length)continue;const steps=session.pages.slice(0,8),key=JSON.stringify([steps,session.pages.length>8]);const route=paths.get(key)||{pages:steps,sessions:0,convertedSessions:0,truncated:session.pages.length>8};paths.set(key,route);route.sessions++;if(session.success)route.convertedSessions++;
 }
 const successfulPaths=new Map<string,{pages:string[];sessions:number;convertedSessions:number;truncated:boolean}>();
 for(const session of sessions.values())if(session.successPages?.length){const steps=session.successPages.slice(0,8),truncated=session.successPages.length>8,key=JSON.stringify([steps,truncated]);const route=successfulPaths.get(key)||{pages:steps,sessions:0,convertedSessions:0,truncated};successfulPaths.set(key,route);route.sessions++;route.convertedSessions++;}
 const allPaths=[...paths.values()];
 return {limited,eventCount:rows.length,missingSessionEvents,periodStart:start.toISOString(),periodEnd:end.toISOString(),daily:[...days.values()].map(d=>({...d,sessions:d.sessions.size})),topPages:[...pages.values()].map(p=>({...p,sessions:p.sessions.size})).sort((a,b)=>b.views-a.views||a.path.localeCompare(b.path)),forms:[...forms.values()].sort((a,b)=>b.attempts-a.attempts),commonPaths:allPaths.sort((a,b)=>b.sessions-a.sessions).slice(0,8),convertingPaths:[...successfulPaths.values()].sort((a,b)=>b.convertedSessions-a.convertedSessions).slice(0,8),sources:[...sources.values()].sort((a,b)=>b.sessions-a.sessions).slice(0,10),convertedSessions:[...sessions.values()].filter(s=>s.success).length,sessions:sessions.size};
}
