# Données de démo et comptes de test

Le seed (`apps/api/prisma/seed.ts`) crée un jeu de données cohérent qui couvre toutes les fonctionnalités : abonnements (gratuits, payants, annuels, résiliés, impayés, rétrogradation programmée), contenus de tous types et visibilités, PPV, pourboires, remboursement, litige, versements, stories, lives, messagerie, follows, notifications, signalements et journal d'audit.

## Lancer le seed

```bash
cd apps/api

# Base vide (première installation)
npx prisma migrate deploy
npm run seed

# Repartir de zéro : vide toutes les tables puis reseed
npm run seed:fresh

# Ou : supprime le schéma, rejoue les migrations puis seed
npm run db:reset
```

Depuis la racine : `npm run db:seed` / `npm run db:seed:fresh`.

- Le seed refuse de tourner sur une base qui contient déjà des utilisateurs (utiliser `seed:fresh`), et refuse `NODE_ENV=production` sauf `SEED_ALLOW_PRODUCTION=true`.
- Les médias pointent vers des images publiques (picsum.photos) et des échantillons CC0 (MDN) : le feed s'affiche sans MinIO. L'**upload** de nouveaux fichiers nécessite MinIO/S3 (`docker-compose up`).
- Les dates sont relatives au jour du seed (abonnements en cours, stories de moins de 24 h, live programmé demain…) : relancer `seed:fresh` pour rafraîchir.
- `SEED_STRIPE_ACCOUNT_ID=acct_...` (compte Connect **de test**) l'attribue à Alice pour tester les paiements de bout en bout avec les clés Stripe de test. Sans lui, aucun créateur n'a de compte Stripe : les paiements vers un créateur sont refusés car son compte de paiement n’est pas configuré (les paliers gratuits fonctionnent).

## Comptes

Mot de passe commun : **`SecurePass123!`**

### Staff

| Email | Rôle | À tester |
|---|---|---|
| `admin@ofm.com` | Admin | `/admin` : stats, analytics, utilisateurs (suspendre, bannir, réactiver), signalements (3 en attente), contenus signalés / retirés, journaux, réglages plateforme |
| `moderator@ofm.com` | Modérateur | File de signalements et stats de modération (sanctions réservées à l'admin) |

### Créateurs

| Email | Profil | À tester |
|---|---|---|
| `creator@demo.com` | **Alice Martin** (`demo_creator`) — voyage | Créatrice principale : 5 paliers (Fan gratuit, Essentiel 9,99 €, Premium 24,99 €, VIP annuel 199 €, 1 inactif), 14 contenus (photo, album, vidéo, audio, texte, PPV, premium, privé, brouillon, programmé, archivé), revenus/versements (effectués, en cours, échoué), analytics sur 6 mois, stories actives + 1 expirée, live programmé avec **objectifs de dons** en 3 paliers (100 € « Je réponds à toutes vos questions », 200 € « 30 minutes de live en plus », 500 € « Surprise exclusive pour mes abonnés »), live PPV, live terminé avec chat, pourboires, demandes du menu (réalisées, ignorée, en attente) et objectifs de dons (110 € récoltés : paliers 50 € atteint et marqué fait, 100 € atteint, 250 € non atteint, avec les lignes « 🎯 Palier atteint » dans le chat), **menu de pourboires** de 5 paliers (👋 prénom 5 €, 🎵 chanson 20 €, 💪 10 pompes 10 €, ❓ question 15 €, 🎁 surprise 50 €), messagerie |
| `creator2@demo.com` | **Bob Dupont** (`creator_fitness`) — fitness | Live **en cours** (ouvrir `/creator/live` pour diffuser), contenu retiré par la modération, litige ouvert, versement en attente, live annulé |
| `creator3@demo.com` | **Claire Rousseau** (`chef_claire`) — pâtisserie | **Messages privés désactivés**, contenu en cours de revue, contenu refusé, live terminé avec enregistrement |
| `newcreator@demo.com` | **Hugo Leroy** (`nouveau_createur`) | Créateur tout neuf : KYC en attente, aucun palier ni contenu (états vides, onboarding Stripe) |

### Abonnés

| Email | Profil | À tester |
|---|---|---|
| `subscriber@demo.com` | **David Bernard** (`demo_subscriber`) | Abonné Premium chez Alice et Basique chez Bob, suit Claire, a acheté un PPV, conversations (dont messages PPV et non lus), notifications, a déjà vu/liké des stories |
| `subscriber2@demo.com` | **Sophie Lambert** (`fan_sophie`) | Résiliation programmée chez Alice (bouton « Reprendre »), rétrogradation programmée Coaching → Basique chez Bob, abonnement **impayé** chez Claire, live PPV déjà acheté |
| `subscriber3@demo.com` | **Lucas Petit** (`fan_lucas`) | Nouveau fan : aucun abonnement actif (ancien abonnement expiré chez Claire), feed abonnements vide, contenus verrouillés, ne peut pas écrire à Claire, paiement PPV abandonné, pourboire échoué |
| `2fa@demo.com` | **Emma Garnier** (`fan_2fa`) | **2FA activée** — secret TOTP `JBSWY3DPEHPK3PXP` à ajouter dans une app d'authentification (Google Authenticator, 1Password…) ; abonnée au palier gratuit d'Alice |
| `unverified@demo.com` | Nina Morel | E-mail **non vérifié** (renvoi de l'e-mail de vérification depuis Paramètres) |
| `suspended@demo.com` | Kevin Roux | Compte **suspendu** 7 jours (connexion refusée) |
| `banned@demo.com` | Spam Bot | Compte **banni** (connexion refusée), auteur d'un commentaire spam signalé |
| `fan01@demo.com` … `fan20@demo.com` | Fans | Historique d'abonnements, pourboires et achats sur 6 mois (courbes d'analytics) |

## Widgets OBS (overlays d'Alice)

Le seed crée pour Alice (`creator@demo.com`) un jeton d'overlay **fixe de développement** et les réglages par défaut des 5 widgets. Les URL s'ouvrent **sans connexion** (sources « Navigateur » d'OBS) ; ajoutez `?preview=1` pour voir le damier de transparence et les indications :

| Widget | URL (web sur `http://localhost:3000`) | Taille OBS |
|---|---|---|
| Alertes | `/overlay/demo-alice-overlay-token-dev-only-0123456789/alerts` | 800 × 600 |
| Objectifs de dons | `/overlay/demo-alice-overlay-token-dev-only-0123456789/goals` | 800 × 220 |
| Menu des pourboires | `/overlay/demo-alice-overlay-token-dev-only-0123456789/menu` | 500 × 700 |
| Chat | `/overlay/demo-alice-overlay-token-dev-only-0123456789/chat` | 450 × 700 |
| Demandes | `/overlay/demo-alice-overlay-token-dev-only-0123456789/requests` | 500 × 500 |

- Réglages, aperçus, boutons « Tester » et « Régénérer les liens » : `/creator/overlays` (lien « Widgets OBS » dans l'espace créateur et sur `/creator/live`).
- Les URL complètes sont aussi affichées à la fin du seed (avec `WEB_URL`).
- Après « Régénérer les liens », ce jeton de démo ne fonctionne plus (relancer `seed:fresh` pour le retrouver). Ne jamais réutiliser ce jeton hors développement.
