# Prisma Setup Instructions

## Problème réseau Prisma

Si vous rencontrez une erreur "403 Forbidden" lors de la génération du client Prisma, suivez ces étapes:

## Solution rapide

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

## Variables d'environnement

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

## Après avoir généré le client

```bash
# Lancer le serveur de développement
npm run dev
```

## En cas de problème persistant

1. Supprimez le dossier `node_modules/@prisma`
2. Réinstallez les dépendances: `npm install`
3. Régénérez le client: `npx prisma generate`
