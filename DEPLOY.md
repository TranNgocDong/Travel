# Deploy to demovn.com

This repository now has a production-oriented Docker path:

- PostgreSQL for persistent data.
- Fastify backend on `127.0.0.1:4000`.
- Next.js frontend on `127.0.0.1:3000`.
- Nginx routes `https://demovn.com/api/` to backend and everything else to frontend.

## 1. Prepare Firebase

In Firebase Console:

- Enable Google sign-in.
- Add `demovn.com` and `www.demovn.com` to Authorized domains.
- Copy the Firebase web app values into the production env file.
- Do not put OAuth client secrets in frontend code.

## 2. Create Production Env

On the server, copy the example:

```bash
cp deploy/production.env.example .env.production
```

Edit `.env.production`:

```txt
POSTGRES_PASSWORD=use-a-long-random-password
FIREBASE_PROJECT_ID=travel-b226f
CORS_ORIGINS=https://demovn.com,https://www.demovn.com
NEXT_PUBLIC_API_BASE_URL=https://demovn.com/api/v1
NEXT_PUBLIC_FIREBASE_...
```

Important: `NODE_ENV=production` backend refuses to start without PostgreSQL.

## 3. Build And Start

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

The `migrate` service runs database migrations and leaves the workspace empty for real user-created trips.

Check status:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:3000
```

Expected backend health:

```json
{"ok":true,"service":"travel-tech-backend","storage":"postgres","database":"up"}
```

If `database` is `down`, the web is running but the database is not reachable, so data cannot be saved safely.

## 4. Nginx

Use `deploy/nginx.demovn.com.conf` as the reverse proxy template.

Basic layout:

- `https://demovn.com` -> frontend `127.0.0.1:3000`
- `https://demovn.com/api/` -> backend `127.0.0.1:4000/api/`
- `https://demovn.com/health` -> backend health check

Install certificates with Certbot or your hosting provider, then enable HTTPS.

## 5. Operations

View logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backend
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f frontend
```

Run migrations after future schema changes:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate
```

Backup PostgreSQL:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec postgres pg_dump -U travel travel > backup.sql
```

Restore from backup:

```bash
cat backup.sql | docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres psql -U travel travel
```

## 6. Current Limits

- OpenStreetMap tiles are not fully offline. The app keeps saved routes and app shell, but new map areas still need network.
- Public OSRM/Nominatim/Open-Meteo endpoints are suitable to start. For serious traffic, run paid/provider-backed services or self-host routing/geocoding.
- To share a trip with real users, add members by their Firebase login email in the app.
