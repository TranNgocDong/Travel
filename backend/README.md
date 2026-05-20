# Travel Backend

## Local modes

By default the API uses empty in-memory data so the UI can run locally without PostgreSQL.
In production (`NODE_ENV=production`), `DATABASE_URL` is required and the API refuses to start without PostgreSQL.

To enable PostgreSQL persistence:

1. Start PostgreSQL.
2. Set `DATABASE_URL`.
3. Run migrations.
4. Run the seed command, which now only checks the database connection.
5. Restart the API.

Example with Docker Compose from the repo root:

```powershell
docker compose up -d postgres
$env:DATABASE_URL="postgres://travel:travel_dev_password@localhost:5432/travel"
npm run db:migrate
npm run db:seed
npm run build
npm start
```

`GET /health` returns the active storage mode:

```json
{
  "ok": true,
  "service": "travel-tech-backend",
  "storage": "postgres",
  "database": "up"
}
```

## Production domain

For `demovn.com`, set:

```txt
NODE_ENV=production
HOST=0.0.0.0
DATABASE_URL=postgres://travel:CHANGE_ME@127.0.0.1:5432/travel
CORS_ORIGINS=https://demovn.com,https://www.demovn.com
```

If you use a managed PostgreSQL provider that requires SSL, also set:

```txt
DATABASE_SSL=true
```

If the API is reverse-proxied under `https://demovn.com/api/v1`, the frontend should use:

```txt
NEXT_PUBLIC_API_BASE_URL=https://demovn.com/api/v1
```

The repo root also includes a production Docker path:

```bash
cp deploy/production.env.example .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

See `DEPLOY.md` for the full VPS/domain checklist.

## Firebase Auth

The API now expects a Firebase ID token in:

```txt
Authorization: Bearer <firebase-id-token>
```

Invite members by the same email they use to sign in with Firebase. The backend turns that email into a stable internal user id, so the invited user sees the trip after login.
