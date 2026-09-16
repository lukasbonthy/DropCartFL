import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), ".runtime");
const homePath = join(root, "components/home-page.tsx");
const layoutPath = join(root, "app/layout.tsx");
const cssPath = join(root, "app/hero-balance.css");

let home = readFileSync(homePath, "utf8");
const oldImport = 'import { ArrowUpRight, Check, HeartHandshake, House, LockKeyhole, MapPin, Quote, ShoppingBag, ShoppingBasket, Smartphone, Star } from "lucide-react";';
const newImport = 'import { ArrowUpRight, Check, HeartHandshake, House, Leaf, LockKeyhole, MapPin, Quote, ShoppingBag, ShoppingBasket, Smartphone, Star, Users, Zap } from "lucide-react";';
if (!home.includes(newImport)) {
  if (!home.includes(oldImport)) throw new Error("V26 hero icon import changed; refusing to apply stale overlay.");
  home = home.replace(oldImport, newImport);
}

const anchor = `          </motion.div>\n\n          <BookingForm />\n`;
const featureLayer = `          </motion.div>\n\n          <motion.div\n            className="hero-feature-stack"\n            initial={reduceMotion ? false : { opacity: 0, x: 10 }}\n            animate={{ opacity: 1, x: 0 }}\n            transition={{ ...dropcartSpring, delay: reduceMotion ? 0 : 0.22 }}\n            aria-label="Dropcart service highlights"\n          >\n            <span className="hero-feature-flow" aria-hidden="true" />\n            {[\n              [Zap, "Same-day help", "Get matched quickly"],\n              [Users, "Local & trusted", "Real people in your area"],\n              [Leaf, "No subscription", "Just when you need it"],\n            ].map(([Icon, title, text], index) => {\n              const FeatureIcon = Icon as typeof Zap;\n              return (\n                <motion.div\n                  className="hero-feature-chip"\n                  key={String(title)}\n                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}\n                  animate={{ opacity: 1, y: 0 }}\n                  transition={{ ...dropcartSpring, delay: reduceMotion ? 0 : 0.27 + index * 0.06 }}\n                >\n                  <span className="hero-feature-icon"><FeatureIcon size={18} strokeWidth={1.8} aria-hidden="true" /></span>\n                  <span className="hero-feature-copy"><strong>{String(title)}</strong><small>{String(text)}</small></span>\n                </motion.div>\n              );\n            })}\n          </motion.div>\n\n          <BookingForm />\n`;
if (!home.includes('className="hero-feature-stack"')) {
  if (!home.includes(anchor)) throw new Error("V26 booking anchor changed; refusing to apply stale overlay.");
  home = home.replace(anchor, featureLayer);
}
writeFileSync(homePath, home);

let layout = readFileSync(layoutPath, "utf8");
if (!layout.includes('import "./hero-balance.css";')) {
  if (!layout.includes('import "./globals.css";')) throw new Error("V26 layout stylesheet import changed.");
  layout = layout.replace('import "./globals.css";', 'import "./globals.css";\nimport "./hero-balance.css";');
}
writeFileSync(layoutPath, layout);

writeFileSync(cssPath, `/* Desktop hero balance overlay for Dropcart V26. */
.hero::after {
  content: "";
  position: absolute;
  z-index: 0;
  top: 70px;
  left: 43%;
  width: 390px;
  height: 300px;
  border-radius: 50%;
  background: radial-gradient(circle, #5b9b4f2b 0, #3e7c4520 28%, transparent 70%);
  filter: blur(18px);
  pointer-events: none;
}
.hero-feature-stack {
  position: absolute;
  z-index: 2;
  top: 96px;
  right: 500px;
  display: grid;
  gap: 11px;
  width: 244px;
}
.hero-feature-chip {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 58px;
  padding: 9px 12px 9px 9px;
  border: 1px solid #dff7c11f;
  border-radius: 17px;
  color: #edf7e4;
  background: linear-gradient(145deg, #ffffff10, #ffffff08);
  box-shadow: inset 0 1px 0 #ffffff10, 0 10px 26px -20px #00130b;
  backdrop-filter: blur(12px);
}
.hero-feature-chip:nth-of-type(2) { transform: translateX(34px); }
.hero-feature-chip:nth-of-type(3) { transform: translateX(12px); }
.hero-feature-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid #ddf6b025;
  border-radius: 12px;
  color: #d1f48e;
  background: #d9ff9c0c;
  box-shadow: inset 0 1px 0 #ffffff0c;
}
.hero-feature-copy { min-width: 0; }
.hero-feature-copy strong, .hero-feature-copy small { display: block; }
.hero-feature-copy strong {
  color: #f3f8ed;
  font-size: .8rem;
  font-weight: 700;
  letter-spacing: -.015em;
}
.hero-feature-copy small {
  margin-top: 2px;
  color: #aebfab;
  font-size: .67rem;
  line-height: 1.35;
}
.hero-feature-flow {
  position: absolute;
  z-index: -1;
  top: 76px;
  right: -138px;
  width: 132px;
  height: 76px;
  border-top: 1px solid #b9df7d3d;
  border-right: 1px solid #b9df7d24;
  border-radius: 0 90px 0 0;
  transform: rotate(7deg);
  pointer-events: none;
}
.hero-feature-flow::after {
  content: "";
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #c8ed8f;
  box-shadow: 0 0 0 5px #c8ed8f16;
}
@media (max-width: 1180px) {
  .hero-feature-stack { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .hero-feature-stack, .hero-feature-chip { transform: none !important; }
}
`);

console.log("Applied Dropcart V26 hero balance overlay.");
