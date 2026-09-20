# Dropcart

Current Dropcart web app source. Dropcart lets customers request help unloading groceries from their vehicle into their home.

## Local development

Requirements: Node.js 22.13+ and pnpm 11.25.0.

```bash
pnpm install
pnpm dev
```

The portable local dev server uses Vinext and normally starts at http://localhost:5173.

## Pricing

- 1–5 bags: $14.99
- 6–15 bags: $19.99
- 16+ bags: $27.99
- Stairs: +$5.00

## Notes

The hero grocery image is referenced from the current Dropcart ChatGPT Sites deployment so the GitHub source stays lightweight. Booking persistence uses a Cloudflare D1 `DB` binding when deployed in the Sites/Cloudflare environment.
