"use client";

import { useState } from "react";
import { ArrowUpRight, Minus, Plus, ShieldCheck, ShoppingBasket } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { formatPrice, getUnloadPrice, type GroceryLoad } from "@/lib/pricing";

export type BookingSelection = { load: GroceryLoad; stairs: boolean };
export const LOAD_SELECTION_EVENT = "dropcart:select-load";

export function loadForBagCount(bags: number): GroceryLoad {
  return bags <= 5 ? "small" : bags <= 15 ? "medium" : "large";
}

export function selectBookingLoad(selection: BookingSelection) {
  window.dispatchEvent(new CustomEvent<BookingSelection>(LOAD_SELECTION_EVENT, { detail: selection }));
  const booking = document.getElementById("book");
  booking?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
}

const labels: Record<GroceryLoad, string> = {
  small: "A few things · 1–5 bags",
  medium: "Weekly shop · 6–15 bags",
  large: "Full trunk · 16+ bags",
};

export function QuoteBuilder() {
  const [bags, setBags] = useState(8);
  const [stairs, setStairs] = useState(false);
  const reduceMotion = useReducedMotion();
  const load = loadForBagCount(bags);
  const total = getUnloadPrice(load, stairs);
  const base = getUnloadPrice(load, false);
  const updateBags = (next: number) => {
    if (!Number.isFinite(next)) return;
    setBags(Math.min(99, Math.max(1, Math.round(next))));
  };

  return (
    <section className="quote-studio" aria-label="Estimate your grocery unload cost">
      <div>
        <p className="quote-eyebrow"><ShoppingBasket size={16} aria-hidden="true" /> Quick price estimate</p>
        <h3 className="quote-heading">Know the total before you book.</h3>
        <p className="quote-helper">Tell us how many bags are in your cart. Your price updates instantly, then carries into the booking form.</p>
        <div className="quote-controls">
          <div className="quote-control">
            <label className="quote-control-label" htmlFor="quote-bags">Grocery bags</label>
            <div className="quote-stepper">
              <button aria-label="Remove one bag" type="button" disabled={bags <= 1} onClick={() => updateBags(bags - 1)}><Minus size={16}/></button>
              <input id="quote-bags" type="number" min="1" max="99" inputMode="numeric" value={bags} onChange={(event) => updateBags(Number(event.target.value))} aria-label="Number of grocery bags"/>
              <button aria-label="Add one bag" type="button" disabled={bags >= 99} onClick={() => updateBags(bags + 1)}><Plus size={16}/></button>
            </div>
          </div>
          <label className="quote-stairs">
            <input type="checkbox" checked={stairs} onChange={event => setStairs(event.target.checked)} />
            Stairs at my home <span aria-hidden="true">·</span> +$5
          </label>
        </div>
      </div>
      <div className="quote-summary" aria-live="polite" aria-atomic="true">
        <span className="quote-summary-label">Your estimated unload</span>
        <motion.strong className="quote-total" key={total} initial={reduceMotion ? false : { opacity: .65, y: 4 }} animate={{opacity:1,y:0}} transition={{duration:.2}}>{formatPrice(total)}</motion.strong>
        <div className="quote-breakdown"><span>{labels[load]}</span><span>{formatPrice(base)}</span></div>
        {stairs && <div className="quote-breakdown"><span>Stairs</span><span>+$5.00</span></div>}
        <button className="quote-cta" type="button" onClick={() => selectBookingLoad({ load, stairs })}>Use this estimate <ArrowUpRight size={18} aria-hidden="true"/></button>
        <p className="quote-caveat"><ShieldCheck size={13} aria-hidden="true" className="inline-block mr-1 align-[-2px]" /> No payment now. Team confirmation is required.</p>
      </div>
    </section>
  );
}
