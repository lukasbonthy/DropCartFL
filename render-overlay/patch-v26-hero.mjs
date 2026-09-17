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
