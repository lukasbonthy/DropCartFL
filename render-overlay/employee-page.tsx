"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, Clock3, House, MapPin, Navigation, PackageCheck, Phone, ShoppingBag, Sparkles } from "lucide-react";
import "./employee.css";

type Job = { id:string; reference:string; arrivalAt:number; etaMinutes:number; status:string; customerName:string; phone:string; address:string; city:string; state:string; zip:string; groceryLoad:string; stairs:boolean; notes:string; assignmentStatus:string|null; earningsCents:number };
type Dashboard = { employee:{name:string;email:string}; stats:{todayCents:number;completedToday:number;available:number}; jobs:Job[] };

const money=(cents:number)=>"$"+(cents/100).toFixed(2);
const formatTime=(timestamp:number)=>new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit"}).format(timestamp);

export default function EmployeePage(){
 const [data,setData]=useState<Dashboard|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(""),[tab,setTab]=useState<"jobs"|"today">("jobs");
 async function load(){const r=await fetch("/api/employee/dashboard",{cache:"no-store"});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b?.error||"We couldn't load the employee dashboard.");setData(b);}
 useEffect(()=>{load().catch(e=>setError(e instanceof Error?e.message:"Unable to load dashboard."));},[]);
 async function updateJob(id:string,action:"accept"|"en_route"|"arrived"|"completed"){setBusy(id+":"+action);setError("");try{const r=await fetch("/api/employee/jobs/"+encodeURIComponent(id)+"/"+action,{method:"POST"});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b?.error||"That update couldn't be saved.");await load();}catch(e){setError(e instanceof Error?e.message:"That update couldn't be saved.");}finally{setBusy("");}}
 const visible=useMemo(()=>!data?[]:tab==="jobs"?data.jobs.filter(j=>j.assignmentStatus!=="completed"):data.jobs.filter(j=>j.assignmentStatus==="completed"),[data,tab]);
 if(error&&!data)return <main className="employee-page"><div className="employee-shell employee-locked"><a className="employee-back" href="/"><ArrowLeft size={17}/> Back to Dropcart</a><div className="employee-lock-icon"><PackageCheck size={28}/></div><p className="employee-eyebrow">Employee portal</p><h1>Employee access is required.</h1><p>{error}</p><a className="employee-primary" href="/account">Go to my account <ArrowUpRight size={17}/></a></div></main>;
 return <main className="employee-page"><div className="employee-shell">
  <header className="employee-topbar"><a className="employee-back" href="/"><ArrowLeft size={17}/> Dropcart</a><div className="employee-profile"><span className="employee-avatar">{data?.employee.name?.slice(0,1).toUpperCase()||"D"}</span><div><strong>{data?.employee.name||"Employee"}</strong><span>Employee</span></div></div></header>
  <section className="employee-welcome"><div><p className="employee-eyebrow"><Sparkles size={14}/> Your Dropcart shift</p><h1>Ready to make<br/><span>someone's day lighter?</span></h1><p>See nearby unloads, claim a job, and keep customers updated from one place.</p></div><div className="employee-today-card"><span>Today's earnings</span><strong>{money(data?.stats.todayCents||0)}</strong><small>{data?.stats.completedToday||0} completed unload{data?.stats.completedToday===1?"":"s"}</small></div></section>
  <section className="employee-stats"><article><Clock3 size={18}/><span><strong>{data?.stats.available||0}</strong> available</span></article><article><PackageCheck size={18}/><span><strong>{data?.stats.completedToday||0}</strong> completed</span></article><article><ShoppingBag size={18}/><span><strong>{money(data?.stats.todayCents||0)}</strong> today</span></article></section>
  <div className="employee-tabs"><button className={tab==="jobs"?"active":""} onClick={()=>setTab("jobs")}>Open &amp; active</button><button className={tab==="today"?"active":""} onClick={()=>setTab("today")}>Completed today</button></div>
  {error&&<div className="employee-error">{error}</div>}
  <section className="employee-jobs"><div className="employee-section-heading"><div><p className="employee-eyebrow">Your work</p><h2>{tab==="jobs"?"Available unloads":"Completed today"}</h2></div><button className="employee-refresh" onClick={()=>load()} aria-label="Refresh jobs"><Navigation size={16}/></button></div>
   {visible.length===0?<div className="employee-empty"><div><Check size={22}/></div><h3>{tab==="jobs"?"You're all caught up.":"Nothing completed yet."}</h3><p>{tab==="jobs"?"New unload requests will appear here when they're available.":"Completed unloads will show here during your shift."}</p></div>:
   <div className="employee-job-list">{visible.map(job=><article className={"employee-job-card "+(job.assignmentStatus||"available")} key={job.id}>
    <div className="employee-job-top"><div><span className="employee-reference">{job.reference}</span><h3>{job.customerName}</h3></div><strong className="employee-earnings">{money(job.earningsCents)}</strong></div>
    <div className="employee-job-details"><div><Clock3 size={17}/><span><strong>{formatTime(job.arrivalAt)}</strong><small>Arrive in about {job.etaMinutes} min</small></span></div><div><MapPin size={17}/><span><strong>{job.address}</strong><small>{job.city}, {job.state} {job.zip}</small></span></div><div><ShoppingBag size={17}/><span><strong>{job.groceryLoad==="small"?"1–5 bags":job.groceryLoad==="large"?"16+ bags":"6–15 bags"}</strong><small>{job.stairs?"Stairs included":"No stairs"}</small></span></div></div>
    {job.notes&&<div className="employee-notes"><strong>Customer note</strong><p>{job.notes}</p></div>}
    <div className="employee-job-actions">
      {job.assignmentStatus===null&&<button className="employee-primary" disabled={!!busy} onClick={()=>updateJob(job.id,"accept")}>{busy===job.id+":accept"?"Claiming…":"Claim unload"}<ArrowUpRight size={17}/></button>}
      {job.assignmentStatus==="accepted"&&<button className="employee-primary" disabled={!!busy} onClick={()=>updateJob(job.id,"en_route")}>{busy?"Updating…":"I'm on my way"}<Navigation size={17}/></button>}
      {job.assignmentStatus==="en_route"&&<button className="employee-primary" disabled={!!busy} onClick={()=>updateJob(job.id,"arrived")}>{busy?"Updating…":"I've arrived"}<House size={17}/></button>}
      {job.assignmentStatus==="arrived"&&<button className="employee-primary" disabled={!!busy} onClick={()=>updateJob(job.id,"completed")}>{busy?"Saving…":"Mark completed"}<Check size={17}/></button>}
      {job.assignmentStatus==="completed"&&<span className="employee-complete"><Check size={16}/> Completed</span>}
      <a className="employee-secondary" href={"tel:"+job.phone}><Phone size={16}/> Call customer</a>
    </div>
   </article>)}</div>}
  </section>
 </div></main>;
}
