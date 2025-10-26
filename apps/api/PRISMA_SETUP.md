# Prisma Setup Instructions

## 🚀 Solution rapide pour Windows

Si vous êtes sur **Windows** et rencontrez des erreurs, utilisez le script automatique :

```powershell
# PowerShell (Recommandé)
.\dev-windows.ps1

# OU CMD
dev-windows.bat
```

Ces scripts vont automatiquement :
1. ✅ Nettoyer le cache webpack
2. ✅ Régénérer le client Prisma
3. ✅ Démarrer le serveur de dev

---

## 📋 Configuration manuelle

### Problème réseau Prisma

Si vous rencontrez une erreur "403 Forbidden" lors de la génération du client Prisma :

```bash
# 1. Aller dans le dossier API
cd apps/api

# 2. Générer le client Prisma
npm run prisma:generate

# 3. Si l'erreur 403 persiste, utiliser:
npx prisma generate

# 4. Créer une migration (si nécessaire)
npx prisma migrate dev --name add-conversation-model
```

### Variables d'environnement

Si vous êtes dans un environnement hors ligne ou avec des restrictions réseau:

```bash
# Windows PowerShell
$env:PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
npx prisma generate

# Windows CMD
set PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
npx prisma generate

# Linux/Mac
PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 npx prisma generate
```

### Nettoyer le cache webpack

Si vous voyez l'erreur "Module not found: Error: Can't resolve './media/media.module'":

```bash
# Windows PowerShell
Remove-Item -Recurse -Force node_modules\.cache
npm run dev

# Linux/Mac
rm -rf node_modules/.cache
npm run dev
```

---

## ⚠️ Erreurs courantes

### ❌ "Cannot find module './media/media.module'"

**Cause**: Cache webpack obsolète
**Solution**:
```bash
rm -rf node_modules/.cache
npm run dev
```

### ❌ "Property 'conversation' does not exist on type 'PrismaService'"

**Cause**: Client Prisma pas régénéré
**Solution**:
```bash
npx prisma generate
```

### ❌ "Argument of type 'any' is not assignable to parameter of type 'never'"

**Cause**: Client Prisma pas régénéré (types TypeScript obsolètes)
**Solution**:
```bash
npx prisma generate
npm run dev
```

---

## 🔧 En cas de problème persistant

1. Supprimez le dossier `node_modules/@prisma`
   ```bash
   rm -rf node_modules/@prisma
   ```

2. Réinstallez les dépendances
   ```bash
   npm install
   ```

3. Régénérez le client
   ```bash
   npx prisma generate
   ```

4. Nettoyez le cache
   ```bash
   rm -rf node_modules/.cache
   ```

5. Redémarrez le serveur
   ```bash
   npm run dev
   ```
