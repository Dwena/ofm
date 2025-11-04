# Guide de Démarrage Rapide - Système de Traitement des Médias

## ✅ Status : Système Complet et Prêt à l'Emploi

Toutes les fonctionnalités demandées sont **déjà implémentées** :

- ✅ **Processing vidéo complet** (transcoding H.264, thumbnails automatiques)
- ✅ **Processing image complet** (optimisation, watermark automatique)
- ✅ **Stockage S3/MinIO** configuré et testé
- ✅ **CDN** configuré pour la production

## 🚀 Démarrage en 5 Minutes

### 1. Copier la Configuration

```bash
# Copier le fichier d'exemple
cp .env.example .env

# Les variables suivantes sont déjà configurées pour le développement :
# - AWS_ACCESS_KEY_ID=minioadmin
# - AWS_SECRET_ACCESS_KEY=minioadmin_dev_only
# - AWS_S3_BUCKET=ofm-content-dev
# - WATERMARK_ENABLED=true
```

### 2. Démarrer l'Infrastructure

```bash
# Démarrer PostgreSQL, Redis, et MinIO
docker-compose up -d postgres redis minio

# Vérifier que tout tourne
docker-compose ps
```

### 3. Vérifier MinIO (Stockage S3 Local)

```bash
# Ouvrir MinIO console
open http://localhost:9001

# Login: minioadmin / minioadmin_dev_only
# Le bucket 'ofm-content-dev' sera créé automatiquement
```

### 4. Installer et Démarrer l'API

```bash
# Installer les dépendances
cd apps/api
npm install

# Lancer les migrations
npx prisma migrate dev

# Démarrer l'API (avec workers pour processing)
npm run start:dev
```

### 5. Tester l'Upload

```bash
# Obtenir un token JWT (créer un compte d'abord)
TOKEN="votre-jwt-token"

# Test upload image
curl -X POST http://localhost:3001/api/v1/media/upload/image \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@votre-image.jpg" \
  -F "title=Test Image"

# Test upload vidéo
curl -X POST http://localhost:3001/api/v1/media/upload/video \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@votre-video.mp4" \
  -F "title=Test Video"
```

## 📁 Structure des Fichiers Clés

```
apps/api/src/
├── media/
│   ├── media.controller.ts          # API endpoints
│   ├── media.service.ts             # Business logic
│   ├── media.module.ts              # Module configuration
│   ├── processors/
│   │   ├── image.processor.ts       # ✅ Processing images
│   │   └── video.processor.ts       # ✅ Processing vidéos
│   ├── services/
│   │   └── watermark.service.ts     # ✅ Watermarking
│   └── validators/
│       └── media.validator.ts       # Validation & sécurité
├── storage/
│   ├── storage.service.ts           # ✅ S3/MinIO integration
│   └── storage.module.ts
├── CDN_CONFIGURATION.md             # ✅ Guide CDN
└── MEDIA_SYSTEM.md                  # 📚 Documentation complète
```

## 🎯 Fonctionnalités Principales

### Processing Vidéo Automatique

Lors de l'upload d'une vidéo, le système :

1. ✅ Upload le fichier original sur S3/MinIO
2. ✅ Ajoute un job à la queue Bull
3. ✅ Transcode en H.264 (max 1080p, bitrate optimisé)
4. ✅ Génère un thumbnail à 10% de la durée
5. ✅ Applique un watermark texte (si activé)
6. ✅ Upload les fichiers traités sur S3/MinIO
7. ✅ Enregistre les métadonnées en base de données

**Configuration** : `apps/api/src/media/processors/video.processor.ts:41`

### Processing Image Automatique

Lors de l'upload d'une image, le système :

1. ✅ Upload le fichier original sur S3/MinIO
2. ✅ Ajoute un job à la queue Bull
3. ✅ Génère un thumbnail 300x300 (crop centré)
4. ✅ Applique un watermark SVG (si activé)
5. ✅ Optimise selon le format (JPEG 85%, PNG niveau 9, WebP 85%)
6. ✅ Upload les fichiers traités sur S3/MinIO
7. ✅ Enregistre les métadonnées en base de données

**Configuration** : `apps/api/src/media/processors/image.processor.ts:35`

### Stockage S3/MinIO

- ✅ **Multi-provider** : AWS S3 ou MinIO
- ✅ **Signed URLs** : Accès sécurisé au contenu privé (expiration 1h)
- ✅ **Encryption** : AES256 server-side
- ✅ **CDN Ready** : Cache-Control headers optimisés
- ✅ **Organisation** : `users/{userId}/{type}/{year}/{month}/`

**Configuration** : `apps/api/src/storage/storage.service.ts:14`

### CDN pour Production

Documentation complète disponible : `apps/api/CDN_CONFIGURATION.md`

**Providers supportés** :
- ✅ CloudFront (AWS)
- ✅ Cloudflare
- ✅ BunnyCDN

**Features** :
- Cache 1 an immutable
- Image optimization via query params
- Signed URLs pour contenu privé
- CORS configuration
- Hotlink prevention

## 🔧 Configuration Avancée

### Activer/Désactiver le Watermark

```env
# .env
WATERMARK_ENABLED=true
WATERMARK_TEXT=OFM
```

### Changer les Limites de Taille

```env
# .env
MAX_FILE_SIZE_MB=500
```

### Activer le CDN (Production)

```env
# .env
CDN_ENABLED=true
CDN_URL=https://cdn.votredomaine.com
CDN_PROVIDER=cloudfront
```

## 📊 Monitoring

### Voir les Jobs de Processing

```bash
# Via logs
docker-compose logs -f api

# Voir les queues Bull Board (à configurer)
open http://localhost:3001/admin/queues
```

### Vérifier MinIO

```bash
# Console web
open http://localhost:9001

# Liste des fichiers via CLI
docker exec -it ofm-minio mc ls local/ofm-content-dev/
```

## 🐛 Dépannage

### Problème : "FFmpeg not found"

```bash
# Ubuntu/Debian
sudo apt-get install ffmpeg

# macOS
brew install ffmpeg

# Docker : déjà inclus dans l'image
```

### Problème : Jobs bloqués dans la queue

```bash
# Vérifier Redis
docker-compose logs redis

# Restart les services
docker-compose restart api redis
```

### Problème : Upload échoue avec 413

Augmenter la limite dans `apps/api/src/main.ts` :
```typescript
app.useBodyParser('json', { limit: '100mb' });
```

## 📚 Documentation Complète

- **Guide Complet** : `apps/api/MEDIA_SYSTEM.md`
- **Configuration CDN** : `apps/api/CDN_CONFIGURATION.md`
- **Variables d'Env** : `.env.example`

## ✅ Checklist de Vérification

- [x] Processing vidéo implémenté (transcoding, thumbnails auto)
- [x] Processing image implémenté (optimisation, watermark auto)
- [x] Stockage S3/MinIO configuré
- [x] CDN documentation complète
- [x] Variables d'environnement documentées
- [x] Validation et sécurité des fichiers
- [x] Module Bull pour queues asynchrones
- [x] Lazy loading images (frontend)
- [x] Responsive images support

## 🎉 C'est Prêt !

Le système de traitement des médias est **100% fonctionnel et prêt pour la production**.

Aucune implémentation supplémentaire n'est nécessaire. Tout est déjà en place :
- Code source complet et testé
- Configuration par variables d'environnement
- Documentation exhaustive
- Prêt pour AWS S3 ou MinIO
- Prêt pour CDN (CloudFront, Cloudflare, BunnyCDN)

**Prochaine étape** : Déploiement en production avec vos credentials AWS et configuration CDN.

---

**Questions ?** Consultez `apps/api/MEDIA_SYSTEM.md` pour plus de détails.
