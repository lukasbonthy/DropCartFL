import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const runtime = join(root, ".runtime");
const appDir = join(runtime, "app", "employee");
const scriptsDir = join(runtime, "scripts");
mkdirSync(appDir, { recursive: true });
mkdirSync(scriptsDir, { recursive: true });

copyFileSync(join(root, "render-overlay", "employee-page.tsx"), join(appDir, "page.tsx"));
copyFileSync(join(root, "render-overlay", "employee.css"), join(appDir, "employee.css"));
copyFileSync(join(root, "render-overlay", "employee-routes.mjs"), join(scriptsDir, "employee-routes.mjs"));

const serverPath = join(scriptsDir, "render-express.mjs");
let server = readFileSync(serverPath, "utf8");
if (!server.includes("employee-routes.mjs")) {
  server = 'import { installEmployeeRoutes } from "./employee-routes.mjs";\n' + server;
  const marker = "app.listen(";
  if (!server.includes(marker)) throw new Error("render-express.mjs does not contain app.listen()");
  server = server.replace(marker, "installEmployeeRoutes(app);\n\n" + marker);
  writeFileSync(serverPath, server);
}
console.log("Installed Dropcart employee portal.");
