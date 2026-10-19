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
| `creator@demo.com` | **Alice Martin** (`demo_creator`) — voyage | Créatrice principale : 5 paliers (Fan gratuit, Essentiel 9,99 €, Premium 24,99 €, VIP annuel 199 €, 1 inactif), 14 contenus (photo, album, vidéo, audio, texte, PPV, premium, privé, brouillon, programmé, archivé), revenus/versements (effectués, en cours, échoué), analytics sur 6 mois, stories actives + 1 expirée, live programmé, live PPV, live terminé avec chat, messagerie |
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
