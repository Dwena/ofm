# E2E Tests

Tests end-to-end automatisés pour la plateforme FanVIP.

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

Les sélecteurs suivent l'interface en français : rôles ARIA (`getByRole`), libellés et
`data-testid` ajoutés aux composants (`login-email`, `upload-file-input`, `publish-content`,
`media-job-status`, `reports-queue`, `nav-link-*`, ...). Les fixtures `asCreator`, `asSubscriber`
et `asAdmin` (voir `fixtures/auth.fixture.ts`) connectent le compte correspondant.

- `auth.spec.ts` : connexion, inscription, validations, session / déconnexion
- `creator-dashboard.spec.ts` : dashboard, navigation, analytics et abonnements créateur
- `content-upload.spec.ts` : upload d'image, PPV, album, erreurs de type, suivi du traitement vidéo
  (« Traitement de la vidéo » → « Vidéo prête »)
- `subscriber-feed.spec.ts` : feed, abonnements, messagerie côté abonné
- `messaging.spec.ts` : messages temps réel entre créateur et abonné, indicateur de saisie, image
- `payment-flow.spec.ts` : paiement sécurisé d'un abonnement, cartes de test du simulateur, PPV, pourboire, résiliation
- `admin.spec.ts` : back-office (analytique, paramètres, signalements, statistiques de modération, journaux)

Les scénarios dépendant de données absentes (aucune conversation, aucun live...) sont ignorés
(`test.skip`) ; les fonctionnalités pas encore présentes dans l'interface sont marquées `test.fixme`.

## Fixtures

### Comptes de test (test-users.json)
Comptes créés par `npm run seed` (apps/api), mot de passe `SecurePass123!` :
- **Créateur** : creator@demo.com (`demo_creator`, Alice Martin)
- **Abonné** : subscriber@demo.com (`demo_subscriber`, David Bernard)
- **Admin** : admin@ofm.com

Surchargeables via `TEST_CREATOR_EMAIL`, `TEST_SUBSCRIBER_PASSWORD`, etc.

### Fichiers
Les images et fichiers texte sont générés en mémoire (`fixtures/files.ts`).
Pour tester le traitement vidéo, fournissez un fichier : `E2E_VIDEO_PATH=/chemin/video.mp4`.
Les paiements par carte passent par le simulateur local : lancez l'API avec `PAYMENT_PROVIDER=fake` (valeur par défaut hors production), voir [docs/PAIEMENTS.md](../../../docs/PAIEMENTS.md). Les contenus sont publiés après validation par un modérateur : pour les tests de publication, lancez l'API avec `CONTENT_PREMODERATION=false`. L'avertissement « contenu réservé aux adultes » est fermé automatiquement par la fixture (`sessionStorage.ageGateDismissed`).

## Cartes de test du simulateur

Pour les tests de paiement, utilisez les cartes de test du simulateur de paiement (`/checkout/simulateur`), qui ne débite aucune vraie carte. Le simulateur ne regarde que les 4 derniers chiffres :

- **Succès** : `4242`
- **Échec** : `0002`
- **Authentification requise aux achats suivants en un clic** : `3220`

Le seed enregistre déjà une carte 4242 pour chaque fan (et une carte 0002 pour Sophie).

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
- Vérifier que l'API tourne avec `PAYMENT_PROVIDER=fake` (le simulateur refuse de fonctionner en production)
- Vérifier que le seed a été joué (cartes de test enregistrées)
- Vérifier que `DATA_ENCRYPTION_KEY` est défini

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
