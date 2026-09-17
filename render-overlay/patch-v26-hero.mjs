import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), ".runtime");
const layoutPath = join(root, "app/layout.tsx");
const cssPath = join(root, "app/hero-balance.css");

let layout = readFileSync(layoutPath, "utf8");
if (!layout.includes('import "./hero-balance.css";')) {
  if (!layout.includes('import "./globals.css";')) throw new Error("V26 layout stylesheet import changed.");
  layout = layout.replace('import "./globals.css";', 'import "./globals.css";\nimport "./hero-balance.css";');
}
writeFileSync(layoutPath, layout);

writeFileSync(cssPath, `/* Desktop-only composition rebalance for Dropcart V26. */
@media (min-width: 1181px) {
  .hero-art {
    height: 452px;
    width: calc(100% + 118px);
    margin-left: 10px;
    margin-top: -96px;
  }

  .hero-art::before {
    content: "";
    position: absolute;
    z-index: 0;
    left: 35%;
    top: 17%;
    width: 470px;
    height: 330px;
    border-radius: 50%;
    background: radial-gradient(circle, #78b65a24 0, #426f4418 38%, transparent 72%);
    filter: blur(26px);
    pointer-events: none;
  }

  .grocery-visual {
    position: relative;
    z-index: 1;
    object-position: 68% 44% !important;
  }

  .booking-card {
    margin-left: -28px;
  }
}
`);

console.log("Applied Dropcart V26 composition-only hero balance overlay.");
