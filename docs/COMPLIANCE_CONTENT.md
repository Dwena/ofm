# Conformité des contenus : identité, co-participants, validation, analyse des médias

Mise en œuvre technique des exigences des réseaux de cartes (règles Mastercard
« specialty merchant » pour le contenu adulte, règles d'intégrité Visa) et du
droit français. Voir aussi `docs/CONFORMITE_LEGALE.md` (check-list juridique).

## 1. Vérification d'identité des créateurs (KYC)

- Le créateur envoie (`POST /api/v1/creator/verification`, multipart) :
  `documentType` (`ID_CARD` | `PASSPORT` | `DRIVING_LICENSE` | `RESIDENCE_PERMIT`),
  `dateOfBirth` (AAAA-MM-JJ, **18 ans révolus** sinon refus), fichiers
  `documentFront`, `documentBack` (obligatoire pour carte d'identité et titre de
  séjour) et `selfie` (le créateur tenant sa pièce).
- Formats : JPG, PNG, WEBP, HEIC (+ PDF pour la pièce), 10 Mo max par fichier,
  type vérifié sur le contenu du fichier (pas sur l'extension).
- Statut : `PENDING` + `kycSubmittedAt`. Nouvel envoi possible si `REJECTED` ou
  `RESUBMIT_REQUIRED` (les anciens documents sont conservés).
- Modération : `GET /api/v1/admin/verification/kyc` (file d'attente),
  `GET /api/v1/admin/verification/kyc/:userId` (documents en URL signées valables
  5 minutes, **chaque consultation est journalisée** dans `AuditLog`,
  action `IDENTITY_DOCUMENTS_VIEWED` ; si le journal ne peut pas être écrit, les
  URL ne sont pas fournies), décision `POST /api/v1/admin/users/:id/kyc`
  (`APPROVE` | `REJECT` + motif ; ADMIN et MODERATOR). Une approbation est
  impossible sans date de naissance majeure ni document au dossier.
- Page créateur : `/creator/verification` ; back-office : `/admin/moderation/kyc`.

### Stockage

Préfixe privé `kyc/<userId>/...` du bucket média : chiffrement serveur
(SSE AES256), aucune ACL publique, `Cache-Control: private, no-store`. Le préfixe
`kyc/` doit être **exclu de tout CDN** et de toute règle de cycle de vie
automatique, et ne jamais être rendu public par une politique de bucket.

### Durée de conservation (à valider par l'avocat)

Les réseaux de cartes exigent de conserver les preuves d'âge et d'identité de
toute personne apparaissant dans les contenus, ainsi que les autorisations
signées. Proposition : **durée de vie du compte + 5 ans** après sa clôture
(ou après la dernière publication montrant le co-participant), puis suppression
des fichiers et des lignes `IdentityDocument`. Aucune suppression automatique
n'est implémentée à ce jour : les suppressions de compte / co-participant sont
des suppressions logiques qui conservent les documents. Un job de purge sera à
écrire une fois la durée validée.

## 2. Co-participants

Toute personne autre que le créateur visible dans un contenu, une story ou un live.

- API créateur : `GET/POST /api/v1/creator/co-performers`,
  `GET/PUT/DELETE /api/v1/creator/co-performers/:id` (multipart : identité légale,
  nom de scène, date de naissance 18+, e-mail, pièce d'identité, **autorisation
  signée** `releaseForm` PDF ou image, date de signature). Statut `PENDING`.
- Modération : `GET /api/v1/admin/verification/co-performers?status=PENDING`,
  `GET .../co-performers/:id` (documents signés + journal d'accès),
  `POST .../co-performers/:id/review` (`APPROVE` | `REJECT` + motif). Approbation
  impossible sans autorisation signée, sans pièce d'identité ou si mineur.
- Seuls les co-participants `VERIFIED` du créateur peuvent être associés :
  contenu (`soloContent: false` + `coPerformerIds`, au moins un), story et live
  (`coPerformerIds` facultatif).

## 3. Validation avant publication

- Publier (ou programmer) un contenu le passe en `UNDER_REVIEW`
  (`submittedForReviewAt`) : invisible des fans jusqu'à la décision.
- File : `GET /api/v1/moderation/content/queue`, détail
  `GET /api/v1/moderation/content/:id` (médias en URL signées 15 min, médias
  signalés jamais affichés, co-participants et leur statut, KYC du créateur,
  termes repérés), `POST .../approve`, `POST .../reject` (motif obligatoire,
  notifié au créateur), `POST .../rescan`. Page : `/admin/moderation/review`.
- Approbation : `PUBLISHED`, ou reste programmé (`DRAFT` + `scheduledFor`,
  publié par la tâche planifiée) si la date est future. Refus : `REJECTED` +
  `moderationNotes`, le créateur peut corriger et resoumettre.
- Un contenu publié dont les co-participants changent, ou dont le texte modifié
  contient des termes à vérifier, repasse en validation.
- `CONTENT_PREMODERATION=false` désactive la validation **en développement local
  uniquement** (ignoré si `NODE_ENV=production`).
- **Stories** : pas de validation préalable (durée de vie 24 h) ; protégées par
  le KYC, l'analyse des médias, les règles de texte et les signalements.
  **À confirmer avec CCBill** : le processeur peut exiger une validation
  préalable des stories aussi.
- **Lives** : surveillance en temps réel par l'équipe de modération (les
  modérateurs peuvent regarder tout live) ; `POST /api/v1/streaming/:id/moderation/end`
  coupe un live (ou annule un live programmé), journalisé et notifié au créateur.

### Accès à la publication

Un créateur dont `kycStatus !== 'VERIFIED'` (ou suspendu / banni) ne peut ni
publier/programmer un contenu, ni publier une story, ni créer/lancer un live :
403 « Vérifiez votre identité pour publier » (`code: KYC_REQUIRED`). Les
brouillons restent possibles.

## 4. Analyse des médias illégaux connus

`MediaScanService` (`apps/api/src/media/media-scan/`), appelé par les
traitements image / vidéo (`ContentFile.scanStatus`) et à la publication d'une
story (`Story.scanStatus`).

| Variable | Rôle |
| --- | --- |
| `MEDIA_SCAN_PROVIDER` | `none` (défaut : `SKIPPED`, avertissement en production), `http`, `thorn-safer`, `photodna` |
| `MEDIA_SCAN_API_URL` / `MEDIA_SCAN_API_KEY` | point d'accès et clé du prestataire |
| `MEDIA_SCAN_SEND_BYTES` | `true` pour envoyer les octets (base64) en plus des empreintes SHA-256 / MD5 |
| `MEDIA_SCAN_TIMEOUT_MS` | délai (15 000 ms par défaut) |

Le fournisseur HTTP est un **bouchon** (`POST {sha256, md5, mimeType, size, data?}`
→ `{match, reference?}`) : à adapter au contrat réel (Thorn Safer, Microsoft
PhotoDNA...) une fois le contrat signé. En cas d'erreur du prestataire, le média
reste `PENDING` et le contenu ne peut pas être approuvé (bouton « Relancer
l'analyse »).

En cas de correspondance (`FLAGGED`) : contenu `REJECTED` / story masquée,
média jamais servi ni supprimable par le créateur, **compte suspendu** sans date
de fin en attente d'examen, alerte à tous les admins (notification) et entrée
`AuditLog` `ILLEGAL_MEDIA_MATCH` (empreinte, clé de stockage, référence du
prestataire). **Le fichier n'est jamais supprimé automatiquement** : c'est une
preuve. La loi française impose de signaler le contenu sur **PHAROS**
(<https://www.internet-signalement.gouv.fr>) et de conserver les preuves à la
disposition des enquêteurs ; ne pas prévenir l'utilisateur du motif précis.

## 5. Règles de texte

`apps/api/src/moderation/content-rules.ts`. Le vocabulaire adulte est autorisé
(« porno », « xxx », « sexe explicite »...). Sont **bloqués** (refus du texte) :
termes évoquant des mineurs (« teen », « ado », « mineure », « lycéenne »,
« schoolgirl », « loli », « barely legal »...), l'absence de consentement
(« viol », « non consenti », « forcée »...), l'inceste, la zoophilie, l'escorting
et les rencontres réelles (« escort », « plan cul », « tarif nuit »,
« rencontre réelle »...). Les termes ambigus (« adolescence », « endormie »,
« enfants », âge déclaré < 18, « rdv »...) et les autres catégories illégales
(violence, haine, drogues) envoient le contenu en **validation** avec une note.
Correspondance sur mots entiers, texte normalisé (accents, leetspeak).
