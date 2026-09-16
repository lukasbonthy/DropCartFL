"use client";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
const questions = [
 ["When should I book an unload?","Send your request while you’re finishing up at the store, before you start driving. Choose your estimated time home. We’ll contact you to confirm whether we can meet you."],
 ["How much does it cost?","Dropcart uses fixed unload pricing: $14.99 for 1–5 bags, $19.99 for 6–15 bags, and $27.99 for 16+ bags. Stairs add $5. You’ll see your total before you send the request, and there’s no online payment at that step."],
 ["Do you shop for me or deliver groceries?","You shop and bring your groceries home. Dropcart helps with the final part: carrying them from your vehicle to your kitchen, doorstep, or another place you choose."],
 ["Where is Dropcart available?","Dropcart is based in Inverness, Florida. Share your address when you request an unload, and we’ll confirm coverage and availability before booking your visit."],
 ["What if I have stairs or heavy items?","Stairs add $5 to the unload price. Add cases of water or any other heavy-item details to your request so we can plan the right assistance and confirm what we can safely carry before your visit."],
 ["Is my booking confirmed as soon as I submit?","Submitting saves your request. A booking is confirmed only after our team contacts you and you agree on availability and arrival time. Your selected load price is already shown before you submit, and no helper is automatically dispatched."]
];
export function Faq(){return <Accordion type="single" collapsible className="w-full">{questions.map(([q,a],i)=><AccordionItem value={String(i)} key={q} className="border-[#dce5db]"><AccordionTrigger className="py-5 text-base font-medium hover:no-underline">{q}</AccordionTrigger><AccordionContent className="pb-5 text-base leading-relaxed text-muted-foreground">{a}</AccordionContent></AccordionItem>)}</Accordion>;}
