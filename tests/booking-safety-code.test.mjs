import test from "node:test";
import assert from "node:assert/strict";
import { bookingSchema, detailsSchema } from "../.runtime/lib/booking-data.ts";

const details = { name: "Preview Customer", phone: "3525550123", load: "large", stairs: false, notes: "" };
const request = { ...details, requestId: "d22f0d1d-12e0-4096-8f76-24c647ef4b1e", address: "123 Preview Lane", city: "Inverness", zip: "34450", eta: 30, consent: true, website: "" };

test("booking validation preserves and trims the optional driver code word", () => {
  assert.equal(bookingSchema.parse({ ...request, codeWord: " Pineapple " }).codeWord, "Pineapple");
  assert.equal(detailsSchema.parse({ ...details, codeWord: " Pineapple " }).codeWord, "Pineapple");
});

test("a driver code word stays optional for existing clients", () => {
  assert.equal(bookingSchema.parse(request).codeWord, "");
});

test("oversized driver code words are rejected before submission", () => {
  const result = detailsSchema.safeParse({ ...details, codeWord: "A".repeat(41) });
  assert.equal(result.success, false);
  assert.equal(result.error.issues[0].path[0], "codeWord");
});
