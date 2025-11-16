# E2E Tests

Tests end-to-end automatisés pour la plateforme OFM.

## Prérequis

1. Installer les navigateurs Playwright :
```bash
npx playwright install
```

2. S'assurer que l'application est en cours d'exécution :
```bash
# Terminal 1 - Backend API
cd apps/api
npm run dev

# Terminal 2 - Frontend Web
cd apps/web
npm run dev
```

3. S'assurer que la base de données est seed avec les utilisateurs de test :
```bash
cd apps/api
npm run seed
```

## Exécution des tests

### Tous les tests
```bash
cd apps/web
npm run test:e2e
```

### Un test spécifique
```bash
npx playwright test e2e/payment-flow.spec.ts
npx playwright test e2e/content-upload.spec.ts
npx playwright test e2e/messaging.spec.ts
```

### Mode UI (interactif)
```bash
npm run test:e2e:ui
```

### Mode debug
```bash
npm run test:e2e:debug
```

### Générer un rapport
```bash
npx playwright show-report
```

## Structure des tests

### payment-flow.spec.ts
- ✅ Achat d'abonnement complet
- ✅ Envoi de pourboire
- ✅ Gestion des erreurs de paiement
- ✅ Annulation d'abonnement

### content-upload.spec.ts
- ✅ Upload d'image
- ✅ Upload de vidéo avec traitement
- ✅ Upload de galerie (multiple images)
- ✅ Gestion d'erreurs (type invalide, fichier trop grand)
- ✅ Annulation d'upload
- ✅ Édition de contenu
- ✅ Suppression de contenu

### messaging.spec.ts
- ✅ Envoi et réception de messages
- ✅ Indicateur de saisie (typing)
- ✅ Envoi d'image dans message
- ✅ Suppression de message
- ✅ Marquer comme lu
- ✅ Recherche de messages
- ✅ Blocage d'utilisateur

## Fixtures

### Test Users (test-users.json)
Utilisateurs de test pour l'authentification :
- **Creator**: alice@ofm.com
- **Subscriber**: david@ofm.com
- **Admin**: admin@ofm.com

Mot de passe pour tous : `SecurePass123!`

### Test Files
Les fichiers suivants doivent être placés dans `apps/web/e2e/fixtures/` :

- `test-image.jpg` - Image de test (1920x1080 recommandé)
- `test-image-2.jpg` - Deuxième image pour galerie
- `test-video.mp4` - Vidéo courte (5-10 secondes)
- `test-file.txt` - Fichier texte pour test d'erreur
- `large-video.mp4` - Vidéo large pour test de limite de taille (optionnel)

## Cartes de test Stripe

Pour les tests de paiement, utilisez les cartes de test Stripe :

- **Succès** : `4242 4242 4242 4242`
- **Échec** : `4000 0000 0000 0002`
- **3D Secure** : `4000 0027 6000 3184`

Date d'expiration : N'importe quelle date future (ex: 12/34)
CVC : N'importe quel 3 chiffres (ex: 123)
Code postal : N'importe quel code (ex: 12345)

## Configuration

Les tests utilisent les URLs suivantes par défaut :
- Frontend : http://localhost:3000
- Backend API : http://localhost:3001

Pour modifier ces URLs, créer un fichier `.env.test` :
```
NEXT_PUBLIC_API_URL=http://localhost:3001
PLAYWRIGHT_BASE_URL=http://localhost:3000
```

## Résolution des problèmes

### Les tests échouent avec "Element not found"
- Vérifier que l'application est en cours d'exécution
- Augmenter les timeouts dans playwright.config.ts
- Exécuter en mode debug pour voir l'interface

### Les tests WebSocket échouent
- Vérifier que Socket.io est bien configuré
- Vérifier les CORS
- S'assurer que le backend WebSocket est actif

### Les tests de paiement échouent
- Vérifier que Stripe est configuré en mode test
- Utiliser les clés de test Stripe
- Vérifier que les webhooks Stripe sont configurés

## CI/CD

Pour intégrer dans un pipeline CI/CD :

```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: docker-compose up -d
      - run: npm run test:e2e
```

## Notes

- Les tests créent et modifient des données dans la base de données de test
- Il est recommandé d'utiliser une base de données séparée pour les tests
- Les tests peuvent prendre plusieurs minutes à s'exécuter complètement
- Certains tests nécessitent plusieurs contextes de navigateur (multi-utilisateur)
