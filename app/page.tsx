"use client";

import { ArrowUpRight, Check, HeartHandshake, House, MapPin, ShoppingBag, ShoppingBasket, Smartphone } from "lucide-react";
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { BookingForm } from "@/components/booking-form";
import { Faq } from "@/components/faq";

const steps = [
  { n: "01", icon: Smartphone, title: "Check out. Check in.", text: "Before you leave the store, tell us when you’ll be home and how much you’re bringing." },
  { n: "02", icon: House, title: "Make your way home.", text: "Once we confirm your request, we’ll arrange a time to meet you right at your door." },
  { n: "03", icon: ShoppingBasket, title: "Leave the lifting to us.", text: "We carry your groceries from your vehicle to your kitchen, or another spot you choose." },
];

const spring = { type: "spring" as const, stiffness: 170, damping: 24, mass: 0.72 };
const reveal = { hidden: { opacity: 0, y: 16, scale: 0.994 }, shown: { opacity: 1, y: 0, scale: 1 } };

function Brand() {
  return <><span className="brand-mark"><ShoppingBag size={23} strokeWidth={2.1} aria-hidden="true" /></span><span className="brand-word">dropcart<span className="brand-dot">.</span></span></>;
}

export default function Home() {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const heroArtY = useTransform(scrollYProgress, [0, 0.28], reduceMotion ? [0, 0] : [0, -20]);
  const heroArtRotate = useTransform(scrollYProgress, [0, 0.28], reduceMotion ? [0, 0] : [0, -0.22]);
  const heroArtScale = useTransform(scrollYProgress, [0, 0.28], reduceMotion ? [1, 1] : [1, 1.01]);
  const scrollSpring = { stiffness: 105, damping: 28, mass: 0.82, restDelta: 0.001 };
  const heroArtYSmooth = useSpring(heroArtY, scrollSpring);
  const heroArtRotateSmooth = useSpring(heroArtRotate, scrollSpring);
  const heroArtScaleSmooth = useSpring(heroArtScale, scrollSpring);

  const heroParent = {
    hidden: {},
    shown: { transition: { staggerChildren: reduceMotion ? 0 : 0.07, delayChildren: reduceMotion ? 0 : 0.05 } },
  };
  const heroChild = {
    hidden: { opacity: 0, y: reduceMotion ? 0 : 14 },
    shown: { opacity: 1, y: 0, transition: spring },
  };

  return (
    <>
      <a href="#book" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-xl focus:bg-white focus:p-4">Skip to booking</a>
      <motion.header className="topbar shell" initial={reduceMotion ? false : { opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <a href="/" className="brand" aria-label="Dropcart home"><Brand /></a>
        <nav aria-label="Main navigation" className="nav-capsule">
          <a className="nav-link" href="#how-it-works">How it works</a>
          <a className="nav-link" href="#pricing">Pricing</a>
          <a className="nav-link" href="#why-dropcart">Why Dropcart</a>
          <a className="nav-link" href="#questions">FAQs</a>
        </nav>
        <motion.a href="#book" className="pill-button" whileHover={reduceMotion ? undefined : { y: -1, scale: 1.004 }} whileTap={reduceMotion ? undefined : { scale: 0.988 }} transition={spring}>
          Book an unload <ArrowUpRight size={16} aria-hidden="true" />
        </motion.a>
      </motion.header>

      <main>
        <section className="hero" aria-label="Grocery unloading and booking">
          <motion.div className="hero-copy" variants={heroParent} initial="hidden" animate="shown">
            <motion.div variants={heroChild} className="eyebrow"><MapPin size={14} aria-hidden="true" /> A local hand in Inverness, FL</motion.div>
            <motion.h1 variants={heroChild} className="hero-title">Less lifting.<br /><span>More living.</span></motion.h1>
            <motion.p variants={heroChild} className="hero-description"><strong>You shop. We’ll bring it inside.</strong><br />Book a helping hand before you leave the store.<br className="hidden xl:block" /> We’ll take your groceries from trunk to kitchen.</motion.p>
          </motion.div>

          <BookingForm />

          <motion.div className="hero-art" style={{ y: heroArtYSmooth, rotate: heroArtRotateSmooth, scale: heroArtScaleSmooth }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <motion.img
              src="https://dropcart.lukasbonthy.chatgpt.site/groceries.png"
              width={1536}
              height={1024}
              alt="Two full grocery bags with fresh fruit, vegetables, and bread"
              fetchPriority="high"
              className="grocery-visual"
              initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.985 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: [0, -3, 0], scale: [1, 1.003, 1] }}
              transition={reduceMotion ? { duration: 0 } : { opacity: { duration: 0.5 }, y: { duration: 8.5, repeat: Infinity, ease: "easeInOut" }, scale: { duration: 8.5, repeat: Infinity, ease: "easeInOut" } }}
            />
            <motion.div className="art-label" initial={reduceMotion ? false : { opacity: 0, x: -8, y: 6, rotate: -3.5 }} animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0, y: [0, -1.5, 0], rotate: -3 }} transition={reduceMotion ? { duration: 0 } : { opacity: { duration: 0.45, delay: 0.18 }, x: spring, y: { duration: 7.5, repeat: Infinity, ease: "easeInOut", delay: 0.4 } }}>
              <span className="art-label-icon"><ShoppingBag size={20} strokeWidth={1.6} aria-hidden="true" /></span><div><strong>From your car. To your kitchen.</strong><small>We’ve got the heavy part.</small></div>
            </motion.div>
            <motion.span className="hero-side-note" aria-hidden="true" initial={reduceMotion ? false : { opacity: 0, x: 8 }} animate={{ opacity: 0.75, x: 0 }} transition={{ ...spring, delay: 0.25 }}>FULL BAGS. LIGHTER DAYS.</motion.span>
          </motion.div>
        </section>

        <section className="benefits-row shell" aria-label="What comes with your unload">
          {[
            [House, "All the way inside", "Set down right where you need them."],
            [HeartHandshake, "Real people. A little extra care.", "A helping hand, close to home."],
            [Check, "Only when you need us", "No subscriptions or ongoing commitments."],
          ].map(([Icon, title, text], index) => {
            const BenefitIcon = Icon as typeof House;
            return (
              <motion.div className="benefit" key={String(title)} variants={reveal} initial="hidden" whileInView="shown" viewport={{ once: true, amount: 0.45 }} transition={{ ...spring, delay: reduceMotion ? 0 : index * 0.08 }} whileHover={reduceMotion ? undefined : { y: -2 }}>
                <BenefitIcon size={21} strokeWidth={1.6} aria-hidden="true" /><div><strong>{String(title)}</strong><p>{String(text)}</p></div>
              </motion.div>
            );
          })}
        </section>

        <motion.section id="pricing" className="pricing-section shell" variants={reveal} initial="hidden" whileInView="shown" viewport={{ once: true, amount: 0.22 }} transition={spring}>
          <div className="pricing-intro">
            <div><p className="section-eyebrow mb-4">Simple, upfront pricing</p><h2 className="section-title">Pick the load.<br />See the price.</h2></div>
            <p>No membership. No hidden service fee. Your unload price is based on how many grocery bags you’re bringing.</p>
          </div>
          <div className="pricing-grid">
            {[
              { name: "A few things", bags: "1–5 bags", price: "$14.99", note: "Quick grocery runs" },
              { name: "Weekly shop", bags: "6–15 bags", price: "$19.99", note: "Most grocery trips", featured: true },
              { name: "A full trunk", bags: "16+ bags", price: "$27.99", note: "Big restocks & full carts" },
            ].map((tier, index) => (
              <motion.article key={tier.name} className={`pricing-card${tier.featured ? " featured" : ""}`} initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.994 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} viewport={{ once: true, amount: 0.35 }} transition={{ ...spring, delay: reduceMotion ? 0 : index * 0.08 }} whileHover={reduceMotion ? undefined : { y: -3, scale: 1.004 }}>
                {tier.featured && <span className="pricing-popular">Most common</span>}
                <span className="pricing-icon"><ShoppingBag size={21} strokeWidth={1.7} aria-hidden="true" /></span>
                <p className="pricing-name">{tier.name}</p>
                <p className="pricing-bags">{tier.bags}</p>
                <div className="pricing-price"><strong>{tier.price}</strong><span>/ unload</span></div>
                <p className="pricing-note-copy">{tier.note}</p>
                <a className="pricing-book" href="#book">Choose this load <ArrowUpRight size={15} aria-hidden="true" /></a>
              </motion.article>
            ))}
          </div>
          <motion.div className="stairs-price-note" whileHover={reduceMotion ? undefined : { y: -1 }} transition={spring}>
            <span className="stairs-price-icon"><House size={19} strokeWidth={1.7} aria-hidden="true" /></span>
            <div><strong>Stairs at home?</strong><p>Add <b>+$5</b> to any unload. You’ll see the total before you send your request.</p></div>
          </motion.div>
        </motion.section>

        <section id="how-it-works" className="how-section shell">
          <motion.div className="section-intro" variants={reveal} initial="hidden" whileInView="shown" viewport={{ once: true, amount: 0.35 }} transition={spring}>
            <div><p className="section-eyebrow mb-4">A better end to your grocery run</p><h2 className="section-title">Three steps.<br />Zero heavy lifting.</h2></div>
            <p>Keep your favorite store.<br />Leave the last few trips to us.</p>
          </motion.div>
          <div className="steps-grid">
            {steps.map((item, index) => (
              <motion.article className="step-card" key={item.n} variants={reveal} initial="hidden" whileInView="shown" viewport={{ once: true, amount: 0.28 }} transition={{ ...spring, delay: reduceMotion ? 0 : index * 0.09 }} whileHover={reduceMotion ? undefined : { y: -3, scale: 1.004 }} whileTap={reduceMotion ? undefined : { scale: 0.992 }}>
                <div className="step-top"><span className="step-icon"><item.icon size={23} strokeWidth={1.6} aria-hidden="true" /></span><span className="step-number">STEP {item.n}</span></div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </motion.article>
            ))}
          </div>
        </section>

        <motion.section className="care-panel shell" id="why-dropcart" variants={reveal} initial="hidden" whileInView="shown" viewport={{ once: true, amount: 0.28 }} transition={spring} whileHover={reduceMotion ? undefined : { y: -2, scale: 1.002 }}>
          <div><span className="care-icon"><HeartHandshake size={27} strokeWidth={1.5} aria-hidden="true" /></span><p className="section-eyebrow mb-3">Made for real life</p><h2 className="section-title">A little help.<br />A lot of relief.</h2></div>
          <div className="care-copy"><p>Taking it easy, recovering from an injury, or just carrying a full day? Everyone could use an extra pair of hands.</p><p className="mt-4">You don’t need a reason to ask.</p><div className="care-signoff"><House size={19} aria-hidden="true" /><span>Your groceries. Your home. Your pace.</span></div></div>
        </motion.section>

        <motion.section id="questions" className="faq-section shell" variants={reveal} initial="hidden" whileInView="shown" viewport={{ once: true, amount: 0.2 }} transition={spring}>
          <div><p className="section-eyebrow mb-4">The little details</p><h2 className="section-title">Good questions.<br />Simple answers.</h2><p className="mt-6 max-w-[260px] text-base leading-relaxed text-muted-foreground">Everything you need to know before your first unload.</p></div>
          <Faq />
        </motion.section>
      </main>

      <motion.footer className="footer shell" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: reduceMotion ? 0 : 0.55 }}>
        <a href="/" className="brand" aria-label="Dropcart home"><Brand /></a>
        <p>A little help. A whole lot lighter.</p>
        <small>© {new Date().getUTCFullYear()} Dropcart</small>
      </motion.footer>
    </>
  );
}
