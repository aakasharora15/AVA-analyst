# AVA: Adversarial Venture Analyst

Clickable front-end prototype of AVA, a venture-risk platform for VC funds, corporate venture teams and accelerators. All data is mocked. The data layer (`src/data/repo.js`, arriving in phase 2) is written to be swapped for Supabase later.

## Run

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # Vitest
npm run build && npm run preview
```

Deep links work on refresh in `dev` and `preview` (SPA fallback). When deploying, configure the host to rewrite unknown paths to `/index.html`.

## Stack

- Vite, vanilla JavaScript (ES modules), plain CSS with custom properties. No UI framework.
- `src/router.js`: History API router with `:param` segments, hash scrolling and focus management.
- `src/lib/html.js`: tagged-template renderer that escapes interpolated values.
- `src/lib/storage.js`: `localStorage` for light conveniences, every access wrapped in try/catch.

## Structure

```
src/
  main.js              boot, layout frame, screen mounting
  router.js            matching and navigation
  routes.js            route table (later-phase routes show a "planned" screen)
  config.js            shared ids (sample audit and company)
  components/          logo, site header, site footer
  screens/             one module per screen: { title, render(ctx), mount?(root, ctx) }
  styles/
    tokens.css         colours, type, radii, verdict colours, contrast-safe text
    base.css           reset, moving background, reduced motion
    components.css     glass, header, capsule nav, buttons, cards, tags, accordion
    screens/*.css      per-screen styles
public/                manifest, icons (180px opaque touch icon)
tests/                 Vitest
```

## Design rules in code

- Dark only. Glass (`.glass`) is used only on the floating layer: the header today; the mobile report bar, sheets and menus later. It has an opaque fallback and goes solid under `prefers-reduced-transparency` and `prefers-contrast: more`.
- Cards, lists and forms are solid (`--surface`).
- Verdict colours (`.v-proceed`, `.v-hold`, `.v-pivot`, `.v-kill`) are used only on verdicts and always carry the word.
- Muted and label text tokens hold 4.5:1 over the brightest point of the moving background.

## Build phases

1. Scaffold, tokens, background, router, header and footer, Landing, Pricing, Team. **Done.**
2. Engine with tests, mock data, `repo.js`, New analysis, Running, Report (desktop and mobile).
3. Company, Portfolio, History and compare, finding workflow.
4. Sources, Data room, Alerts, Outcomes, Benchmarks.
5. Free audit, Sign in, Onboarding, Account, Export, empty and error states.
6. Accessibility and responsive pass, final cleanup.
