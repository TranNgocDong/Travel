# Dua backend va database len Railway

Day la cach de web tren Netlify co backend online + PostgreSQL online.

Ket qua mong muon:

```txt
Frontend: https://demovn.com
Backend:  https://api.demovn.com/api/v1
Health:   https://api.demovn.com/health
Database: PostgreSQL tren Railway
```

## 1. Dua code len GitHub

Railway nen deploy tu GitHub. Day toan bo folder `E:\Travel` len mot GitHub repo.

## 2. Tao project Railway

1. Vao Railway.
2. New Project.
3. Chon Deploy from GitHub repo.
4. Chon repo Travel.
5. Khi Railway hoi root directory, chon:

```txt
/backend
```

Backend da co file:

```txt
backend/railway.json
```

File nay bao Railway:

- build bang Dockerfile,
- chay migration database truoc khi start,
- health check bang `/health`.

## 3. Them PostgreSQL

Trong project Railway:

1. Bam `+ New`.
2. Chon Database.
3. Chon PostgreSQL.

Railway se tao bien `DATABASE_URL` cho database.

## 4. Gan bien moi truong cho backend service

Vao service backend > Variables, them:

```txt
NODE_ENV=production
HOST=0.0.0.0
FIREBASE_PROJECT_ID=travel-b226f
CORS_ORIGINS=https://demovn.com,https://www.demovn.com,https://truyen123123.netlify.app
DATABASE_SSL=true
DATABASE_SSL_REJECT_UNAUTHORIZED=false
```

Them bien database:

```txt
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Neu ten service database cua ban khong phai `Postgres`, chon bien `DATABASE_URL` tu database service trong Railway UI.

Khong can tu set `PORT`; Railway tu cap port cho web service.

## 5. Deploy backend

Bam Deploy.

Sau khi deploy xong, mo health URL Railway cap, vi du:

```txt
https://ten-backend.up.railway.app/health
```

Ket qua dung:

```json
{
  "ok": true,
  "service": "travel-tech-backend",
  "storage": "postgres",
  "database": "up"
}
```

## 6. Gan domain api.demovn.com

Trong Railway backend service:

1. Vao Settings.
2. Vao Networking.
3. Add Custom Domain.
4. Nhap:

```txt
api.demovn.com
```

Railway se dua ban mot DNS record can them, thuong la CNAME.

Vao noi quan ly DNS cua `demovn.com`, them record theo Railway dua.

Vi du:

```txt
Type: CNAME
Name: api
Value: <gia-tri-railway-dua>
```

Cho DNS cap nhat, roi mo:

```txt
https://api.demovn.com/health
```

Neu thay `"database":"up"` la backend + database da online.

## 7. Noi frontend Netlify voi backend

Trong Netlify, frontend can bien:

```txt
NEXT_PUBLIC_API_BASE_URL=https://api.demovn.com/api/v1
```

Neu ban upload folder tinh `frontend/out` ma minh da build san, no da dung URL nay roi.

Neu ban chua dung `api.demovn.com` ma dung link Railway tam thoi, can build lai frontend voi:

```txt
NEXT_PUBLIC_API_BASE_URL=https://ten-backend.up.railway.app/api/v1
```

## 8. Kiem tra that

Sau khi frontend va backend deu online:

1. Mo `https://demovn.com`.
2. Dang nhap Firebase.
3. Tao chuyen di moi.
4. Them chi phi.
5. Refresh trang, du lieu van con.
6. Mo bang may khac/tai khoan khac da duoc them thanh vien, du lieu se dong bo.

## Ghi nho

- Netlify giu giao dien.
- Railway giu backend va PostgreSQL.
- Firebase chi lo dang nhap.
- OpenStreetMap/Leaflet khong can Google billing.
