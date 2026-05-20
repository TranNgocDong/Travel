# Dua web Travel len demovn.com

Day la cach deploy de `demovn.com` chay web that, co dang nhap Firebase, PostgreSQL va dong bo nhom.

## 1. Ban can co gi

- Mot VPS/server Linux co Docker va Docker Compose.
- Domain `demovn.com` tro ve IP cua server.
- Firebase Auth da bat Email/Password hoac Google.
- Firebase Auth > Settings > Authorized domains co:
  - `demovn.com`
  - `www.demovn.com`

## 2. Cau hinh DNS

Trong trang quan ly domain, tao 2 ban ghi:

```txt
A  @    IP_SERVER_CUA_BAN
A  www  IP_SERVER_CUA_BAN
```

Cho DNS cap nhat xong roi kiem tra:

```bash
ping demovn.com
```

Neu no tra ve IP server thi dung.

## 3. Tao file moi truong production

Tren server, vao thu muc source code va chay:

```bash
cp deploy/production.env.example .env.production
```

Mo `.env.production` va dien cac gia tri that:

```txt
POSTGRES_PASSWORD=mat_khau_dai_ngau_nhien
FIREBASE_PROJECT_ID=travel-b226f
CORS_ORIGINS=https://demovn.com,https://www.demovn.com
NEXT_PUBLIC_API_BASE_URL=https://demovn.com/api/v1
NEXT_PUBLIC_FIREBASE_API_KEY=api_key_firebase_web
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=travel-b226f.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=travel-b226f
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=travel-b226f.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=620185931766
NEXT_PUBLIC_FIREBASE_APP_ID=app_id_firebase_web
```

Khong can Google Maps key vi web dang dung OpenStreetMap/Leaflet.

## 4. Chay ung dung bang Docker

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Kiem tra:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:3000
```

Neu backend tra ve `"database":"up"` la database da ket noi.

## 5. Cai Nginx de noi domain vao app

Copy file cau hinh:

```bash
sudo cp deploy/nginx.demovn.com.conf /etc/nginx/sites-available/demovn.com
sudo ln -s /etc/nginx/sites-available/demovn.com /etc/nginx/sites-enabled/demovn.com
sudo nginx -t
sudo systemctl reload nginx
```

Sau do mo:

```txt
http://demovn.com
```

## 6. Bat HTTPS

Dung Certbot:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d demovn.com -d www.demovn.com
```

Sau khi co HTTPS, mo:

```txt
https://demovn.com
```

## 7. Kiem tra sau deploy

- Dang nhap bang Firebase.
- Tao chuyen di moi.
- Them thanh vien bang email Firebase cua nguoi do.
- Them chi phi.
- Mo web tren may khac cung tai khoan/thanh vien va xem du lieu co dong bo.

## 8. Lenh huu ich

Xem log backend:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backend
```

Xem log frontend:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f frontend
```

Backup database:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec postgres pg_dump -U travel travel > backup.sql
```
