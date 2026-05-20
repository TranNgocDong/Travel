# Deploy frontend len Netlify

Netlify phu hop de host giao dien Next.js cua web. Backend Fastify va PostgreSQL van can host rieng, vi Netlify khong chay truc tiep server PostgreSQL cua ung dung nay.

## File da co san

- `netlify.toml`: cau hinh build cho Netlify.
- `deploy/netlify.env.example`: danh sach bien moi truong can copy vao Netlify.

## Cach deploy

1. Dua source code len GitHub.
2. Vao Netlify > Add new site > Import an existing project.
3. Chon repo nay.
4. Netlify se tu doc `netlify.toml`.

Neu Netlify hoi cau hinh build, dien:

```txt
Base directory: frontend
Build command: npm run build
Publish directory: .next
```

## Bien moi truong can dien trong Netlify

Vao Netlify > Site configuration > Environment variables, copy cac bien trong:

```txt
deploy/netlify.env.example
```

Gia tri quan trong nhat:

```txt
NEXT_PUBLIC_API_BASE_URL=https://api.demovn.com/api/v1
```

Neu backend cua ban chay o domain khac, thay `https://api.demovn.com/api/v1` bang URL backend that.

## Firebase Auth

Trong Firebase Console > Authentication > Settings > Authorized domains, them:

```txt
demovn.com
www.demovn.com
ten-site-netlify.netlify.app
```

Neu khong them, dang nhap Google/Firebase tren Netlify se bi chan.

## Sau khi deploy frontend

Ban van can deploy backend o mot noi khac, vi backend dang quan ly:

- dang nhap token Firebase,
- chuyen di nhom,
- chi phi,
- chia tien,
- PostgreSQL,
- live sync.

Lua chon de host backend:

- VPS rieng theo file `DEPLOY_VI.md`,
- Railway,
- Render,
- Fly.io.

Khi co backend URL, cap nhat lai bien:

```txt
NEXT_PUBLIC_API_BASE_URL=https://backend-cua-ban/api/v1
```

Sau do bam Redeploy tren Netlify.
