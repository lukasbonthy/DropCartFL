import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), ".runtime");
const homePath = join(root, "components/home-page.tsx");
const layoutPath = join(root, "app/layout.tsx");
const cssPath = join(root, "app/hero-balance.css");

let home = readFileSync(homePath, "utf8");
const artAnchor = `          <motion.div className="hero-art" style={{ y: heroArtYSmooth, rotate: heroArtRotateSmooth, scale: heroArtScaleSmooth }}>\n            {/* eslint-disable-next-line @next/next/no-img-element */}`;
const artWithPill = `          <motion.div className="hero-art" style={{ y: heroArtYSmooth, rotate: heroArtRotateSmooth, scale: heroArtScaleSmooth }}>\n            <motion.div\n              className="hero-calm-pill"\n              initial={reduceMotion ? false : { opacity: 0, y: 6 }}\n              animate={{ opacity: 1, y: 0 }}\n              transition={{ ...dropcartSpring, delay: reduceMotion ? 0 : 0.24 }}\n              aria-label="Local help with no subscription"\n            >\n              <HeartHandshake size={15} strokeWidth={1.7} aria-hidden="true" />\n              <span>Local help <i aria-hidden="true">·</i> No subscription</span>\n            </motion.div>\n            {/* eslint-disable-next-line @next/next/no-img-element */}`;
if (!home.includes('className="hero-calm-pill"')) {
  if (!home.includes(artAnchor)) throw new Error("V26 hero art anchor changed; refusing to apply stale overlay.");
  home = home.replace(artAnchor, artWithPill);
}
if (home.includes('className="hero-feature-stack"')) {
  throw new Error("Old stacked hero overlay detected; V26 runtime was not reset before applying the calm overlay.");
}
writeFileSync(homePath, home);

let layout = readFileSync(layoutPath, "utf8");
if (!layout.includes('import "./hero-balance.css";')) {
  if (!layout.includes('import "./globals.css";')) throw new Error("V26 layout stylesheet import changed.");
  layout = layout.replace('import "./globals.css";', 'import "./globals.css";\nimport "./hero-balance.css";');
}
writeFileSync(layoutPath, layout);

writeFileSync(cssPath, `/* Calm desktop hero balance overlay for Dropcart V26. */
.hero-calm-pill {
  position: absolute;
  z-index: 3;
  top: 62px;
  right: 84px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  border: 1px solid #dff7c124;
  border-radius: 999px;
  color: #dcebd5;
  background: #17382b99;
  box-shadow: inset 0 1px 0 #ffffff10, 0 10px 28px -23px #00140b;
  backdrop-filter: blur(10px);
  font-size: .69rem;
  font-weight: 600;
  letter-spacing: -.01em;
  white-space: nowrap;
}
.hero-calm-pill svg { color: #cef18e; }
.hero-calm-pill i {
  margin-inline: 2px;
  color: #8fae88;
  font-style: normal;
}

@media (min-width: 1181px) {
  .hero-art {
    height: 378px;
    width: calc(100% + 86px);
    margin-left: -18px;
    margin-top: -28px;
  }
  .hero-art::before {
    content: "";
    position: absolute;
    z-index: 0;
    left: 34%;
    top: 14%;
    width: 420px;
    height: 300px;
    border-radius: 50%;
    background: radial-gradient(circle, #78b65a30 0, #426f4420 36%, transparent 72%);
    filter: blur(22px);
    pointer-events: none;
  }
  .grocery-visual {
    position: relative;
    z-index: 1;
    object-position: 64% 48% !important;
  }
  .hero-side-note {
    right: 36px;
    bottom: 92px;
    writing-mode: horizontal-tb;
    color: #d8f29f;
    font-family: var(--font-display);
    font-size: .84rem;
    font-style: italic;
    font-weight: 600;
    letter-spacing: .005em;
    opacity: .68;
    transform: rotate(-4deg);
  }
  .hero-side-note::after {
    content: "";
    position: absolute;
    right: -34px;
    top: 12px;
    width: 31px;
    height: 18px;
    border-right: 1px solid #c9ed8f80;
    border-bottom: 1px solid #c9ed8f80;
    border-radius: 0 0 18px 0;
    transform: rotate(10deg);
  }
}

@media (max-width: 1180px) {
  .hero-calm-pill { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .hero-calm-pill { transform: none !important; }
}
`);

console.log("Applied Dropcart V26 calm hero balance overlay.");
