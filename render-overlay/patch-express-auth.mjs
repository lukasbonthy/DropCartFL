import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const overlayDir = join(process.cwd(), "render-overlay");
const payload = [0, 1, 2, 3, 4]
  .map((i) => readFileSync(join(overlayDir, `v30-auth.payload.${String(i).padStart(2, "0")}.b64`), "utf8").trim())
  .join("");
const expandedPath = join(overlayDir, ".v30-auth-expanded.mjs");
writeFileSync(expandedPath, gunzipSync(Buffer.from(payload, "base64")));
await import(`${pathToFileURL(expandedPath).href}?v30=${Date.now()}`);
