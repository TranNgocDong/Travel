# TrailLedger UI/UX AI Collaboration Handoff

## Shared Goal

Make TrailLedger feel like a smooth travel cockpit:

- Map-first for riding and navigation.
- Calm, premium travel visuals without clutter.
- Mobile-first interactions that do not jump while the user is moving.
- Dark/light mode must both stay readable.
- Keep backend/API behavior untouched unless explicitly requested.

## Visual Direction Approved By User

Blend:

- 60% Apple Maps: fullscreen map, floating search, draggable bottom-sheet feeling, calm system UI.
- 20% Airbnb: destination/place cards, soft shadows, inviting travel imagery.
- 20% Strava: route timeline, trip activity stats, progress and performance feel.

Palette:

- `#0F172A` Dark Navy background.
- `#1E293B` Card surface.
- `#F8FAFC` Main text.
- `#38BDF8` Accent.
- `#22C55E` Success/live state.

Interaction principles:

- Dark mode default.
- Floating cards over map.
- Glass effect, very subtle gradients, soft shadows.
- Map should occupy about 70-80% of the mobile route screen.
- Search floats on top of the map.
- Route details should feel like an Apple Maps bottom sheet.
- Timeline should feel closer to Strava.
- Place cards should feel closer to Airbnb.
- Charts are welcome for trip stats, but keep them lightweight.

Implementation guidance:

- Prefer CSS transitions first. Only add Framer Motion if the user explicitly approves the dependency and it solves a real interaction problem.
- If adding a bottom sheet, keep it usable on touch devices and do not hide essential map controls.
- Do not rewrite the entire dashboard at once; ship small visual slices.

## Hard Scope Boundary

Do not modify the outside login/auth screen in this phase.

- Do not edit `frontend/components/AuthScreen.tsx`.
- Do not change login hero/slideshow/background assets.
- Do not add Ken Burns/slideshow effects to the auth page.
- Focus only on the inner dashboard/cockpit after the user is authenticated.

## What Antigravity Added

Antigravity added a `PREMIUM UI/UX & ANIMATION OVERRIDES` block at the end of `frontend/app/globals.css`.

It introduces:

- Glassmorphism panels.
- Hover lift effects.
- Premium button/chip styling.
- Slide-up reveal animations.
- Live sync pulse animation.

## Codex Stabilization Added

Codex added `CODEX + ANTIGRAVITY UI STABILIZATION` after that block.

Purpose:

- Preserve the premium look.
- Reduce hover/transform effects on touch devices.
- Reduce blur strength on mobile to avoid lag.
- Keep map panels readable and stable.
- Respect `prefers-reduced-motion`.

## Files Currently Relevant

- `frontend/app/globals.css`: main visual coordination layer.
- `frontend/components/ExpensePlanner.tsx`: app cockpit, map, group, expenses.
- `frontend/components/EntryAnimation.tsx`: entry animation after login only.

## Design Rules For Next Agent

- Do not add global `button:hover` transforms without touch-device guards.
- Do not cover the map with fixed panels on mobile.
- Avoid overusing `!important`; use it only when overriding old global styles.
- Prefer map, route, and live status as the visual center.
- Use illustration/SVG as accents, not large obstructive decoration inside the cockpit.
- Any new animation must be disabled or shortened under `prefers-reduced-motion`.

## Suggested Next Small Tasks

1. Polish the route cockpit header:
   - Shorter labels.
   - Better spacing for mobile.
   - Clearer active ride mode.

2. Improve map POI controls:
   - Compact filter chips for food/lodging/fuel.
   - Better selected state.

3. Create a small “Trip pulse” strip:
   - Online members.
   - GPS sharing state.
   - Weather risk.
   - Distance remaining.

4. Review CSS specificity:
   - Remove duplicated broad styles once visual direction stabilizes.

## Verification

Before handoff or push:

```powershell
cd frontend
npm run build
```

If backend changes:

```powershell
cd backend
npm test
```
