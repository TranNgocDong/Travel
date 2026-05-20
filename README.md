# Travel Tech Web App

Mobile-first travel planning app for group trips, route planning, weather-by-route, expenses, split bills, Firebase Auth, PostgreSQL persistence, and live group sync.

## Project Structure

```txt
frontend/   Next.js web app
backend/    Fastify API, Firebase token auth, PostgreSQL repositories
deploy/     Production env examples and Nginx template
```

## Local Development

Install dependencies:

```bash
cd backend && npm ci
cd ../frontend && npm ci
```

Create local env files from the examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Run backend:

```bash
cd backend
npm run build
npm run dev
```

Run frontend:

```bash
cd frontend
npm run dev
```

Open:

```txt
http://localhost:3000
```

## Deploy

- Netlify frontend: see `NETLIFY_DEPLOY.md`
- Railway backend + PostgreSQL: see `RAILWAY_BACKEND_DEPLOY.md`
- VPS/Docker full stack: see `DEPLOY.md` or `DEPLOY_VI.md`

## Notes

- Do not commit real `.env` files.
- Firebase Auth handles login only.
- PostgreSQL stores trips, route plans, members, expenses, and split-bill data.
- OpenStreetMap/Leaflet is used for maps, so Google Maps billing is not required.
