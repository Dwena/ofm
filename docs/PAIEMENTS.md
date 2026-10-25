# Paiements, TVA et virements créateurs

Ce document décrit comment l’argent circule sur la plateforme depuis le remplacement de Stripe (qui interdit le contenu adulte), et ce qu’il reste à faire pour passer en production.

## 1. Le modèle

```
Fan ──(carte, prix HT + TVA)──▶ Prestataire de paiement (CCBill) ──▶ compte bancaire de la plateforme
                                                                          │
                       solde créateur (registre interne) ◀── part créateur (85 % du HT)
                                                                          │
Créateur ◀──────────── virement SEPA hebdomadaire (fichier pain.001) ─────┘
```

- **La plateforme vend au fan en son nom.** Pour la TVA, c’est elle le fournisseur du service électronique : article 9 bis du règlement d’exécution 282/2011. Elle encaisse donc la totalité du paiement, et elle doit la TVA.
- **Le créateur fixe un prix hors taxes (HT).** Le fan paie ce prix plus la TVA de son pays de résidence. La commission de la plateforme (15 % par défaut, modifiable dans `/admin/settings`) et la part du créateur sont calculées sur le prix HT.

  | | Montant |
  |---|---|
  | Prix fixé par le créateur | 10,00 € HT |
  | TVA France 20 % (reversée par la plateforme) | 2,00 € |
  | **Payé par le fan** | **12,00 € TTC** |
  | Commission de la plateforme (15 %) | 1,50 € |
  | Part du créateur | 8,50 € |

  - Les taux de TVA des 27 pays de l’UE sont dans `apps/api/src/common/utils/vat.ts`, avec une copie d’affichage dans `apps/web/lib/vat.ts`. **Ils sont à revoir chaque année.**
  - Hors UE, aucune TVA n’est appliquée. À valider avec l’expert-comptable : Royaume-Uni, Suisse, Norvège… ont leur propre TVA numérique.
  - Le pays de facturation est déclaré par le fan au paiement et enregistré sur son compte. Le pays de son adresse IP (en-tête du CDN) et le pays de sa carte sont conservés comme preuves de localisation (`Transaction.taxEvidence`).
- **Le créateur est payé depuis un solde interne.** Chaque paiement crédite sa part sur ce solde (`CreatorBalanceEntry`). Cette part reste bloquée **7 jours** (`EARNINGS_HOLD_DAYS`), le temps d’absorber les remboursements et les contestations bancaires. Les remboursements, les contestations et les virements sont des débits du même registre.
- **Les virements sont faits par la plateforme** depuis son propre compte bancaire, par virement SEPA.
  - Chaque lundi, un virement est créé pour chaque créateur dont le solde disponible dépasse le minimum. Le créateur peut aussi en demander un.
  - L’admin génère le fichier SEPA dans `/admin/payouts` (menu « Virements »), le dépose dans l’espace bancaire professionnel, puis marque chaque virement comme payé ou rejeté. Un virement rejeté est recrédité sur le solde.
  - **Conditions pour être payé :**
    - identité vérifiée (KYC) ;
    - profil fiscal complet (DAC7 : identité, adresse, NIF, IBAN chiffré) ;
    - mandat d’autofacturation accepté.

> ⚠️ **À valider avec l’avocat :** dans ce schéma, la plateforme paie ses propres fournisseurs (les créateurs) ; elle ne détient pas des fonds pour le compte de tiers. C’est ce qui permet, en principe, de ne pas demander d’agrément d’établissement de paiement auprès de l’ACPR. Ce point est essentiel.

## 2. Abonnements

C’est la plateforme qui gère les renouvellements (`apps/api/src/payments/billing.service.ts`), pas le prestataire :

- **Premier paiement :** l’abonnement démarre quand le paiement est confirmé. La carte utilisée est enregistrée chez le prestataire (jeton) pour les renouvellements.
- **Renouvellement :** une tâche tourne toutes les heures et débite la carte à la fin de chaque période. Le prix reste celui payé par l’abonné : une hausse de prix ne concerne que les nouveaux abonnés.
- **Échec de renouvellement :**
  - l’abonnement passe en « paiement en retard » ;
  - nouvelles tentatives à J+1, J+3 puis J+5, avec une notification au fan à chaque fois ;
  - après la dernière tentative, l’abonnement est résilié.
- **Changement d’offre :**
  - vers une offre plus chère : paiement immédiat au prorata, une nouvelle période démarre ;
  - vers une offre moins chère : appliqué au prochain renouvellement ;
  - vers l’offre gratuite : à la fin de la période.
- **Résiliation :** en un clic depuis « Mes abonnements ». L’accès reste ouvert jusqu’à la fin de la période payée.

## 3. Le parcours de paiement

1. L’API crée une transaction `PENDING` avec le prix HT, la TVA, le total, la commission et la part du créateur.
2. Deux cas possibles :
   - **Carte enregistrée :** elle est débitée tout de suite (achat « en un clic »).
   - **Nouvelle carte :** le fan est redirigé vers la page de paiement hébergée par le prestataire. Il revient ensuite sur `/checkout/retour`, qui attend la confirmation.
3. Le webhook du prestataire (`POST /api/v1/webhooks/payments/ccbill?token=…`) confirme le paiement. L’accès est alors accordé et la part du créateur créditée, en une seule opération qui ne peut pas s’appliquer deux fois.

**Obligations au paiement :**

- **Prix TTC :** le total TTC est affiché avant le paiement.
- **Droit de rétractation :** pour un contenu numérique, une case obligatoire demande l’accès immédiat et la renonciation au droit de rétractation de 14 jours (article L221-28 13° du Code de la consommation). Cette case ne s’applique pas aux pourboires. Elle est horodatée dans `Transaction.withdrawalWaivedAt`.

**Remboursements et contestations bancaires (chargebacks) :**

- Les remboursements sont possibles depuis l’espace créateur ou par un admin, ou depuis le back-office CCBill (reçus alors par webhook).
- Pour un remboursement ou une contestation, la part correspondante du créateur est retirée de son solde.
- Un remboursement total retire aussi l’accès acheté.
- Les admins sont prévenus de chaque contestation bancaire.

## 4. Développement local : le simulateur

Avec `PAYMENT_PROVIDER=fake` (valeur par défaut hors production), la « page de paiement » est `/checkout/simulateur`. Aucune carte n’est débitée.

| Carte de test | Résultat |
|---|---|
| 4242 | Acceptée |
| 0002 | Refusée |
| 3220 | Acceptée ; les achats suivants en un clic demandent une authentification |

Le seed crée :
- une carte 4242 pour chaque fan ;
- les profils fiscaux complets d’Alice et de Claire. Il faut `DATA_ENCRYPTION_KEY` pour enregistrer l’IBAN.

Le simulateur refuse de fonctionner en production.

## 5. Prestataire retenu : CCBill

**Pourquoi CCBill :**
- c’est le prestataire le plus établi pour les plateformes de créateurs adultes ;
- il gère lui-même les règles Visa et Mastercard propres au contenu adulte et l’authentification forte (3-D Secure) ;
- il propose une page de paiement hébergée (FlexForms), des achats en un clic sur carte enregistrée et des webhooks.

**Alternatives :**
- **Segpay** : agréé dans l’UE par la Banque centrale d’Irlande, ce qui est un atout pour une société française ;
- **Verotel** (Pays-Bas) ;
- **Epoch**.

L’intégration passe par une interface unique (`apps/api/src/payments/providers/payment-provider.ts`). Ajouter un autre prestataire revient à écrire un fichier, sans toucher au reste.

**Coûts habituels du secteur** (à négocier par écrit) :
- 10 à 15 % par transaction ;
- une réserve de 5 à 10 % conservée 6 mois ;
- des pénalités au-delà d’un certain taux de contestations bancaires.

### À faire pour passer en production avec CCBill

1. **Ouvrir un compte marchand CCBill.** Ils examineront la société, le site, les CGU/CGV et les procédures de vérification d’âge, d’identité et de modération (exigence de Mastercard pour le contenu adulte).
2. **Demander au support CCBill :**
   - un sous-compte avec FlexForm ;
   - les prix dynamiques (dynamic pricing) ;
   - l’achat en un clic (charge by previous transaction / shared authentication) ;
   - un accès DataLink (remboursements et facturation) ;
   - **l’autorisation de faire les renouvellements d’abonnement en un clic depuis la plateforme**, sans le système d’abonnement de CCBill. À défaut, il faut adapter `ccbill.provider.ts` et `billing.service.ts` à leur système d’abonnement.
3. **Configurer le FlexForm :**
   - URL de retour en cas de succès : `https://<site>/checkout/retour` ;
   - URL en cas de refus : la même, avec `&annule=1`.

   Vérifier que le paramètre `reference` est bien renvoyé dans les webhooks.
4. **Configurer les webhooks** (format JSON) vers `https://<api>/api/v1/webhooks/payments/ccbill?token=<CCBILL_WEBHOOK_TOKEN>`, pour les événements `NewSaleSuccess`, `NewSaleFailure`, `UpSaleSuccess`, `Refund`, `Void` et `Chargeback`.
5. **Remplir les variables `CCBILL_*`, `PAYOUT_DEBTOR_*` et `DATA_ENCRYPTION_KEY`** (voir `.env.production.example`).
6. **Tester tout le parcours sur le compte de test CCBill.** Les noms exacts des champs de webhook, le format de réponse de l’API de facturation et les plages d’IP sont repris de la documentation publique de CCBill. Ils sont indiqués « à valider » en tête de `ccbill.provider.ts`.

## 6. Points à valider avec l’expert-comptable

- La TVA due sur tout le montant payé par les fans, et le guichet unique européen (OSS) pour les fans des autres pays de l’UE.
- **Les créateurs assujettis à la TVA** (`vatRegime = 'subject'`) : l’autofacture mensuelle ajoute 20 % de TVA à leur part, mais leur solde n’est crédité que du montant HT. Il faut décider :
  - soit de leur verser aussi cette TVA (que la plateforme récupère) ;
  - soit de considérer que leur part s’entend TTC.
- La TVA perdue lors des contestations bancaires, et les avoirs à émettre en cas de remboursement.
- La conservation des pièces comptables pendant 10 ans : les transactions ne sont jamais supprimées, même quand un compte est supprimé.
- La facturation électronique :
  - **réception** obligatoire depuis septembre 2026 ;
  - **émission** et **e-reporting** (transmission des ventes aux particuliers) à partir de septembre 2027 pour les PME.
