# Antigravity Prompt: TrailLedger Member Profile & Social Layer

Role: act as a senior UI/UX designer, frontend architect, and security-minded product engineer for TrailLedger.

Goal: extend the inner app cockpit with a lightweight member profile layer for group travel. Do not redesign the outside login/auth screen.

Approved scope for this phase:

- Let each signed-in member update their own in-trip profile.
- Show member profile details in the Group tab and presence list.
- Add quick call actions using `tel:` links when a member has a phone number.
- Add trip-friendly status values: riding, resting, need-help, offline.
- Add a small emoji/status badge for fast glanceability.
- Add preset visual identity fields only: avatar color and background preset key.

Out of scope for this phase:

- Do not build in-app voice/video calling yet. That requires WebRTC, signaling, TURN, and a separate security review.
- Do not add file/image uploads yet. User-uploaded backgrounds need storage, content validation, size limits, and abuse controls.
- Do not touch `frontend/components/AuthScreen.tsx`.

UX direction:

- 60% Apple Maps: calm, map-first, floating controls, bottom-sheet feel.
- 20% Airbnb: warm member/profile cards, friendly place-like details.
- 20% Strava: route/travel status, live activity cues.
- Mobile-first, thumb-friendly, minimal clutter.

Security/privacy rules:

- Phone/home/status are personal data. Show them only inside the trip room.
- Members can edit their own profile. Owners can still manage roles/removal.
- Validate and trim every profile field on backend.
- Keep phone numbers optional and avoid pretending they are verified.
- Never store secrets or auth tokens in localStorage.

Implementation notes:

- Backend: extend `trip_participants` with nullable profile fields.
- API: reuse `PATCH /api/v1/trips/:tripId/members/:memberId` for profile updates.
- Frontend: add a "Ho so cua toi" editor in the Group tab and quick action buttons on member/presence cards.
- Keep CSS scoped to profile/member panels where possible.

Verification:

- `cd backend && npm test`
- `cd frontend && npm run build`

