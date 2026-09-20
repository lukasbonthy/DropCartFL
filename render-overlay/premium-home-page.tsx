"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Clock3, HeartHandshake, House, KeyRound, MapPin, Menu, MessageCircle, Navigation, ShieldCheck, ShoppingBag, ShoppingBasket, Smartphone, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { BookingForm } from "@/components/booking-form";
import { DropcartWordmark } from "@/components/dropcart-wordmark";
import { MobileAppDock } from "@/components/mobile-app-dock";
import { Faq } from "@/components/faq";
import { formatPrice, getUnloadPrice, type GroceryLoad } from "@/lib/pricing";

type Props = { user: { displayName: string; email: string } | null; signInHref: string; signUpHref: string; signOutHref: string };
const tiers: { load: GroceryLoad; name: string; bags: string; description: string }[] = [
  { load: "small", name: "The quick trip", bags: "1–5 bags", description: "Just the essentials. We’ll take it from here." },
  { load: "medium", name: "The weekly shop", bags: "6–15 bags", description: "Your usual grocery run, with a lighter finish." },
  { load: "large", name: "The full trunk", bags: "16+ bags", description: "Big restock? Bring an extra pair of hands." },
];
const steps = [
  { icon: Smartphone, title: "You check out.", text: "Before you drive, tell us when you’ll be home and how much you’re bringing." },
  { icon: Navigation, title: "We make a plan.", text: "Our team confirms your request and arranges a time to meet you at home." },
  { icon: ShoppingBasket, title: "We bring it in.", text: "From your trunk to your kitchen, or wherever you’d like your bags set down." },
];

export default function HomePage({ user, signInHref, signUpHref }: Props) {
  const reduced = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadSelection, setLoadSelection] = useState<{ load: GroceryLoad; selectionId: number }>();
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);
  const reveal = { initial: { y: reduced ? 0 : 16 }, whileInView: { y: 0 }, viewport: { once: true, amount: .15 }, transition: { duration: reduced ? 0 : .65, ease: [.16, 1, .3, 1] as const } };
  const chooseLoad = (load: GroceryLoad) => setLoadSelection(previous => ({ load, selectionId: (previous?.selectionId ?? 0) + 1 }));

  return <div className="dc-home">
    <header className="dc-header">
      <div className="dc-header-inner dc-container">
        <a href="/" className="brand dc-brand" aria-label="Dropcart home"><DropcartWordmark /></a>
        <nav className="dc-desktop-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a><a href="#pricing">Pricing</a><a href="#why-dropcart">Our promise</a><a href="#questions">FAQs</a>
        </nav>
        <div className="dc-header-actions">
          <a className="dc-login-link" href={user ? "/account" : signInHref}>{user ? "My account" : "Log in"}</a>
          <a href="#book" className="dc-button dc-button-dark dc-header-book">Book an unload <ArrowUpRight size={17} aria-hidden="true" /></a>
          <button className="dc-menu-button" type="button" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-controls="dc-mobile-menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button>
        </div>
      </div>
      <nav id="dc-mobile-menu" className="dc-mobile-menu" hidden={!menuOpen} aria-label="More navigation" onClick={() => setMenuOpen(false)}>
        <a href="#how-it-works">How it works <ArrowUpRight size={17}/></a><a href="#pricing">Pricing <ArrowUpRight size={17}/></a><a href="#why-dropcart">Our promise <ArrowUpRight size={17}/></a><a href="#questions">Questions <ArrowUpRight size={17}/></a><a href={user ? "/account" : signUpHref}>{user ? "My account" : "Create an account"} <ArrowUpRight size={17}/></a>
      </nav>
    </header>

    <main id="main-content">
      <section className="dc-hero dc-container" aria-labelledby="dc-hero-title">
        <div className="dc-hero-copy">
          <span className="dc-location"><MapPin size={15} aria-hidden="true"/> A local hand in Inverness, Florida</span>
          <h1 id="dc-hero-title"><span>Less lifting.</span><span className="dc-hero-accent">More living.</span></h1>
          <p className="dc-hero-description">You did the shopping.<br/>Let us take care of the heavy part.</p>
          <p className="dc-hero-detail">Friendly help carrying your groceries from your car to your kitchen. Book before you leave the store.</p>
          <div className="dc-hero-actions"><a href="#book" className="dc-button dc-button-lime">Book my unload <ArrowUpRight size={21} aria-hidden="true"/></a><span>Starting at <strong>{formatPrice(getUnloadPrice("small", false))}</strong><small>No membership needed.</small></span></div>
          <div className="dc-hero-reassurance"><Check size={16} aria-hidden="true"/><span>Your store. Your groceries. A little extra help.</span></div>
        </div>
        <div className="dc-hero-visual">
          <div className="dc-visual-top"><span>FULL BAGS. LIGHTER DAYS.</span><ShoppingBag size={23} strokeWidth={1.4} aria-hidden="true"/></div>
          <img className="dc-groceries" src="/groceries.webp" width="1536" height="1024" alt="Paper grocery bags filled with fresh vegetables, fruit, and bread" fetchPriority="high"/>
          <div className="dc-price-stamp"><ShoppingBag size={20} aria-hidden="true"/><span>From</span><strong>$14.99</strong><span>per unload</span></div>
          <div className="dc-route-card"><span className="dc-route-icon"><ShoppingBag size={20} aria-hidden="true"/></span><div><span>From your trunk</span><strong>All the way inside.</strong></div><ArrowRight size={20} aria-hidden="true"/><span className="dc-route-icon dc-route-home"><House size={20} aria-hidden="true"/></span></div>
        </div>
      </section>

      <div className="dc-perks dc-container" aria-label="What comes with your unload">
        <span><HeartHandshake size={21} aria-hidden="true"/> A helping hand, close to home</span><span><House size={21} aria-hidden="true"/> Trunk to kitchen</span><span><Check size={21} aria-hidden="true"/> Upfront pricing, every time</span>
      </div>

      <motion.section {...reveal} id="how-it-works" className="dc-how dc-container" aria-labelledby="dc-how-title">
        <div className="dc-section-heading"><div><p className="dc-eyebrow">THE LAST PART IS OUR PART</p><h2 id="dc-how-title">Your usual shop.<br/><em>A better trip home.</em></h2></div><p>No new shopping routine.<br/>Just one less thing to carry.</p></div>
        <div className="dc-steps">{steps.map(({ icon: Icon, title, text }, i) => <article className="dc-step" key={title}><div className="dc-step-top"><span className="dc-icon-tile"><Icon size={25} strokeWidth={1.5} aria-hidden="true"/></span><span className="dc-step-number">0{i + 1}</span></div><h3>{title}</h3><p>{text}</p></article>)}</div>
      </motion.section>

      <section className="dc-booking-section" aria-labelledby="dc-booking-section-title">
        <div className="dc-booking-layout dc-container">
          <div className="dc-booking-copy"><p className="dc-eyebrow">LET’S LIGHTEN THE LOAD</p><h2 id="dc-booking-section-title">Almost home?<br/><em>We’ve got you.</em></h2><p>A few details now. Fewer trips from the car later.</p><div className="dc-booking-points"><span><Clock3 size={21} aria-hidden="true"/><span><strong>Plan around your arrival</strong><small>Tell us your estimated time home.</small></span></span><span><ShieldCheck size={21} aria-hidden="true"/><span><strong>You’re always in the loop</strong><small>Our team confirms availability before your visit.</small></span></span><span><ShoppingBag size={21} aria-hidden="true"/><span><strong>See your total before you send</strong><small>No online payment at this step.</small></span></span></div><div className="dc-booking-account"><span>{user ? "Welcome back to a lighter day." : "Make the next visit even easier."}</span><a href={user ? "/account" : signUpHref}>{user ? "Open your dashboard" : "Create a free account"}<ArrowUpRight size={16} aria-hidden="true"/></a></div></div>
          <BookingForm loadSelection={loadSelection}/>
        </div>
      </section>

      <motion.section {...reveal} id="pricing" className="dc-pricing dc-container" aria-labelledby="dc-pricing-title">
        <div className="dc-section-heading"><div><p className="dc-eyebrow">LESS GUESSWORK, TOO</p><h2 id="dc-pricing-title">A little help.<br/><em>A clear price.</em></h2></div><p>Choose your grocery load.<br/>We’ll show the total before you request.</p></div>
        <div className="dc-pricing-grid">{tiers.map((tier, i) => <article className={`dc-price-card ${i === 1 ? "dc-price-featured" : ""}`} key={tier.load}>
          <div className="dc-price-top"><ShoppingBag size={25} strokeWidth={1.5} aria-hidden="true"/>{i === 1 && <span>THE WEEKLY ESSENTIAL</span>}</div><h3>{tier.name}</h3><p className="dc-bag-count">{tier.bags}</p><div className="dc-price-value"><strong>{formatPrice(getUnloadPrice(tier.load, false))}</strong><span>/ unload</span></div><p className="dc-price-description">{tier.description}</p><div className="dc-price-includes"><span><Check size={16} aria-hidden="true"/> Car-to-kitchen carrying</span><span><Check size={16} aria-hidden="true"/> Set down where you choose</span></div><a href="#book" className="dc-price-link" onClick={() => chooseLoad(tier.load)} aria-label={`Choose ${tier.bags} for ${formatPrice(getUnloadPrice(tier.load, false))}`}>Choose this unload<ArrowUpRight size={19} aria-hidden="true"/></a>
        </article>)}</div>
        <div className="dc-pricing-footnote"><House size={20} aria-hidden="true"/><p>Have stairs? <strong>Add $5.</strong> No membership. No hidden service fee.</p></div>
      </motion.section>

      <motion.section {...reveal} id="why-dropcart" className="dc-care dc-container" aria-labelledby="dc-care-title">
        <div className="dc-care-image"><img src="/unpacking.webp" width="1100" height="733" alt="A person putting away fresh groceries in a bright kitchen" loading="lazy" decoding="async"/><div className="dc-care-caption"><HeartHandshake size={23} aria-hidden="true"/><span>A small hand.<br/><strong>A whole lot of relief.</strong></span></div></div>
        <div className="dc-care-copy"><p className="dc-eyebrow">GOOD HELP FEELS PERSONAL</p><h2 id="dc-care-title">Your home.<br/>Your pace.<br/><em>Your peace of mind.</em></h2><p>Full hands, a long day, or just taking it easy. You don’t need a reason to ask for help.</p><div className="dc-trust-list"><div><Navigation size={21} aria-hidden="true"/><span><strong>Follow your driver</strong><small>See shared location updates once your driver is on the way.</small></span></div><div><MessageCircle size={21} aria-hidden="true"/><span><strong>Keep the conversation close</strong><small>Message your driver right from your booking page.</small></span></div><div><KeyRound size={21} aria-hidden="true"/><span><strong>A little extra reassurance</strong><small>Add an optional code word. Ask your assigned driver to say it when they arrive.</small></span></div></div><a href="#book" className="dc-text-link">A helping hand starts here <ArrowUpRight size={18} aria-hidden="true"/></a></div>
      </motion.section>

      <section id="reviews" className="dc-neighborhood dc-container" aria-labelledby="dc-neighborhood-title"><span className="dc-neighborhood-icon"><HeartHandshake size={30} strokeWidth={1.4} aria-hidden="true"/></span><div><p className="dc-eyebrow">GROWING, ONE GROCERY RUN AT A TIME</p><h2 id="dc-neighborhood-title">New here. Here for you.</h2><p>We’re starting close to home in Inverness. Customer stories are still to come. For now, we’re focused on making your first unload a good one.</p></div><a href="#book" className="dc-text-link">Try your first unload <ArrowUpRight size={18} aria-hidden="true"/></a></section>

      <motion.section {...reveal} id="questions" className="dc-faq dc-container" aria-labelledby="dc-faq-title"><div><p className="dc-eyebrow">BEFORE WE LEND A HAND</p><h2 id="dc-faq-title">Good questions.<br/><em>Simple answers.</em></h2><p>A few things to know before<br/>your first unload.</p><a href="#book" className="dc-text-link">Ready when you are <ArrowDown size={17} aria-hidden="true"/></a></div><Faq/></motion.section>

      <section className="dc-last-call dc-container"><div><p className="dc-eyebrow">THE BEST PART OF GETTING HOME?</p><h2>Being home.<br/><em>Let us handle the rest.</em></h2></div><div><a href="#book" className="dc-button dc-button-lime">Book my unload <ArrowUpRight size={21} aria-hidden="true"/></a><span>From $14.99. A whole lot lighter.</span></div></section>
    </main>

    <footer className="dc-footer dc-container"><div className="dc-footer-main"><div><a href="/" className="brand dc-brand" aria-label="Dropcart home"><DropcartWordmark/></a><p>Less lifting. More living.<br/>A helping hand in Inverness, Florida.</p></div><nav aria-label="Footer navigation"><a href="#how-it-works">How it works</a><a href="#pricing">Pricing</a><a href="#questions">FAQs</a><a href={user ? "/account" : signInHref}>My account</a><a href="/employee/login">Employee portal</a></nav></div><div className="dc-footer-bottom"><span>© {new Date().getFullYear()} Dropcart</span><span>From your car. To your kitchen.</span><a href="#main-content">Back to top ↑</a></div></footer>
    <MobileAppDock accountHref={user ? "/account" : signInHref}/>
  </div>;
}
