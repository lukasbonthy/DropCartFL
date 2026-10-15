import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The legacy Render configuration builds from an expanded zip. The actual
// authenticated homepage is components/home-page.tsx, not app/page.tsx.
// This patch intentionally does not touch either homepage or any booking logic.
const repo = process.cwd();
const runtime = join(repo, ".runtime");
const app = join(runtime, "app");
const publicDir = join(runtime, "public");
const files = [
  ["public/dropcart-liquid-glass-engine.js", "public/dropcart-liquid-glass-engine.js"],
  ["public/dropcart-liquid-glass-init.js", "public/dropcart-liquid-glass-init.js"],
  ["app/dropcart-glass.css", "app/dropcart-glass.css"],
];
if (!existsSync(join(app, "layout.tsx")) || !existsSync(join(app, "globals.css"))) {
  throw new Error("Expected Render's expanded .runtime app before installing glass");
}
if (!existsSync(publicDir)) {
  throw new Error("Expanded app is missing its public assets directory");
}
for (const [from, to] of files) copyFileSync(join(repo, from), join(runtime, to));

const globalsFile = join(app, "globals.css");
let globals = readFileSync(globalsFile, "utf8");
if (!globals.includes('dropcart-glass.css')) {
  const imports = [...globals.matchAll(/@import\s+[^;]+;/g)];
  if (!imports.length) throw new Error("Could not find CSS import insertion point");
  const last = imports.at(-1);
  const index = last.index + last[0].length;
  globals = globals.slice(0, index) + '\n@import "./dropcart-glass.css";' + globals.slice(index);
  writeFileSync(globalsFile, globals);
}

const layoutFile = join(app, "layout.tsx");
let layout = readFileSync(layoutFile, "utf8");
if (!layout.includes('dropcart-liquid-glass-engine.js')) {
  const insertion =
    '        <script src="/dropcart-liquid-glass-engine.js" defer />\n' +
    '        <script src="/dropcart-liquid-glass-init.js" defer />\n';
  if (!layout.includes("</head>")) throw new Error("Root layout has no </head> for glass scripts");
  layout = layout.replace("</head>", insertion + "      </head>");
  writeFileSync(layoutFile, layout);
}
console.log("Installed original SwiflyTV optical engine on selected Dropcart surfaces (layout unchanged).");
