import { z } from "zod";
export const ARRIVAL_TIMES=[15,30,45,60] as const;
export const LOADS=[{value:"small",title:"A few things",detail:"1–5 bags"},{value:"medium",title:"Weekly shop",detail:"6–15 bags"},{value:"large",title:"A full trunk",detail:"16+ bags"}] as const;
export const bookingSchema=z.object({requestId:z.string().uuid("Please refresh the page and try again."),address:z.string().trim().min(5,"Enter your full street address.").max(180),city:z.string().trim().min(2,"Enter your city.").max(80),zip:z.string().trim().regex(/^\d{5}$/,"Enter a 5-digit ZIP code."),eta:z.number().refine(v=>(ARRIVAL_TIMES as readonly number[]).includes(v),"Choose an arrival time."),load:z.enum(["small","medium","large"]),name:z.string().trim().min(2,"Enter your name.").max(80),phone:z.string().trim().max(30).refine(v=>/^\+?[\d\s().-]+$/.test(v)&&/^(1)?[2-9]\d{2}[2-9]\d{6}$/.test(v.replace(/\D/g,"")),"Enter a valid 10-digit US phone number."),stairs:z.boolean(),notes:z.string().trim().max(1000,"Please keep notes under 1,000 characters."),consent:z.literal(true,{errorMap:()=>({message:"Please agree so we can contact you about your unload."})}),website:z.string().max(0)});
export const locationSchema=bookingSchema.pick({address:true,city:true,zip:true,eta:true});
export const detailsSchema=bookingSchema.pick({name:true,phone:true,load:true,stairs:true,notes:true});
export const stageSchema=bookingSchema.omit({requestId:true,consent:true,website:true}).partial().strict();
export const receiptSchema=z.object({reference:z.string().regex(/^DC-[A-F0-9]{10}$/),status:z.string(),arrivalAt:z.number()});
export type BookingData=z.infer<typeof bookingSchema>;
