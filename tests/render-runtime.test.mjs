import test from "node:test";
import assert from "node:assert/strict";
import { renderPort, wranglerArgs } from "../scripts/render-runtime.mjs";

test("uses Render PORT when provided", () => {
  assert.equal(renderPort({ PORT: "12345" }), "12345");
});

test("falls back to port 10000", () => {
  assert.equal(renderPort({}), "10000");
});

test("binds the built worker to all interfaces and the selected port", () => {
  const args = wranglerArgs("12345");
  assert.deepEqual(args.slice(-6), ["--ip", "0.0.0.0", "--port", "12345", "--inspector-port", "0"]);
  assert.ok(args.includes("dist/server/wrangler.json"));
});
