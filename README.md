# Dropcart

Current Dropcart web app source. Dropcart lets customers request help unloading groceries from their vehicle into their home.

## Render build and local development

Requirements: Node.js 22.13+ and pnpm 11.25.0.

The live Render service builds the versioned source bundle with the checked-in overlays. Its existing build and start commands are preserved. To reproduce the deployed application:

```bash
unzip -oq dropcart-v26-render-ready.zip -d .runtime
node render-overlay/patch-v26-hero.mjs
cd .runtime
pnpm install --frozen-lockfile=false
pnpm dev
```

Always extract a fresh bundle before reapplying the complete overlay chain. UI changes live in `render-overlay/premium-home-page.tsx`, `premium-auth-page.tsx`, `premium-mobile-app-dock.tsx`, and `premium.css`. `patch-premium.mjs` integrates them after the auth, employee, and navigation overlays.

The portable local dev server uses Vinext and normally starts at http://localhost:5173.

## Pricing

- 1–5 bags: $14.99
- 6–15 bags: $19.99
- 16+ bags: $27.99
- Stairs: +$5.00

## Notes

Render uses the existing Express/Postgres session and booking integration. This refresh does not change its database, environment variables, or service plan.

The grocery hero is included in the source bundle. The optimized kitchen photo is by PNW Production, [via Pexels](https://www.pexels.com/photo/woman-taking-out-the-groceries-from-paper-bag-7677886/).

## Checks

After preparing `.runtime`, run from the repository root:

```bash
node --experimental-strip-types --test tests/*.test.mjs
cd .runtime
pnpm exec tsc --noEmit
node --experimental-strip-types --test lib/booking-data.test.mjs lib/pricing.test.mjs lib/auth-core.test.mjs
pnpm build
```

The booking regression tests verify that the optional driver code word survives validation, remains optional, and enforces its length limit. The pricing choices pass their selected load to the booking form without discarding the entered contact details.
