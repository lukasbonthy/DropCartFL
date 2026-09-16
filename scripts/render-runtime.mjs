export function renderPort(env = process.env) {
  return String(env.PORT || "10000");
}

export function wranglerArgs(port = renderPort()) {
  return [
    "dev",
    "--config", "dist/server/wrangler.json",
    "--local",
    "--persist-to", ".wrangler/state",
    "--ip", "0.0.0.0",
    "--port", String(port),
    "--inspector-port", "0",
  ];
}
