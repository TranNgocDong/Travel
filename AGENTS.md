# TrailLedger AI Collaboration Guide

This repository may be edited by multiple AI agents, including Codex and Antigravity IDE agents. Follow these rules to avoid overwriting each other.

## Current Product Direction

TrailLedger is a travel-tech web app for group road trips. Core areas:

- Route planning and map-first travel cockpit.
- Group GPS presence and routes.
- Expenses and split bill.
- Trip recap/archive/delete.
- Chat and lightweight coordination.
- Optional Google Maps/Places mode when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` exists, with Leaflet/OpenStreetMap fallback.

## Working Rules

- Check `git status --short` before editing.
- Do not revert or overwrite files changed by another agent unless the user explicitly asks.
- Prefer small, focused commits.
- Run verification before suggesting a push:
  - Frontend: `cd frontend && npm run build`
  - Backend when touched: `cd backend && npm test`
- Do not commit generated local files unless intentional. In particular, `frontend/next-env.d.ts` may flip between `.next/types` and `.next/dev/types` during local dev; restore it to the production form before committing:

```ts
import "./.next/types/routes.d.ts";
```

## Frontend Notes

- Main app component: `frontend/components/ExpensePlanner.tsx`.
- Auth screen: `frontend/components/AuthScreen.tsx`.
- Current user instruction: do not change the outside login/auth UI in this phase. Focus only on the inner dashboard/cockpit UI/UX and animation.
- Global UI styles: `frontend/app/globals.css`.
- Avoid adding broad `!important` overrides unless the user explicitly wants a visual experiment.
- Mobile-first matters more than desktop decoration.
- The map must stay usable while riding: avoid sticky panels that cover controls.

## Backend Notes

- API entry: `backend/src/server.ts`.
- Migrations live in `backend/migrations`.
- Use repositories for DB behavior where possible.
- Keep auth checks and trip membership/RBAC checks server-side.

## Security Notes

- Never hard-code real API keys, Firebase secrets, database URLs, or service credentials.
- Public frontend env vars must be prefixed with `NEXT_PUBLIC_`.
- Sensitive auth/session tokens should not be stored in `localStorage`.

## Handoff Format

When handing work to another agent, include:

- What changed.
- What files were touched.
- What tests/builds passed.
- Any known risk or follow-up.
