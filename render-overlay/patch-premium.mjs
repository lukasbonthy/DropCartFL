import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const source = join(root, "render-overlay");
const runtime = join(root, ".runtime");
for (const [from, to] of [
  ["premium-home-page.tsx", "components/home-page.tsx"],
  ["premium-auth-page.tsx", "components/auth-page.tsx"],
  ["premium-mobile-app-dock.tsx", "components/mobile-app-dock.tsx"],
  ["premium.css", "app/premium.css"],
  ["assets/unpacking.webp", "public/unpacking.webp"],
]) copyFileSync(join(source, from), join(runtime, to));

function edit(path, transform) {
  const filename = join(runtime, path);
  writeFileSync(filename, transform(readFileSync(filename, "utf8")));
}

edit("app/layout.tsx", value => value.includes('import "./premium.css";') ? value : value.replace('import "./mobile-app-v27.css";', 'import "./mobile-app-v27.css";\nimport "./premium.css";'));

edit("components/booking-form.tsx", value => {
  if (value.includes("type LoadSelection")) return value;
  value = value.replace("export function BookingForm(){\n return <MotionConfig reducedMotion=\"user\"><BookingFormContent/></MotionConfig>;\n}", 'type LoadSelection = { load: GroceryLoad; selectionId: number };\nexport function BookingForm({ loadSelection }: { loadSelection?: LoadSelection } = {}){\n return <MotionConfig reducedMotion="user"><BookingFormContent loadSelection={loadSelection}/></MotionConfig>;\n}');
  value = value.replace("function BookingFormContent(){", "function BookingFormContent({ loadSelection }: { loadSelection?: LoadSelection }){");
  const marker = ' const field=(key:keyof Draft';
  if (!value.includes(marker)) throw new Error("Booking state marker missing.");
  value = value.replace(marker, ` useEffect(() => {
  if (!loadSelection || submitting.current) return;
  setDraft(previous => ({ ...previous, load: loadSelection.load, consent: false }));
  setReceipt(null); setStep(0); setDirection(-1); setErrors({}); setError(""); requestId.current = "";
 }, [loadSelection]);
${marker}`);
  return value;
});

edit("components/booking-form.tsx", value => value.replace(
  'requestAnimationFrame(()=>document.getElementById("booking-title")?.focus({preventScroll:true}));',
  'requestAnimationFrame(()=>{const heading=document.getElementById("booking-title");heading?.focus({preventScroll:true});heading?.scrollIntoView({block:"start",behavior:reduceMotion?"instant":"smooth"});});',
));

// Make tracking reachable from both the latest request and its history row.
edit("components/account-dashboard.tsx", value => value.includes("Track & message") ? value : value.replace('<a href="/#book"><ShoppingBag size={15} aria-hidden="true"/> Book another</a>', '<a href={"/track?ref=" + encodeURIComponent(booking.reference)}><Navigation size={15} aria-hidden="true"/> Track & message</a>\n      <a href="/#book"><ShoppingBag size={15} aria-hidden="true"/> Book another</a>').replace('  MapPin,', '  MapPin,\n  Navigation,').replace('<a href="/#book">Book again <ArrowUpRight size={14} aria-hidden="true"/></a>', '<a href={"/track?ref=" + encodeURIComponent(booking.reference)}>Track & message <ArrowUpRight size={14} aria-hidden="true"/></a><a href="/#book">Book again <ArrowUpRight size={14} aria-hidden="true"/></a>'));

edit("lib/motion-system.ts", value => value.replace("delayChildren = MOTION_TIMING.sectionDelay", "delayChildren: number = MOTION_TIMING.sectionDelay").replace("staggerChildren = MOTION_TIMING.itemStagger", "staggerChildren: number = MOTION_TIMING.itemStagger"));

console.log("Applied Dropcart premium design and booking flow improvements.");
