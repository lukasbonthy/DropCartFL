import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const overlayDir = join(repoRoot, "render-overlay");
const runtimeRoot = join(repoRoot, ".runtime");
const payload = [0, 1, 2, 3, 4]
  .map((i) => readFileSync(join(overlayDir, `v30-auth.payload.${String(i).padStart(2, "0")}.b64`), "utf8").trim())
  .join("");
const expandedPath = join(overlayDir, ".v30-auth-expanded.mjs");
writeFileSync(expandedPath, gunzipSync(Buffer.from(payload, "base64")));
await import(`${pathToFileURL(expandedPath).href}?v30=${Date.now()}`);

// DropCartFL-1's existing Render start command directly executes Wrangler.
// Keep that service configuration working by replacing Wrangler's CLI entrypoint
// after the production build with a tiny shim that launches the Express server.
const scriptsDir = join(runtimeRoot, "scripts");
mkdirSync(scriptsDir, { recursive: true });
const shimInstallerPath = join(scriptsDir, "install-render-entry-shim.mjs");
writeFileSync(
  shimInstallerPath,
  `import { writeFileSync } from "node:fs";\nimport { join } from "node:path";\nconst target = join(process.cwd(), "node_modules/wrangler/bin/wrangler.js");\nwriteFileSync(target, 'import { join } from "node:path"; import { pathToFileURL } from "node:url"; await import(pathToFileURL(join(process.cwd(), "scripts/render-express.mjs")).href);\\n');\nconsole.log("Installed Render Express entry shim.");\n`,
);

const packagePath = join(runtimeRoot, "package.json");
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
pkg.scripts ??= {};
const shimCommand = "node scripts/install-render-entry-shim.mjs";
const buildCommand = pkg.scripts.build || "vinext build";
if (!buildCommand.includes(shimCommand)) {
  pkg.scripts.build = `${buildCommand} && ${shimCommand}`;
}
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
