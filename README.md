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

## Premium storefront

Dropcart's pricing studio calculates an estimate using the same `getUnloadPrice` logic as the booking form. Selecting a pricing tier or clicking **Use this estimate** updates the booking draft; it does not submit a booking. Tracking shortcuts resume the most recent request only when its private device token remains in local storage.

The light-themed liquid glass styles are in `app/dropcart-premium.css` (native blur, layered highlights, accessible solid fallbacks, reduced-motion and reduced-transparency support). Render expands the packaged v26 application, so `render-overlay/patch-v26-hero.mjs` runs `patch-premium.mjs` last to install these same improvements into the generated runtime. Editing the app source alone is not sufficient for the packaged Render deployment.
