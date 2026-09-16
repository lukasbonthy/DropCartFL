"use client";

import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import { AnimatePresence, LayoutGroup, motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Clock3, House, LoaderCircle, LockKeyhole, MapPin, Phone, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { ARRIVAL_TIMES, LOADS, bookingSchema, detailsSchema, locationSchema, stageSchema, receiptSchema } from "@/lib/booking-data";
import { formatPrice, getUnloadPrice, type GroceryLoad } from "@/lib/pricing";

type Draft = { address:string; city:string; zip:string; eta:number; load:GroceryLoad; name:string; phone:string; stairs:boolean; notes:string; consent:boolean; website:string };
const initial:Draft={address:"",city:"Inverness",zip:"",eta:30,load:"medium",name:"",phone:"",stairs:false,notes:"",consent:false,website:""};
type Receipt={reference:string; status:string; arrivalAt:number};
type ModelContext={registerTool:(tool:{name:string;description:string;inputSchema:object;annotations:object;execute:(input:unknown)=>unknown},options:{signal:AbortSignal})=>void|Promise<void>};

const cardSpring = { type:"spring" as const, stiffness:210, damping:28, mass:.7 };
const quickSpring = { type:"spring" as const, stiffness:260, damping:32, mass:.72 };
const stepVariants = {
 enter:(direction:number)=>({ opacity:0, x:direction * 12 }),
 center:{ opacity:1, x:0 },
 exit:(direction:number)=>({ opacity:0, x:direction * -10 }),
};
const headingVariants = {
 enter:(direction:number)=>({ opacity:0, y:direction * 4 }),
 center:{ opacity:1, y:0 },
 exit:(direction:number)=>({ opacity:0, y:direction * -3 }),
};

export function BookingForm(){
 const [draft,setDraft]=useState<Draft>(initial);
 const [step,setStep]=useState(0);
 const [direction,setDirection]=useState(1);
 const [errors,setErrors]=useState<Record<string,string>>({});
 const [error,setError]=useState("");
 const [saving,setSaving]=useState(false);
 const [receipt,setReceipt]=useState<Receipt|null>(null);
 const requestId=useRef("");
 const submitting=useRef(false);
 const reduceMotion=useReducedMotion();
 const tiltX=useMotionValue(0);
 const tiltY=useMotionValue(0);
 const smoothTiltX=useSpring(tiltX,{stiffness:190,damping:34,mass:.72});
 const smoothTiltY=useSpring(tiltY,{stiffness:190,damping:34,mass:.72});
 const field=(key:keyof Draft,value:string|number|boolean)=>{setDraft(prev=>({...prev,[key]:value}));setErrors(prev=>({...prev,[key]:""}));};

 useEffect(()=>{
  const context=(document as Document & {modelContext?:ModelContext}).modelContext;
  if(!context?.registerTool) return;
  const lifecycle=new AbortController();
  try { void Promise.resolve(context.registerTool({
   name:"stage_unload_request",
   description:"Fill Dropcart’s visible unload request form for the user to review. Does not send the request, contact anyone, agree to consent, or book a helper.",
   inputSchema:{type:"object",properties:{address:{type:"string"},city:{type:"string"},zip:{type:"string"},eta:{type:"number",enum:[15,30,45,60]},load:{type:"string",enum:["small","medium","large"]},name:{type:"string"},phone:{type:"string"},stairs:{type:"boolean"},notes:{type:"string"}},additionalProperties:false},
   annotations:{readOnlyHint:false,untrustedContentHint:false},
   execute(input){if(submitting.current)throw new Error("A request is currently being sent.");const parsed=stageSchema.parse(input);flushSync(()=>{setDraft(prev=>({...prev,...parsed,consent:false}));setDirection(-1);setStep(0);setReceipt(null);setErrors({});setError("");});requestId.current="";document.getElementById("book")?.scrollIntoView({block:"start"});return {staged:true,submitted:false,reviewRequired:true};}
  },{signal:lifecycle.signal})).catch(()=>{}); } catch { /* Optional browser capability; the visible form remains available. */ }
  return ()=>lifecycle.abort();
 },[]);

 function move(next:number){setDirection(next > step ? 1 : -1);setStep(next);setError("");setErrors({});requestAnimationFrame(()=>document.getElementById("booking-title")?.focus({preventScroll:true}));}
 function onCardPointerMove(event:ReactPointerEvent<HTMLElement>){
  if(reduceMotion||event.pointerType==="touch")return;
  const rect=event.currentTarget.getBoundingClientRect();
  const x=(event.clientX-rect.left)/rect.width-.5;
  const y=(event.clientY-rect.top)/rect.height-.5;
  tiltX.set(y * -0.55);
  tiltY.set(x * 0.7);
 }
 function resetCardTilt(){tiltX.set(0);tiltY.set(0);}
 function validate(part:"location"|"details"|"all"){
  const schema=part==="location"?locationSchema:part==="details"?detailsSchema:bookingSchema;
  const result=schema.safeParse({...draft,requestId:requestId.current||"00d67638-ab41-4e55-9d68-949817801503"});
  if(!result.success){const messages:Record<string,string>={};for(const issue of result.error.issues) messages[String(issue.path[0])]=issue.message;setErrors(messages);requestAnimationFrame(()=>document.getElementById(Object.keys(messages)[0])?.focus());return false;}
  return true;
 }
 async function submit(event:FormEvent){
  event.preventDefault();
  if(submitting.current)return;
  if(step===0){if(validate("location"))move(1);return;}
  if(step===1){if(validate("details"))move(2);return;}
  requestId.current ||= crypto.randomUUID();
  if(!validate("all"))return;
  submitting.current=true;setSaving(true);setError("");
  try {
   const response=await fetch("/api/bookings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...draft,requestId:requestId.current}),signal:AbortSignal.timeout(20000)});
   const data=await response.json();
   if(!response.ok)throw new Error(data&&typeof data==="object"&&"error" in data&&typeof data.error==="string"?data.error:"We couldn’t save your request. Please try again.");
   const confirmed=receiptSchema.safeParse(data);
   if(!confirmed.success)throw new Error("We couldn’t verify the response. Please try again; your request won’t be duplicated.");
   setReceipt(confirmed.data);requestAnimationFrame(()=>document.getElementById("confirmation-title")?.focus());
  } catch(caught){setError(caught instanceof Error&&caught.name!=="TimeoutError"?caught.message:"The connection took too long. Try again; your request won’t be duplicated.");}
  finally{submitting.current=false;setSaving(false);}
 }
 const errorFor=(key:string)=>errors[key]?<motion.p initial={reduceMotion?false:{opacity:0,y:-4}} animate={{opacity:1,y:0}} id={`${key}-error`} className="mt-2 text-sm text-destructive" role="alert">{errors[key]}</motion.p>:null;
 const inputProps=(key:keyof Draft)=>({id:key,name:key,value:String(draft[key]),onChange:(e:React.ChangeEvent<HTMLInputElement>)=>field(key,e.target.value),"aria-invalid":!!errors[key],"aria-describedby":errors[key]?`${key}-error`:undefined,className:"form-input"});
 const titles=["Book your unload.","A few quick details.","All set to send?"];
 const subtitles=["A lighter arrival starts right here.","Help us plan your helping hand.","Review your request before sending."];
 const basePrice=getUnloadPrice(draft.load,false);
 const totalPrice=getUnloadPrice(draft.load,draft.stairs);

 if(receipt)return <motion.section
  id="book"
  layout
  initial={reduceMotion?false:{opacity:0,y:16,scale:.985}}
  animate={{opacity:1,y:0,scale:1}}
  transition={cardSpring}
  className="booking-card"
  aria-label="Request received"
 >
  <motion.span initial={reduceMotion?false:{scale:.7,rotate:-10}} animate={{scale:1,rotate:0}} transition={quickSpring} className="mb-7 grid size-16 place-items-center rounded-[22px] bg-accent"><Check size={31}/></motion.span>
  <p className="section-eyebrow mb-3">One less thing to carry</p>
  <h2 id="confirmation-title" tabIndex={-1} className="text-3xl font-medium tracking-tight outline-none">Request received.</h2>
  <p className="mt-4 text-base leading-relaxed text-muted-foreground">Thanks, {draft.name.split(" ")[0]}. Your unload request is saved. Our team needs to confirm availability and arrival time before your booking is final. Your selected unload price is already shown below.</p>
  <motion.div layout className="my-6 space-y-4 rounded-2xl border border-border bg-[#f8faf6] p-5"><div className="flex justify-between gap-3 text-sm"><span className="text-muted-foreground">Your reference</span><strong className="font-mono">{receipt.reference}</strong></div><div className="flex items-start gap-3 text-sm"><MapPin size={18} className="shrink-0"/><span>{draft.address}<br/>{draft.city}, FL {draft.zip}</span></div><div className="flex items-center gap-3 text-sm"><Phone size={17}/><span>{draft.phone}</span></div><div className="flex items-center justify-between border-t border-border pt-4 text-sm"><span className="text-muted-foreground">Unload total</span><strong>{formatPrice(totalPrice)}</strong></div><p className="text-sm font-medium">Awaiting team confirmation</p></motion.div>
  <p className="text-sm leading-relaxed text-muted-foreground">Keep this reference for your records. No payment has been taken and no helper has been dispatched.</p>
  <motion.div whileHover={reduceMotion?undefined:{y:-1,scale:1.002}} whileTap={reduceMotion?undefined:{scale:.992}} transition={quickSpring}>
   <Button className="submit-button mt-7" onClick={()=>{requestId.current="";setReceipt(null);setDraft(initial);setDirection(-1);setStep(0);}}>Book another unload <ArrowRight/></Button>
  </motion.div>
 </motion.section>;

 return <LayoutGroup id="booking-flow">
  <motion.section
   id="book"
   layout
   onPointerMove={onCardPointerMove}
   onPointerLeave={resetCardTilt}
   onPointerCancel={resetCardTilt}
   style={reduceMotion?undefined:{rotateX:smoothTiltX,rotateY:smoothTiltY,transformPerspective:1200}}
   initial={reduceMotion?false:{opacity:0,y:18,scale:.985}}
   animate={{opacity:1,y:0,scale:1}}
   transition={{...cardSpring,layout:cardSpring}}
   className="booking-card"
   aria-label="Book an unload"
  >
   <div className="booking-card-glow" aria-hidden="true"/>
   <div className="booking-header">
    <div className="min-w-0">
     <h2 id="booking-title" tabIndex={-1} className="booking-heading">
      <AnimatePresence mode="popLayout" custom={direction} initial={false}>
       <motion.span key={`title-${step}`} className="inline-block" custom={direction} variants={headingVariants} initial="enter" animate="center" exit="exit" transition={quickSpring}>{titles[step]}</motion.span>
      </AnimatePresence>
     </h2>
     <div className="mt-2 min-h-[20px] text-sm text-muted-foreground">
      <AnimatePresence mode="popLayout" custom={direction} initial={false}>
       <motion.p key={`subtitle-${step}`} custom={direction} variants={headingVariants} initial="enter" animate="center" exit="exit" transition={quickSpring}>{subtitles[step]}</motion.p>
      </AnimatePresence>
     </div>
    </div>
    <motion.span className="booking-header-icon" animate={reduceMotion?undefined:{rotate:[0,-3,0]}} transition={reduceMotion?undefined:{duration:4.8,repeat:Infinity,ease:"easeInOut"}}><ShoppingBag size={20} strokeWidth={1.7}/></motion.span>
   </div>

   <ol aria-label="Booking steps" className="booking-steps">
    {["Your unload","The details","Review"].map((label,index)=>{
     const current=step===index;
     const complete=step>index;
     return <li key={label} aria-current={current?"step":undefined} className={`booking-step${current?" current":""}${complete?" complete":""}${step>=index?" active":""}`}>
      <span className="step-dot">
       {current&&<motion.span layoutId="booking-active-step" className="booking-active-step" transition={quickSpring}/>} 
       <span className="step-dot-content">{complete?<Check size={12}/>:index+1}</span>
      </span>
      <span>{label}</span>
     </li>;
    })}
   </ol>
   <div className="booking-progress-track" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step+1} aria-label={`Step ${step+1} of 3`}>
    <motion.div className="booking-progress-indicator" initial={false} animate={{scaleX:(step+1)/3}} transition={quickSpring}/>
   </div>

   <form onSubmit={submit} noValidate>
    <fieldset disabled={saving} className="min-w-0 space-y-4">
     <AnimatePresence mode="popLayout" custom={direction} initial={false}>
      <motion.div key={`step-${step}`} layout="position" className="booking-step-panel space-y-4" custom={direction} variants={stepVariants} initial="enter" animate="center" exit="exit" transition={reduceMotion?{duration:0}:quickSpring}>
       {step===0&&<>
        <div><label className="form-label flex items-center gap-2" id="arrival-label"><Clock3 size={16}/> When will you be home?</label><RadioGroup aria-labelledby="arrival-label" value={String(draft.eta)} onValueChange={v=>field("eta",Number(v))} className="grid grid-cols-4 gap-2">{ARRIVAL_TIMES.map(time=><motion.label whileHover={reduceMotion?undefined:{y:-1,scale:1.004}} whileTap={reduceMotion?undefined:{scale:.985}} transition={quickSpring} className="choice-card" data-selected={draft.eta===time} key={time} htmlFor={`eta-${time}`}>{draft.eta===time&&<motion.span layoutId="arrival-choice" className="choice-selection-surface" transition={quickSpring}/>}<RadioGroupItem className="sr-only" value={String(time)} id={`eta-${time}`}/><span className="arrival-option"><strong>{time}</strong><span>min</span></span></motion.label>)}</RadioGroup><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Your estimated arrival, subject to team confirmation.</p></div>
        <div><label className="form-label" htmlFor="address">Where are we unloading?</label><div className="relative"><MapPin size={18} className="pointer-events-none absolute left-4 top-[17px] z-[2] text-[#82927d]"/><Input {...inputProps("address")} className="form-input pl-11" placeholder="Your home address" autoComplete="street-address" maxLength={180}/></div>{errorFor("address")}</div>
        <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3"><div><label className="form-label" htmlFor="city">City</label><Input {...inputProps("city")} autoComplete="address-level2" maxLength={80}/>{errorFor("city")}</div><div><label className="form-label" htmlFor="zip">ZIP code</label><Input {...inputProps("zip")} placeholder="34450" autoComplete="postal-code" inputMode="numeric" maxLength={5}/>{errorFor("zip")}</div></div>
        <motion.div initial={reduceMotion?false:{opacity:0,y:4}} animate={{opacity:1,y:0}} transition={{...quickSpring,delay:.04}} className="service-note"><House size={17} className="mt-0.5 shrink-0"/><span>Inverness & nearby. We’ll confirm your address is in our service area.</span></motion.div>
       </>}
       {step===1&&<>
        <div><label id="load-label" className="form-label">How much are we carrying?</label><RadioGroup aria-labelledby="load-label" value={draft.load} onValueChange={v=>field("load",v)} className="grid grid-cols-3 gap-2">{LOADS.map(load=><motion.label whileHover={reduceMotion?undefined:{y:-1,scale:1.004}} whileTap={reduceMotion?undefined:{scale:.985}} transition={quickSpring} key={load.value} className="choice-card load-choice-card flex-col gap-1 px-1 text-center" data-selected={draft.load===load.value} htmlFor={`load-${load.value}`}>{draft.load===load.value&&<motion.span layoutId="load-choice" className="choice-selection-surface" transition={quickSpring}/>}<RadioGroupItem id={`load-${load.value}`} value={load.value} className="sr-only"/><ShoppingBag size={18} className="mb-1"/><span className="text-sm font-medium">{load.title}</span><span className="text-xs text-muted-foreground">{load.detail}</span><span className="load-choice-price">{formatPrice(getUnloadPrice(load.value,false))}</span></motion.label>)}</RadioGroup></div>
        <div><label className="form-label" htmlFor="name">Your name</label><Input {...inputProps("name")} placeholder="First and last name" autoComplete="name" maxLength={80}/>{errorFor("name")}</div>
        <div><label className="form-label" htmlFor="phone">Phone number</label><Input {...inputProps("phone")} type="tel" placeholder="(352) 555-0123" autoComplete="tel" maxLength={30}/>{errorFor("phone")}<p className="mt-2 text-xs text-muted-foreground">So we can contact you about this request.</p></div>
        <label className="stairs-choice" htmlFor="stairs"><span className="flex min-w-0 items-center gap-3"><Checkbox id="stairs" checked={draft.stairs} onCheckedChange={v=>field("stairs",v===true)} className="size-5 shrink-0 rounded-md"/><span>There are stairs at my home</span></span><strong>+$5.00</strong></label>
        <motion.div layout className="booking-price-preview" aria-live="polite"><span>Current unload total</span><motion.strong key={totalPrice} initial={reduceMotion?false:{opacity:0,y:2}} animate={{opacity:1,y:0}} transition={quickSpring}>{formatPrice(totalPrice)}</motion.strong></motion.div>
        <div><label className="form-label" htmlFor="notes">Anything we should know? <span className="font-normal text-muted-foreground">(optional)</span></label><textarea id="notes" name="notes" value={draft.notes} onChange={e=>field("notes",e.target.value)} maxLength={1000} placeholder="Water cases, parking, where to put your bags…" rows={2} className="form-textarea w-full resize-y rounded-xl border border-input bg-[#f9fbf8] px-4 py-3 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"/>{errorFor("notes")}</div>
       </>}
       {step===2&&<>
        <motion.div layout className="overflow-hidden rounded-2xl border border-border bg-[#f8faf6]"><div className="flex items-center justify-between border-b border-border p-4"><h3 className="text-sm font-semibold">Your unload request</h3><button type="button" onClick={()=>move(0)} className="text-sm underline underline-offset-4">Edit</button></div><dl className="space-y-4 p-4 text-sm"><div><dt className="mb-1 text-muted-foreground">Home address</dt><dd className="break-words font-medium">{draft.address}<br/>{draft.city}, FL {draft.zip}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Home in</dt><dd>About {draft.eta} minutes</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Grocery load</dt><dd>{LOADS.find(l=>l.value===draft.load)?.detail}{draft.stairs?" · Stairs":""}</dd></div><div><dt className="mb-1 text-muted-foreground">Contact</dt><dd className="break-words">{draft.name} · {draft.phone}</dd></div>{draft.notes&&<div><dt className="mb-1 text-muted-foreground">Notes</dt><dd className="break-words">{draft.notes}</dd></div>}</dl></motion.div>
        <motion.div layout className="price-breakdown"><div><span>Base unload</span><strong>{formatPrice(basePrice)}</strong></div>{draft.stairs&&<motion.div initial={reduceMotion?false:{opacity:0,y:-4}} animate={{opacity:1,y:0}}><span>Stairs add-on</span><strong>+$5.00</strong></motion.div>}<div className="price-total"><span>Unload total</span><motion.strong key={totalPrice} initial={reduceMotion?false:{opacity:0,y:2}} animate={{opacity:1,y:0}} transition={quickSpring}>{formatPrice(totalPrice)}</motion.strong></div><p>No hidden service fee. Payment is not taken when you send the request.</p></motion.div>
        <label htmlFor="consent" className="flex items-start gap-3 text-sm leading-relaxed"><Checkbox id="consent" checked={draft.consent} onCheckedChange={v=>field("consent",v===true)} className="mt-0.5 size-5 shrink-0 rounded-md" aria-invalid={!!errors.consent}/><span>You can contact me about this unload. I understand my booking needs team confirmation.</span></label>{errorFor("consent")}
       </>}
      </motion.div>
     </AnimatePresence>

     <div className="hidden" aria-hidden="true"><label htmlFor="website">Leave this empty</label><input id="website" tabIndex={-1} autoComplete="off" value={draft.website} onChange={e=>field("website",e.target.value)}/></div>
     <AnimatePresence initial={false}>{error&&<motion.p initial={reduceMotion?false:{opacity:0,y:-6,scale:.99}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:-4}} className="rounded-xl bg-red-50 p-4 text-sm leading-relaxed text-destructive" role="alert">{error}</motion.p>}</AnimatePresence>
     <motion.div layout className="flex gap-3">
      <AnimatePresence initial={false}>
       {step>0&&<motion.div initial={reduceMotion?false:{opacity:0,x:-5}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-4}} whileTap={reduceMotion?undefined:{scale:.98}} transition={quickSpring} className="shrink-0"><Button type="button" variant="outline" className="h-[55px] w-14 rounded-[14px]" onClick={()=>move(step-1)} aria-label="Previous step"><ArrowLeft/></Button></motion.div>}
      </AnimatePresence>
      <motion.div className="min-w-0 flex-1" whileHover={reduceMotion?undefined:{y:-1,scale:1.002}} whileTap={reduceMotion?undefined:{scale:.99}} transition={quickSpring}>
       <Button type="submit" className="submit-button">{saving?<><LoaderCircle className="animate-spin"/> Sending request…</>:<>{["Continue","Review unload","Request my unload"][step]}<ArrowRight className="ml-2"/></>}</Button>
      </motion.div>
     </motion.div>
    </fieldset>
   </form>
   <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground"><LockKeyhole size={12}/> No payment now. No subscription.</p>
  </motion.section>
 </LayoutGroup>;
}
