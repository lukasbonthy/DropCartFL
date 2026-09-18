import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const runtime = join(root, ".runtime");
const componentsDir = join(runtime, "components");
const appDir = join(runtime, "app");

mkdirSync(componentsDir, { recursive: true });

copyFileSync(
  join(root, "render-overlay", "page-transition.tsx"),
  join(componentsDir, "page-transition.tsx"),
);
copyFileSync(
  join(root, "render-overlay", "smooth-flow.css"),
  join(appDir, "smooth-flow.css"),
);

const layoutPath = join(appDir, "layout.tsx");
let layout = readFileSync(layoutPath, "utf8");

if (!layout.includes('import { PageTransition } from "@/components/page-transition";')) {
  layout = layout.replace(
    'import type { Metadata } from "next";',
    'import type { Metadata } from "next";\nimport { PageTransition } from "@/components/page-transition";',
  );
}

if (!layout.includes('import "./smooth-flow.css";')) {
  if (layout.includes('import "./globals.css";')) {
    layout = layout.replace(
      'import "./globals.css";',
      'import "./globals.css";\nimport "./smooth-flow.css";',
    );
  } else {
    layout = 'import "./smooth-flow.css";\n' + layout;
  }
}

if (!layout.includes("<PageTransition>{children}</PageTransition>")) {
  const exact = '<body className="antialiased">{children}</body>';
  if (layout.includes(exact)) {
    layout = layout.replace(
      exact,
      '<body className="antialiased"><PageTransition>{children}</PageTransition></body>',
    );
  } else {
    const bodyPattern = /<body([^>]*)>\s*\{children\}\s*<\/body>/;
    if (!bodyPattern.test(layout)) {
      throw new Error("Could not locate the RootLayout body children.");
    }
    layout = layout.replace(
      bodyPattern,
      '<body$1><PageTransition>{children}</PageTransition></body>',
    );
  }
}

writeFileSync(layoutPath, layout);
console.log("Installed Dropcart smooth page + interaction motion.");
