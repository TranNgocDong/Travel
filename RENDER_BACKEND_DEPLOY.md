# Deploy backend len Render free voi Neon PostgreSQL

Dung cach nay khi muon host backend mien phi:

```txt
Frontend: Netlify
Backend: Render Web Service
Database: Neon PostgreSQL
```

## Render Web Service

Chon repo:

```txt
TranNgocDong/Travel
```

Cau hinh:

```txt
Language: Node
Root Directory: backend
Instance Type: Free
Health Check Path: /health
```

Build command:

```bash
npm ci --include=dev && npm run build
```

Start command:

```bash
npm run db:migrate:prod && npm start
```

Ly do build command can `--include=dev`: Render dung cung Environment Variables cho build va runtime. Neu `NODE_ENV=production`, npm co the bo qua devDependencies, lam TypeScript build thieu `@types/node` va `@types/pg`.

## Environment Variables

```txt
NODE_ENV=production
HOST=0.0.0.0
PORT=10000
DATABASE_URL=NEON_CONNECTION_STRING
DATABASE_SSL=true
DATABASE_SSL_REJECT_UNAUTHORIZED=false
FIREBASE_PROJECT_ID=travel-b226f
CORS_ORIGINS=https://demovn.com,https://www.demovn.com,https://truyen123123.netlify.app
```

## Kiem tra

Sau khi deploy xong, mo health check nhanh:

```txt
https://your-render-service.onrender.com/health
```

Dung khi thay `ok: true`. De kiem tra database that su ket noi, mo:

```txt
https://your-render-service.onrender.com/ready
```

Database dung khi thay:

```json
{
  "ok": true,
  "storage": "postgres",
  "database": "up"
}
```

## Netlify frontend

Sau khi backend Render OK, dat bien Netlify:

```txt
NEXT_PUBLIC_API_BASE_URL=https://your-render-service.onrender.com/api/v1
```
