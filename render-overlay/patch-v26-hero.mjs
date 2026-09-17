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

writeFileSync(cssPath, `/* Desktop-only grocery-photo feathering for Dropcart V26. */
@media (min-width: 1181px) {
  .hero-art {
    height: 430px;
    width: calc(100% + 96px);
    margin-left: 4px;
    margin-top: -74px;
  }

  .hero-art::before {
    content: "";
    position: absolute;
    z-index: 0;
    left: 36%;
    top: 20%;
    width: 440px;
    height: 300px;
    border-radius: 50%;
    background: radial-gradient(circle, #78b65a20 0, #426f4414 40%, transparent 74%);
    filter: blur(28px);
    pointer-events: none;
  }

  .hero-art .grocery-visual {
    position: relative;
    z-index: 1;
    object-position: 64% 48% !important;
    -webkit-mask-image:
      linear-gradient(to bottom, transparent 0%, black 16%, black 84%, transparent 100%),
      linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%);
    -webkit-mask-composite: source-in;
    mask-image:
      linear-gradient(to bottom, transparent 0%, black 16%, black 84%, transparent 100%),
      linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%);
    mask-composite: intersect;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-size: 100% 100%;
    mask-size: 100% 100%;
  }

  .hero-side-note {
    display: none !important;
  }

  .booking-card {
    margin-left: -20px;
  }
}
`);

console.log("Applied Dropcart V26 feathered grocery-photo overlay.");
