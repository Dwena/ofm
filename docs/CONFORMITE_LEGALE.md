# Conformité légale — checklist avant lancement

Ce document liste ce que la société doit faire **en dehors du code** avant de mettre FanVIP en ligne,
puis les points techniques restant à brancher. Il ne remplace pas l'avis d'un avocat ni d'un
expert-comptable : chaque point marqué « à valider » doit l'être par eux.

Les textes juridiques sont dans `apps/web/app/legal/*` (pages publiques `/legal/...`). Ils contiennent des
champs à remplir entre crochets et un bandeau « Projet — à faire valider par un avocat avant mise en
ligne », qu'on supprime en passant `LEGAL_DRAFT` à `false` dans `apps/web/lib/legal.ts`.

---

## 1. Société, banque, assurance

- [ ] **Constituer la société** (SAS ou SASU le plus souvent) : statuts avec un objet social qui couvre
  l'activité (« exploitation d'une plateforme en ligne de diffusion et de vente de contenus numériques,
  y compris pour adultes »), capital, président. Formalités sur le guichet unique :
  <https://formalites.entreprises.gouv.fr>.
- [ ] **Extrait Kbis**, numéro SIREN / RCS, **numéro de TVA intracommunautaire**.
- [ ] **Compte bancaire professionnel qui accepte l'activité** : beaucoup de banques refusent les contenus
  pour adultes. Le présenter dès le départ (modèle, modération, vérification d'âge, processeur de
  paiement) pour éviter une clôture ultérieure.
- [ ] **Marque et nom de domaine** : vérifier la disponibilité de « FanVIP » (base marques INPI,
  <https://www.inpi.fr>) avant d'investir dans la marque, puis la déposer.
- [ ] **Assurance RC professionnelle** (et idéalement cyber-risques) couvrant l'activité d'hébergeur de
  contenus pour adultes.

## 2. Paiement

- [ ] **Contrat avec le processeur CCBill** (compte marchand « high risk » / adulte). FanVIP est vendeur
  (merchant of record) : c'est elle qui facture les fans et reverse leur part aux créateurs.
- [ ] Respecter les règles des réseaux de cartes pour les marchands de contenus adultes (notamment
  Mastercard AN 5196 « Specialty Merchant Registration ») : vérification d'âge et d'identité de toute
  personne apparaissant dans les contenus, consentements écrits, revue des contenus avant publication,
  traitement des plaintes et des demandes de retrait dans des délais courts, procédure d'appel. Le
  processeur auditera le site avant activation.
- [ ] Choisir un **libellé de relevé bancaire discret** et le reporter dans les CGV
  (`[LIBELLÉ SUR LE RELEVÉ BANCAIRE]`).
- [ ] Vérifier où CCBill traite les données (États-Unis ?) et sur quelle base (DPF / clauses
  contractuelles types) pour la section « Transferts hors UE » de la politique de confidentialité.

## 3. Prestataires de confiance

- [ ] **Vérification d'âge** : prestataire indépendant conforme au **référentiel technique de l'Arcom**
  (loi SREN n° 2024-449 du 21 mai 2024), proposant au moins une solution en « double anonymat », audité.
  Renseigner son nom dans la politique de confidentialité. <https://www.arcom.fr>
- [ ] **Détection de contenus pédocriminels connus** (hash matching) : Microsoft **PhotoDNA** (gratuit pour
  les organisations éligibles, sur demande) ou **Thorn Safer** (payant). Prévoir la procédure de
  signalement (PHAROS : <https://www.internet-signalement.gouv.fr> ; NCMEC si le prestataire l'exige).
  À valider avec l'avocat : base légale de l'analyse automatisée des **messages privés** (règlement
  (UE) 2021/1232 dérogatoire et temporaire — vérifier sa prorogation).
- [ ] **Vérification d'identité des créateurs** (KYC) : en interne ou via un prestataire. Si le selfie est
  comparé automatiquement à la pièce d'identité, il s'agit de **données biométriques** (art. 9 RGPD) :
  à couvrir dans l'AIPD.
- [ ] **Hébergeur** : nom, adresse, téléphone dans les mentions légales. Préférer un hébergement dans l'UE.
- [ ] **Sentry** (suivi d'erreurs) : choisir la région UE, activer « Prevent Storing of IP Addresses »,
  signer le DPA. La configuration web n'envoie ni replay, ni PII, ni cookie (`apps/web/lib/monitoring.ts`).
- [ ] Signer un **contrat de sous-traitance art. 28 RGPD** (DPA) avec chaque prestataire.

## 4. Consommateurs

- [ ] **Médiateur de la consommation** : adhésion obligatoire (art. L612-1 Code de la consommation) à un
  médiateur référencé par la CECMC — liste et explications : <https://www.economie.gouv.fr/mediation-conso>.
  Renseigner `[MÉDIATEUR DE LA CONSOMMATION : nom, site]`.
- [ ] **Médiateurs P2B** pour les litiges avec les créateurs (règlement (UE) 2019/1150, art. 12 :
  désigner au moins deux médiateurs) : `[MÉDIATEURS P2B : noms, sites]` dans les Conditions créateurs.
- [ ] Service client joignable (`[EMAIL DE CONTACT]`) avec un délai de réponse tenable (les CGV annoncent
  72 h ouvrées).

## 5. Fiscalité et comptabilité (expert-comptable)

- [ ] **TVA des ventes aux fans** : FanVIP vend des services électroniques à des consommateurs de toute
  l'UE ⇒ TVA du pays du fan. S'inscrire au **guichet unique OSS** (déclaration trimestrielle unique) sur
  <https://www.impots.gouv.fr> (espace professionnel). Hors UE : règles locales à étudier avant d'ouvrir
  ces pays.
- [ ] **Autofacturation** : faire valider le mandat (art. 289 I-2 CGI) inclus dans les Conditions créateurs,
  la numérotation et les mentions des factures émises au nom des créateurs (régime TVA de chaque créateur :
  franchise en base, assujetti, créateur étranger / autoliquidation).
- [ ] **DAC7 / article 242 bis et 1649 ter A CGI** : déclaration annuelle des revenus des créateurs à la
  DGFiP **avant le 31 janvier** de chaque année (revenus de l'année N-1), et envoi à chaque créateur de
  son relevé annuel avant la même date. Première déclaration : janvier de l'année suivant le lancement.
  Directive : <https://eur-lex.europa.eu/eli/dir/2021/514/oj>.
- [ ] **Facturation électronique** (réforme française) :
  - **réception** des factures fournisseurs en format électronique obligatoire pour toutes les entreprises
    **depuis le 1er septembre 2026** ⇒ choisir **dès maintenant** une plateforme agréée (PA) ;
  - **émission** de factures électroniques et **e-reporting** (dont les ventes B2C aux fans et les données
    de paiement) à partir du **1er septembre 2027** pour les PME et micro-entreprises ;
  - les factures d'autofacturation émises pour les créateurs entrent dans le périmètre : à prévoir avec
    la PA.
  Informations : <https://www.economie.gouv.fr> et <https://www.impots.gouv.fr>.
- [ ] Conservation des pièces comptables **10 ans** (art. L123-22 Code de commerce).
- [ ] Rappeler aux créateurs leurs obligations (impôt sur le revenu, URSSAF, TVA) : texte présent dans les
  Conditions créateurs ; un lien vers impots.gouv.fr et urssaf.fr y figure.

## 6. Données personnelles (RGPD / CNIL)

- [ ] **Registre des activités de traitement** (art. 30 RGPD) : comptes, paiements, KYC, vérification
  d'âge (résultat uniquement), données fiscales DAC7, messagerie, modération, journaux de connexion.
- [ ] **Analyse d'impact (AIPD) obligatoire** (art. 35 RGPD) : données sensibles à grande échelle (vie
  sexuelle déductible des abonnements / achats / messages), documents d'identité, éventuelle biométrie,
  analyse automatisée des contenus. Méthode et outil PIA : <https://www.cnil.fr>. Si un risque élevé
  subsiste après mesures : consultation préalable de la CNIL (art. 36).
- [ ] **Désigner un DPO** (art. 37 : traitement à grande échelle de catégories particulières de données
  comme activité de base) et déclarer sa désignation à la CNIL en ligne. Renseigner
  `[EMAIL DPO / CONTACT DONNÉES PERSONNELLES]`.
- [ ] Valider les **durées de conservation** de la politique de confidentialité, notamment
  « KYC / autorisations des co-performeurs : durée du compte + 5 ans » (marquée « à valider »).
- [ ] Procédure de gestion des **violations de données** (notification CNIL sous 72 h).
- [ ] Procédure de réponse aux **demandes d'exercice de droits** (1 mois).
- [ ] **Cookies** : la plateforme n'utilise que des traceurs strictement nécessaires (liste dans
  `/legal/cookies`), donc **pas de bandeau**. Tout ajout d'analytics, de pixel publicitaire ou d'outil
  d'enregistrement de session (LogRocket, Hotjar, Sentry Replay…) imposerait un bandeau de consentement
  et la mise à jour de la politique ; sur une plateforme adulte, l'enregistrement de session est à
  proscrire.

## 7. Arcom, DSA et autorités

- [ ] **Déclaration à l'Arcom ?** Il n'existe pas de déclaration préalable générale pour une plateforme en
  ligne. En revanche :
  - l'Arcom contrôle la **vérification d'âge** (référentiel SREN) et peut mettre en demeure, faire bloquer
    et déréférencer un site non conforme ;
  - l'Arcom est le **coordinateur pour les services numériques** (DSA) en France ;
  - **à valider avec l'avocat** : qualification éventuelle de « plateforme de partage de vidéos »
    (directive SMA révisée, loi n° 86-1067 du 30 septembre 1986) et obligations associées.
- [ ] **DSA** (règlement (UE) 2022/2065, <https://eur-lex.europa.eu/eli/reg/2022/2065/oj>) :
  - **point de contact unique** pour les autorités et les utilisateurs (art. 11 et 12) :
    `[EMAIL POINT DE CONTACT DSA]` — boîte surveillée, réponses en français et en anglais ;
  - mécanisme de **notification et action** (art. 16) et **exposé des motifs** (art. 17) : obligatoires
    quelle que soit la taille ;
  - réclamations internes (art. 20), règlement extrajudiciaire (art. 21), signaleurs de confiance (art.
    22), récidive (art. 23), rapports de transparence (art. 15, 24) : les micro et petites entreprises en
    sont en partie exemptées (art. 15 § 2 et 19), mais les CGU les prévoient déjà — garder cette
    approche, le processeur de paiement l'exige de toute façon ;
  - publier le **nombre moyen d'utilisateurs actifs mensuels** dans l'UE quand l'exemption cesse ou à la
    demande de l'Arcom.
- [ ] **PHAROS** : procédure interne pour signaler les contenus manifestement illicites
  (<https://www.internet-signalement.gouv.fr>) et conserver les preuves ; informer les autorités en cas de
  menace pour la vie ou la sécurité des personnes (art. 18 DSA).
- [ ] Désigner un **interlocuteur pour les réquisitions judiciaires**.
- [ ] **Conservation des données de connexion** (décret n° 2021-1362 du 20 octobre 2021) : 1 an pour les
  données de trafic, jusqu'à 5 ans après la fin du contrat pour les données d'identité civile : à
  vérifier avec l'avocat et à paramétrer côté infra (journaux).

## 8. Textes juridiques (avocat)

- [ ] Faire relire et valider **toutes** les pages `/legal/*` : mentions légales, CGU, CGV, Conditions
  créateurs (incl. mandat d'autofacturation), règles de contenu, confidentialité, cookies, signalement.
- [ ] Remplir les champs entre crochets (centralisés dans `apps/web/lib/legal.ts`, objet `COMPANY`, plus
  quelques champs propres à une page) :
  `[RAISON SOCIALE]`, `[FORME JURIDIQUE ET CAPITAL]`, `[ADRESSE DU SIÈGE]`, `[RCS / SIREN]`,
  `[N° TVA INTRACOMMUNAUTAIRE]`, `[DIRECTEUR DE LA PUBLICATION]`, `[EMAIL DE CONTACT]`,
  `[HÉBERGEUR : nom, adresse, téléphone]`, `[MÉDIATEUR DE LA CONSOMMATION : nom, site]`,
  `[EMAIL POINT DE CONTACT DSA]`, `[EMAIL DPO / CONTACT DONNÉES PERSONNELLES]`, `[URL DU SITE]`,
  `[LIBELLÉ SUR LE RELEVÉ BANCAIRE]`, `[MÉDIATEURS P2B : noms, sites]`, `[NOM DU PRESTATAIRE]` (vérification
  d'âge), `[NOMS DES PRESTATAIRES]`, `[TRANSFERTS HORS UE : …]`, `[Sentry ou autre — région de stockage]`,
  `[durée à valider]` (KYC), et `LEGAL_LAST_UPDATE = '[DATE]'`.
- [ ] Modèle d'**autorisation de diffusion (release)** des co-performeurs.
- [ ] Puis : `LEGAL_DRAFT = false` dans `apps/web/lib/legal.ts`.
- [ ] À chaque modification substantielle d'un texte : incrémenter la version dans
  `apps/api/src/legal/legal-versions.ts` **et** `apps/web/lib/legal.ts` (les utilisateurs devront
  ré-accepter : `GET /legal/status`, `POST /legal/accept`), et prévenir 15 jours avant (CGU, Conditions
  créateurs — règlement P2B).

## 9. Modération (organisation)

- [ ] Équipe de modération dimensionnée pour la **modération a priori** de tous les contenus et la
  surveillance des lives, avec astreinte pour les signalements urgents (mineurs, non-consentement).
- [ ] Procédure écrite : critères, escalade, signalement aux autorités, conservation des preuves,
  traitement des réclamations (6 mois) par une autre personne que l'auteur de la décision.
- [ ] Soutien psychologique des modérateurs (exposition à des contenus choquants).

## 10. Reste à faire dans le code (suivi)

- [ ] Écran de **ré-acceptation** des documents mis à jour (s'appuyer sur `GET /legal/status`,
  `POST /legal/accept`).
- [ ] Au **checkout** : case « je demande l'accès immédiat et renonce à mon droit de rétractation »
  (art. L221-28 13°), acceptation des CGV enregistrée (`document: 'cgv'`), et rappel de cet accord dans
  l'e-mail de confirmation (art. L221-13).
- [ ] **E-mail de rappel avant reconduction** des abonnements annuels (entre 3 mois et 1 mois avant
  l'échéance, art. L215-1).
- [ ] **Formulaire public de signalement** sans compte (aujourd'hui : bouton « Signaler » pour les
  connectés + e-mail du point de contact DSA sur `/legal/signalement`).
- [x] Les pages d'accueil ne mentionnent plus « Stripe » (aligné sur le processeur retenu, CCBill).
