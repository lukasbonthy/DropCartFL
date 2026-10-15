import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const runtime = join(root, ".runtime");
const app = join(runtime, "app");
const components = join(runtime, "components");
const source = (path) => readFileSync(join(root, path), "utf8");

if (!existsSync(join(app, "page.tsx")) || !existsSync(join(components, "booking-form.tsx"))) {
  throw new Error("Dropcart premium patch: packaged Render source was not expanded.");
}
copyFileSync(join(root, "app", "dropcart-premium.css"), join(app, "dropcart-premium.css"));
copyFileSync(join(root, "components", "quote-builder.tsx"), join(components, "quote-builder.tsx"));

const globalsPath = join(app, "globals.css");
let globals = readFileSync(globalsPath, "utf8");
if (!globals.includes('dropcart-premium.css')) {
  const imports = [...globals.matchAll(/^@import [^;]+;\s*$/gm)];
  if (imports.length) {
    const last = imports.at(-1);
    const at = last.index + last[0].length;
    globals = globals.slice(0, at) + '\n@import "./dropcart-premium.css";\n' + globals.slice(at);
  } else globals = '@import "./dropcart-premium.css";\n' + globals;
}
writeFileSync(globalsPath, globals);

// The v30 auth overlay moves the interactive homepage into a client component
// while app/page.tsx becomes a server wrapper carrying the authenticated user.
const interactiveHome = join(components, "home-page.tsx");
const pagePath = existsSync(interactiveHome) ? interactiveHome : join(app, "page.tsx");
let page = readFileSync(pagePath, "utf8");
if (!page.includes('import { QuoteBuilder, selectBookingLoad }')) {
  const anchor = 'import { BookingForm } from "@/components/booking-form";';
  const extra = 'import { QuoteBuilder, selectBookingLoad } from "@/components/quote-builder";';
  page = page.includes(anchor) ? page.replace(anchor, anchor + '\n' + extra) : page.replace('"use client";', '"use client";\n' + extra);
}
if (!page.includes('className="nav-utility"')) {
  page = page.replace(
    '<motion.a href="#book" className="pill-button"',
    '<a href="/track" className="nav-utility">Track my unload <ArrowUpRight size={15} aria-hidden="true" /></a>\n        <motion.a href="#book" className="pill-button"',
  );
}
if (!page.includes('className="hero-promises"')) {
  page = page.replace(
    'We’ll take your groceries from trunk to kitchen.</motion.p>',
    'We’ll take your groceries from trunk to kitchen.</motion.p>\n            <motion.div variants={heroChild} className="hero-promises"><span className="hero-promise"><Check size={14} aria-hidden="true"/> Pay only when you need us</span><span className="hero-promise"><Check size={14} aria-hidden="true"/> Upfront pricing</span></motion.div>',
  );
}
if (!page.includes('onClick={() => selectBookingLoad')) {
  page = page.replace(
    '<a className="pricing-book" href="#book">',
    '<a className="pricing-book" href="#book" onClick={event => { event.preventDefault(); selectBookingLoad({ load: (["small", "medium", "large"] as const)[index], stairs: false }); }}>',
  );
}
if (!page.includes('<QuoteBuilder />')) {
  const anchor = '<motion.div className="stairs-price-note"';
  if (page.includes(anchor)) page = page.replace(anchor, '<QuoteBuilder />\n          ' + anchor);
}
if (!page.includes('mobile-glass-dock')) {
  const mobileDock = source("app/page.tsx");
  const first = mobileDock.indexOf('<nav className="mobile-glass-dock"');
  const after = mobileDock.indexOf('</nav>', first);
  if (first < 0 || after < 0) throw new Error("Dropcart premium mobile dock source missing");
  const dock = mobileDock.slice(first, after + '</nav>'.length);
  if (!page.includes('</motion.header>')) throw new Error("Dropcart premium runtime header missing");
  page = page.replace('</motion.header>', '</motion.header>\n      ' + dock);
}
writeFileSync(pagePath, page);

const formPath = join(components, "booking-form.tsx");
let form = readFileSync(formPath, "utf8");
const sourceForm = source("components/booking-form.tsx");
if (!form.includes('LOAD_SELECTION_EVENT')) {
  const importLine = 'import { LOAD_SELECTION_EVENT, type BookingSelection } from "@/components/quote-builder";';
  const anchor = 'import { formatPrice, getUnloadPrice, type GroceryLoad } from "@/lib/pricing";';
  form = form.includes(anchor) ? form.replace(anchor, anchor + '\n' + importLine) : form.replace('"use client";', '"use client";\n' + importLine);
  const first = sourceForm.indexOf(' useEffect(()=>{\n  const onSelection=');
  const after = sourceForm.indexOf(' useEffect(()=>{\n  const context=', first);
  if (first < 0 || after < 0) throw new Error("Dropcart premium source listener not found");
  const listener = sourceForm.slice(first, after);
  const anchorEffect = ' useEffect(()=>{\n  const context=';
  if (!form.includes(anchorEffect)) throw new Error("Dropcart premium runtime booking anchor not found");
  form = form.replace(anchorEffect, listener + anchorEffect);
}
if (!form.includes('dropcart-last-reference')) {
  form = form.replace(
    'localStorage.setItem("dropcart-access-"+confirmed.data.reference,confirmed.data.accessToken);setReceipt',
    'localStorage.setItem("dropcart-access-"+confirmed.data.reference,confirmed.data.accessToken);localStorage.setItem("dropcart-last-reference",confirmed.data.reference);setReceipt',
  );
}
if (!form.includes('booking-mini-summary')) {
  form = form.replace(
    'Inverness & nearby. We’ll confirm your address is in our service area.</span></motion.div>',
    'Inverness & nearby. We’ll confirm your address is in our service area.</span></motion.div>\n        <div className="booking-mini-summary" aria-live="polite"><span><ShoppingBag size={15} aria-hidden="true"/> Your selected load · {draft.load === "small" ? "1–5 bags" : draft.load === "medium" ? "6–15 bags" : "16+ bags"}{draft.stairs ? " + stairs" : ""}</span><strong>{formatPrice(totalPrice)}</strong></div>',
  );
}
writeFileSync(formPath, form);
if (!page.includes('<QuoteBuilder />') || !form.includes('window.addEventListener(LOAD_SELECTION_EVENT')) {
  throw new Error("Dropcart premium: pricing estimator must be connected to booking.");
}
console.log("Installed Dropcart premium glass, pricing estimator, booking handoff, and tracking shortcut.");
