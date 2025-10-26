# ⚡ OFM Platform - Démarrage rapide

## 🚀 Démarrage en 3 commandes

```bash
# 1. Démarrer les services (PostgreSQL, Redis, MinIO)
docker-compose -f docker-compose.dev.yml up -d

# 2. Installer et configurer
npm install
cd apps/api && npx prisma migrate dev && cd ../..

# 3. Lancer le projet
npm run dev
```

**C'est tout !** Ouvrez http://localhost:3000

---

## 📍 URLs importantes

- **Frontend** : http://localhost:3000
- **Backend API** : http://localhost:3001
- **API Docs (Swagger)** : http://localhost:3001/api/v1/docs
- **MinIO Console** : http://localhost:9001 (minioadmin / minioadmin_dev_only)
- **MailDev (Emails)** : http://localhost:1080
- **Prisma Studio** : `cd apps/api && npm run prisma:studio`

---

## ⚠️ Première fois ?

**Lisez le guide complet** : [DEV_SETUP.md](./DEV_SETUP.md)

---

## 🪟 Sur Windows ?

```powershell
# Utilisez le script PowerShell
cd apps/api
.\dev-windows.ps1
```

---

## 🐛 Problèmes courants

### ERR_CONNECTION_REFUSED

```bash
# 1. Vérifier que les services Docker sont lancés
docker-compose -f docker-compose.dev.yml ps

# 2. Vérifier que l'API démarre
cd apps/api && npm run dev
```

### Erreurs Prisma

```bash
cd apps/api
npx prisma generate
npx prisma migrate dev
```

### Module not found

```bash
# Nettoyer et réinstaller
rm -rf node_modules package-lock.json
npm install
```

---

**Pour plus de détails** → [DEV_SETUP.md](./DEV_SETUP.md)
