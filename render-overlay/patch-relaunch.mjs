/* Production-safe overlay. Patch the authenticated homepage created by v30
   instead of replacing it with the unauthenticated root source. */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const runtime = join(root, ".runtime");
const homePath = join(runtime, "components", "home-page.tsx");
const formPath = join(runtime, "components", "booking-form.tsx");
const layoutPath = join(runtime, "app", "layout.tsx");
copyFileSync(join(root, "app", "dropcart-relaunch.css"), join(runtime, "app", "dropcart-relaunch.css"));
copyFileSync(join(root, "public", "dropcart-liquid-glass-init.js"), join(runtime, "public", "dropcart-liquid-glass-init.js"));
// Keep tracking return behavior synchronized with the latest customer-page overlay.
copyFileSync(join(root, "render-overlay", "customer-track-page.tsx"), join(runtime, "app", "track", "page.tsx"));

function requiredReplace(source, what, replacement, label) {
  if (!source.includes(what)) throw new Error("Dropcart experience patch: missing " + label);
  return source.replace(what, replacement);
}

let home = readFileSync(homePath, "utf8");
if (!home.includes('className="dc-hero-actions"')) {
  const desc = /<motion\.p variants=\{heroChild\} className="hero-description">[\s\S]*?<\/motion\.p>/;
  if (!desc.test(home)) throw new Error("Could not locate authenticated hero description");
  home = home.replace(desc,
    '<motion.p variants={heroChild} className="hero-description"><strong>You shop. We bring it inside.</strong><br />A local person to help with the last part of your grocery trip. Book ahead, head home, and leave the heavy bags to us.</motion.p>\n' +
    '            <motion.div variants={heroChild} className="dc-hero-actions">\n' +
    '              <a href="#book" className="dc-hero-action">Book an unload <ArrowUpRight size={15} aria-hidden="true" /></a>\n' +
    '              <a href="/track" className="dc-hero-action">Track a booking <ArrowUpRight size={15} aria-hidden="true" /></a>\n' +
    '            </motion.div>\n' +
    '            <motion.div variants={heroChild} className="dc-trust-line">\n' +
    '              <span><Check size={14} aria-hidden="true" /> Prices shown upfront</span>\n' +
    '              <span><HeartHandshake size={14} aria-hidden="true" /> Personally confirmed</span>\n' +
    '            </motion.div>');
}
if (!home.includes('href="/track">Track booking</a>')) {
  home = requiredReplace(home,
    '<a className="nav-link" href="#questions">FAQs</a>',
    '<a className="nav-link" href="#questions">FAQs</a>\n          <a className="nav-link" href="/track">Track booking</a>',
    "primary navigation");
}
if (!home.includes('dropcart:choose-load')) {
  home = requiredReplace(home,
    '<a className="pricing-book" href="#book">Choose this load <ArrowUpRight size={15} aria-hidden="true" /></a>',
    '<button type="button" className="pricing-book" onClick={() => { window.dispatchEvent(new CustomEvent("dropcart:choose-load", { detail: { load: (["small","medium","large"] as const)[index] } })); document.getElementById("book")?.scrollIntoView({behavior: reduceMotion ? "auto" : "smooth", block: "center"}); }}>Select this load <ArrowUpRight size={15} aria-hidden="true" /></button>',
    "real pricing selection");
}
writeFileSync(homePath, home);

let form = readFileSync(formPath, "utf8");
if (!form.includes("dropcart:choose-load")) {
  form = requiredReplace(form,
    ' const submitting=useRef(false);',
    ' const submitting=useRef(false);\n const [selectedFromPricing,setSelectedFromPricing]=useState(false);',
    "booking state");
  form = requiredReplace(form,
    ' useEffect(()=>{\n  const context=(document as Document',
    ' useEffect(() => {\n  const choose = (event: Event) => {\n   const load = (event as CustomEvent<{load?: string}>).detail?.load;\n   if (load !== "small" && load !== "medium" && load !== "large") return;\n   setDraft(prev => ({...prev, load}));\n   setSelectedFromPricing(true);\n   setErrors(prev => ({...prev, load: ""}));\n  };\n  window.addEventListener("dropcart:choose-load", choose);\n  return () => window.removeEventListener("dropcart:choose-load", choose);\n }, []);\n\n useEffect(()=>{\n  const context=(document as Document',
    "booking event listener");
  form = requiredReplace(form,
    '   <form onSubmit={submit} noValidate>',
    '   {step===0 && selectedFromPricing && <div className="dc-selected-load" role="status"><span><ShoppingBag size={15} aria-hidden="true"/>{LOADS.find(load=>load.value===draft.load)?.title} selected</span><strong>{formatPrice(getUnloadPrice(draft.load,false))}</strong></div>}\n   <form onSubmit={submit} noValidate>',
    "selection confirmation");
}
if (!form.includes('"dropcart-last-reference"')) {
  const tokenAnchor = 'localStorage.setItem("dropcart-access-"+confirmed.data.reference,confirmed.data.accessToken);';
  form = requiredReplace(form, tokenAnchor, tokenAnchor+'localStorage.setItem("dropcart-last-reference",confirmed.data.reference);', "recent tracking reference");
}
writeFileSync(formPath, form);

let layout = readFileSync(layoutPath, "utf8");
if (!layout.includes('import "./dropcart-relaunch.css";')) {
  if (!layout.includes('import "./smooth-flow.css";')) throw new Error("Smooth-flow must be installed before relaunch styles");
  layout = layout.replace('import "./smooth-flow.css";','import "./smooth-flow.css";\nimport "./dropcart-relaunch.css";');
  writeFileSync(layoutPath, layout);
}
console.log("Installed cohesive customer storefront, real booking selections, and tracking resume reference into production runtime.");
