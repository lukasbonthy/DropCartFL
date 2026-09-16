import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderPort, wranglerArgs } from "./render-runtime.mjs";

const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const port = renderPort();
const child = spawn(
  process.execPath,
  ["--import", "./scripts/sites-env.mjs", wrangler, ...wranglerArgs(port)],
  {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
