import type { Metadata } from 'next'
import Link from 'next/link'

import { LegalDocument, Ph, type LegalSection } from '@/components/legal/legal-document'
import { COMPANY, LEGAL_VERSIONS, legalPage } from '@/lib/legal'

const page = legalPage('conditions-createurs')

export const metadata: Metadata = { title: page.title }

const sections: LegalSection[] = [
  {
    id: 'objet',
    title: 'Objet et acceptation',
    content: (
      <>
        <p>
          Les présentes conditions créateurs (« Conditions créateurs ») régissent la relation entre{' '}
          <Ph>{COMPANY.name}</Ph> (« {COMPANY.brand} ») et toute personne qui publie et monétise des contenus sur
          la Plateforme (le « Créateur »). Elles complètent les{' '}
          <Link href="/legal/cgu">Conditions générales d’utilisation</Link> et les{' '}
          <Link href="/legal/regles-contenu">Règles de contenu</Link>, qui s’appliquent intégralement au Créateur.
        </p>
        <p>
          Elles sont acceptées par une case à cocher lors de l’inscription en tant que Créateur, et incluent le{' '}
          <strong>mandat d’autofacturation</strong> décrit à l’article 9. Elles constituent les conditions
          générales au sens du règlement (UE) 2019/1150 promouvant l’équité et la transparence pour les
          entreprises utilisatrices de services d’intermédiation en ligne (« règlement P2B »).
        </p>
      </>
    ),
  },
  {
    id: 'statut',
    title: 'Statut du Créateur',
    content: (
      <p>
        Le Créateur exerce son activité de manière indépendante, en son nom et pour son compte. Aucun lien de
        subordination, contrat de travail, mandat social ou société n’existe entre le Créateur et {COMPANY.brand}.
        Le Créateur choisit librement ses contenus, ses prix et son organisation, dans le respect de la loi et des
        règles de la Plateforme. Il lui appartient de disposer du statut juridique, fiscal et social adapté à son
        activité (par exemple micro-entrepreneur).
      </p>
    ),
  },
  {
    id: 'verification',
    title: 'Vérification d’identité (KYC)',
    content: (
      <>
        <p>Avant de pouvoir publier des contenus payants et recevoir des paiements, le Créateur doit :</p>
        <ul>
          <li>être âgé de <strong>18 ans au moins</strong> ;</li>
          <li>
            faire vérifier son identité en transmettant une pièce d’identité officielle en cours de validité et un
            selfie permettant de la rapprocher de son visage ;
          </li>
          <li>compléter son profil fiscal et bancaire (article 11) ;</li>
          <li>accepter les présentes Conditions créateurs.</li>
        </ul>
        <p>
          Les documents sont examinés par du personnel habilité de {COMPANY.brand} ou de son prestataire. La
          vérification peut être refusée, notamment en cas de document illisible, falsifié ou ne correspondant
          pas au titulaire du compte. {COMPANY.brand} peut demander une nouvelle vérification à tout moment, en
          particulier en cas de doute ou de changement de situation. Le compte d’un Créateur est strictement
          personnel : il ne peut être utilisé par une autre personne, ni géré par un tiers qui en publierait les
          contenus à la place du Créateur sans que ce dernier reste identifié et responsable.
        </p>
      </>
    ),
  },
  {
    id: 'co-performeurs',
    title: 'Co-performeurs',
    content: (
      <>
        <p>Toute personne autre que le Créateur apparaissant dans un contenu (« Co-performeur ») doit, avant publication :</p>
        <ul>
          <li>être âgée de 18 ans au moins et avoir fait vérifier son identité sur la Plateforme (pièce d’identité et selfie) ;</li>
          <li>
            avoir signé une <strong>autorisation de diffusion</strong> attestant son consentement libre et
            éclairé à l’enregistrement du contenu et à sa diffusion sur la Plateforme, à titre payant ;
          </li>
          <li>être identifiée (« taguée ») sur le contenu concerné.</li>
        </ul>
        <p>
          Tout contenu faisant apparaître une personne non vérifiée est refusé. Le Créateur conserve une copie des
          autorisations et les produit sur demande de {COMPANY.brand} ou d’une autorité. Si un Co-performeur
          retire son consentement ou signale une diffusion non consentie, le contenu est retiré dans l’attente de
          l’examen du dossier.
        </p>
      </>
    ),
  },
  {
    id: 'contenus',
    title: 'Obligations relatives aux contenus',
    content: (
      <>
        <p>Le Créateur s’engage à :</p>
        <ul>
          <li>
            ne publier que des contenus conformes à la loi, aux CGU et aux{' '}
            <Link href="/legal/regles-contenu">Règles de contenu</Link>, mettant en scène exclusivement des
            adultes consentants ;
          </li>
          <li>ne pas utiliser d’image ou de photo de profil et de couverture explicite ;</li>
          <li>
            accepter l’examen de chaque contenu par un modérateur avant sa publication, la comparaison
            automatisée de ses fichiers avec des bases de contenus illicites, et la surveillance de ses lives ;
          </li>
          <li>
            décrire honnêtement les contenus vendus (notamment à l’unité) et livrer ce qui a été annoncé ;
          </li>
          <li>
            ne pas solliciter de paiement en dehors de la Plateforme, ne pas proposer de rencontre physique ni de
            prestation sexuelle tarifée ;
          </li>
          <li>
            respecter, lorsqu’il promeut des biens ou services contre rémunération ou avantage, la loi
            n° 2023-451 du 9 juin 2023 visant à encadrer l’influence commerciale (mention « Publicité » ou
            « Collaboration commerciale », produits et pratiques interdits ou encadrés).
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'licence',
    title: 'Propriété des contenus et licence',
    content: (
      <>
        <p>
          Le Créateur <strong>reste propriétaire</strong> de ses contenus et des droits qui y sont attachés. Il
          concède à {COMPANY.brand}, pour le monde entier, à titre non exclusif et gratuit, pour la durée
          d’hébergement des contenus sur la Plateforme, le droit :
        </p>
        <ul>
          <li>de les héberger, stocker, reproduire et adapter techniquement (transcodage, redimensionnement, miniatures, floutage d’aperçus, filigrane) ;</li>
          <li>de les représenter et mettre à disposition des Fans qui y ont accès, sur tous les supports de la Plateforme (site, applications) ;</li>
          <li>
            de les utiliser, sous forme d’extraits ou d’aperçus non explicites, pour promouvoir le profil du
            Créateur au sein de la Plateforme ; toute utilisation promotionnelle en dehors de la Plateforme
            requiert l’accord préalable du Créateur.
          </li>
        </ul>
        <p>
          La licence prend fin à la suppression du contenu ou du compte, sous réserve du délai technique
          d’effacement des sauvegardes, des contenus déjà achetés à l’unité qui restent accessibles aux Fans
          concernés jusqu’à la fermeture du compte du Créateur, et des conservations imposées par la loi ou
          nécessaires à la preuve (notamment en cas de signalement ou d’enquête).
        </p>
      </>
    ),
  },
  {
    id: 'garanties',
    title: 'Garanties du Créateur',
    content: (
      <>
        <p>Le Créateur déclare et garantit :</p>
        <ul>
          <li>détenir l’ensemble des droits de propriété intellectuelle nécessaires sur ses contenus (images, vidéos, musiques, marques, etc.) ;</li>
          <li>
            avoir obtenu le consentement écrit, libre et éclairé, et l’autorisation de diffusion de toute personne
            apparaissant dans ses contenus, toutes majeures et vérifiées ;
          </li>
          <li>que ses contenus ne portent atteinte ni à la vie privée, ni au droit à l’image, ni à aucun droit de tiers ;</li>
          <li>que les informations fournies (identité, fiscalité, coordonnées bancaires) sont exactes et à jour.</li>
        </ul>
        <p>
          Le Créateur garantit {COMPANY.brand} contre toute réclamation, action ou condamnation fondée sur ses
          contenus ou sur la violation des présentes garanties, et l’indemnise des frais raisonnables qui en
          résultent, dans les limites prévues par la loi.
        </p>
      </>
    ),
  },
  {
    id: 'remuneration',
    title: 'Prix, commission et rémunération',
    content: (
      <>
        <p>
          Le Créateur fixe librement, hors taxes, le prix de ses abonnements et de ses contenus à l’unité, dans
          les limites minimales et maximales indiquées sur la Plateforme. {COMPANY.brand} vend ces accès aux Fans
          en son nom, ajoute la TVA due dans le pays du Fan, encaisse le paiement par l’intermédiaire de son
          prestataire de paiement et reverse la TVA à l’administration.
        </p>
        <p>
          En rémunération de ses services (hébergement, paiement, modération, vérification d’âge, support),{' '}
          {COMPANY.brand} perçoit une commission égale à{' '}
          <strong>la commission en vigueur, actuellement de 15 % du prix hors taxes</strong>. Le Créateur perçoit
          le solde, soit actuellement 85 % du prix hors taxes de chaque vente, abonnement renouvelé, contenu à
          l’unité ou pourboire. Le taux de commission en vigueur est affiché dans l’espace Créateur ; toute
          modification est notifiée au moins 15 jours à l’avance et ne s’applique qu’aux ventes postérieures.
        </p>
        <p>
          La part du Créateur correspond à une prestation qu’il facture à {COMPANY.brand} (voir l’article 9). Si
          le Créateur est assujetti à la TVA et n’est pas en franchise en base (article 293 B du Code général des
          impôts), la TVA applicable s’ajoute à sa part ; il en informe {COMPANY.brand} dans son profil fiscal.
        </p>
      </>
    ),
  },
  {
    id: 'autofacturation',
    title: 'Mandat d’autofacturation',
    content: (
      <>
        <p>
          Conformément à l’article 289, I-2 du Code général des impôts, le Créateur donne mandat à{' '}
          {COMPANY.brand}, qui l’accepte, d’<strong>établir en son nom et pour son compte</strong> les factures
          correspondant à la part qui lui revient sur les ventes réalisées par l’intermédiaire de la Plateforme.
          Ce mandat est consenti pour la durée des présentes Conditions créateurs.
        </p>
        <ul>
          <li>
            Les factures sont émises périodiquement (au moins mensuellement), numérotées selon une séquence
            propre, portent la mention « Autofacturation » et toutes les mentions obligatoires, sur la base des
            informations fiscales fournies par le Créateur (dont son régime de TVA).
          </li>
          <li>
            Chaque facture est mise à disposition du Créateur dans son espace. Le Créateur dispose d’un délai de{' '}
            <strong>30 jours</strong> pour la contester ; à défaut, elle est réputée acceptée. En cas de
            contestation fondée, {COMPANY.brand} émet une facture rectificative.
          </li>
          <li>
            Le Créateur reste seul responsable de ses obligations en matière de facturation et de TVA, notamment
            du reversement de la TVA mentionnée sur les factures émises en son nom. Il informe sans délai{' '}
            {COMPANY.brand} de tout changement de sa situation (immatriculation, régime de TVA, coordonnées).
          </li>
          <li>
            Le Créateur s’engage à ne pas émettre lui-même de factures pour les mêmes opérations.
          </li>
        </ul>
        <p>
          Les modalités d’émission évolueront avec la généralisation de la facturation électronique (réception
          obligatoire depuis le 1<sup>er</sup> septembre 2026, émission progressive à compter de septembre 2027 selon
          la taille des entreprises).
        </p>
      </>
    ),
  },
  {
    id: 'solde-virements',
    title: 'Solde, période de rétention et virements',
    content: (
      <>
        <p>
          La part du Créateur sur chaque vente est créditée sur son <strong>solde</strong>, visible dans son
          espace. Elle devient disponible à l’issue d’une{' '}
          <strong>période de rétention de 7 jours</strong> suivant la vente, destinée à couvrir les
          remboursements et contestations de paiement.
        </p>
        <p>
          Le solde disponible est versé par <strong>virement SEPA, chaque semaine</strong>, sur le compte bancaire
          (IBAN) au nom du Créateur renseigné dans son profil, dès qu’il atteint le{' '}
          <strong>montant minimum de versement (50 € par défaut)</strong>. En deçà, il est reporté à la semaine
          suivante. {COMPANY.brand} ne facture pas de frais de virement SEPA ; les frais éventuels de la banque du
          Créateur restent à sa charge.
        </p>
        <p>
          Lorsqu’un Fan est remboursé ou qu’un paiement fait l’objet d’une contestation (« chargeback »), la part
          correspondante du Créateur est <strong>déduite de son solde</strong>, y compris si la vente est
          antérieure à la période de rétention. Si la contestation est finalement rejetée en faveur de{' '}
          {COMPANY.brand}, la part est recréditée. Un solde négatif est imputé sur les gains futurs ; à la
          fermeture du compte, il est exigible.
        </p>
        <p>
          Les versements peuvent être suspendus tant que la vérification d’identité ou le profil fiscal est
          incomplet, en cas de suspicion de fraude ou de contenu illicite (pendant la durée de l’examen), ou sur
          réquisition d’une autorité. Les sommes provenant de ventes de contenus illicites ou frauduleuses peuvent
          être remboursées aux Fans concernés et ne sont alors pas dues au Créateur.
        </p>
      </>
    ),
  },
  {
    id: 'fiscalite',
    title: 'Obligations fiscales et sociales, déclaration DAC7',
    content: (
      <>
        <p>
          Le Créateur doit compléter son <strong>profil fiscal</strong> : nom et prénom (ou dénomination et
          numéro d’immatriculation pour une société), date de naissance, adresse de résidence, numéro
          d’identification fiscale (NIF) et, le cas échéant, numéro de TVA, ainsi que l’IBAN du compte de
          versement. Ces informations sont exigées par la directive (UE) 2021/514 (« DAC7 ») et les articles 242
          bis et 1649 ter A et suivants du Code général des impôts. À défaut de les fournir après deux relances,
          les versements sont suspendus et le compte peut être fermé.
        </p>
        <p>
          Chaque année, avant le 31 janvier, {COMPANY.brand} <strong>déclare à l’administration fiscale</strong>{' '}
          française les informations relatives au Créateur et aux sommes qu’il a perçues au cours de l’année
          précédente (montant brut par trimestre, nombre de transactions, commissions retenues), et adresse au
          Créateur un <strong>relevé annuel</strong> récapitulant ces informations. Ces données peuvent être
          échangées avec les administrations fiscales des autres États membres de l’Union.
        </p>
        <p>
          Le Créateur est <strong>seul responsable</strong> de la déclaration de ses revenus, du paiement des
          impôts et des cotisations sociales correspondants (notamment auprès de l’URSSAF) et, le cas échéant, de
          la TVA. Des informations sont disponibles sur{' '}
          <a href="https://www.impots.gouv.fr" target="_blank" rel="noopener noreferrer">
            impots.gouv.fr
          </a>{' '}
          et{' '}
          <a href="https://www.urssaf.fr" target="_blank" rel="noopener noreferrer">
            urssaf.fr
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: 'moderation',
    title: 'Modération, suspension et transparence',
    content: (
      <>
        <p>
          Les mesures de modération (refus ou retrait de contenu, restriction, démonétisation, suspension,
          fermeture) sont prises dans les conditions des CGU. Conformément à l’article 4 du règlement P2B et à
          l’article 17 du DSA, toute restriction ou suspension est accompagnée d’un exposé des motifs, au plus
          tard au moment où elle prend effet. La fermeture définitive du compte d’un Créateur est notifiée au
          moins <strong>30 jours</strong> à l’avance, sauf obligation légale, violation répétée des règles ou
          infraction grave (notamment contenu impliquant un mineur, contenu non consenti, fraude), auquel cas
          elle est immédiate.
        </p>
        <p>
          Le Créateur peut contester toute décision par le système interne de traitement des réclamations
          décrit dans les CGU (délai de six mois). Conformément à l’article 12 du règlement P2B, {COMPANY.brand}{' '}
          désigne les médiateurs suivants pour les litiges avec les Créateurs : <Ph>[MÉDIATEURS P2B : noms, sites]</Ph>.
        </p>
        <p>
          Les principaux paramètres de classement des profils et contenus sont décrits dans les CGU (article
          « Systèmes de recommandation »). Aucun traitement différencié n’est accordé contre rémunération.
        </p>
      </>
    ),
  },
  {
    id: 'donnees',
    title: 'Données personnelles',
    content: (
      <p>
        Les documents d’identité, selfies, autorisations de diffusion et données fiscales et bancaires du Créateur
        et des Co-performeurs sont traités pour satisfaire aux obligations légales de {COMPANY.brand} et assurer la
        sécurité de la Plateforme, dans les conditions décrites dans la{' '}
        <Link href="/legal/confidentialite">Politique de confidentialité</Link>. Le Créateur s’engage à traiter
        les données des Fans auxquelles il a accès (pseudonyme, messages) uniquement pour les besoins de la
        Plateforme, et à ne pas les collecter ni les exporter.
      </p>
    ),
  },
  {
    id: 'duree',
    title: 'Durée et résiliation',
    content: (
      <>
        <p>
          Les Conditions créateurs sont conclues pour une durée indéterminée. Le Créateur peut y mettre fin à tout
          moment en fermant son compte Créateur. Les abonnements en cours ne sont plus renouvelés et les Fans
          conservent l’accès jusqu’à la fin de la période payée. Le solde restant est versé à l’issue de la
          période de rétention et après expiration des délais de contestation des derniers paiements, sous
          déduction des remboursements et contestations éventuels.
        </p>
        <p>
          Les articles relatifs aux garanties, à la fiscalité, à l’autofacturation (pour les opérations
          antérieures) et à la conservation des données survivent à la résiliation.
        </p>
      </>
    ),
  },
  {
    id: 'modification',
    title: 'Modification des Conditions créateurs',
    content: (
      <p>
        Toute modification est notifiée au Créateur sur un support durable au moins <strong>15 jours</strong> avant
        son entrée en vigueur (article 3 du règlement P2B), ce délai pouvant être allongé lorsque les
        modifications nécessitent des adaptations importantes. Le Créateur peut résilier avant l’entrée en
        vigueur. Une nouvelle acceptation lui est demandée lors de sa prochaine connexion.
      </p>
    ),
  },
  {
    id: 'droit-applicable',
    title: 'Droit applicable et juridiction',
    content: (
      <p>
        Les présentes sont soumises au droit français. À défaut de résolution amiable ou de médiation, tout litige
        relève des tribunaux compétents du ressort du siège de <Ph>{COMPANY.name}</Ph>, sauf disposition légale
        impérative contraire.
      </p>
    ),
  },
]

export default function ConditionsCreateursPage() {
  return <LegalDocument title={page.title} version={LEGAL_VERSIONS.creator_terms} sections={sections} />
}
