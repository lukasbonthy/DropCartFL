import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const overlayDir = join(process.cwd(), "render-overlay");
const payloadPath = join(overlayDir, "v27-overlay.payload.b64");
const expandedPath = join(overlayDir, ".v27-expanded.mjs");
const payload = readFileSync(payloadPath, "utf8").trim();

writeFileSync(expandedPath, gunzipSync(Buffer.from(payload, "base64")));
await import(`${pathToFileURL(expandedPath).href}?v27=${Date.now()}`);

// DropCartFL-1 still runs this legacy overlay entrypoint in its manually configured
// Render build command, so chain the Express/Postgres auth overlay from here too.
await import(`${pathToFileURL(join(overlayDir, "patch-express-auth.mjs")).href}?auth=${Date.now()}`);

// The active Render service still uses this legacy launcher, so include the employee portal here too.
await import(`${pathToFileURL(join(overlayDir, "patch-employee.mjs")).href}?employee=${Date.now()}`);
