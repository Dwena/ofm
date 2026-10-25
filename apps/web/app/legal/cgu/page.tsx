import type { Metadata } from 'next'
import Link from 'next/link'

import { LegalDocument, Ph, type LegalSection } from '@/components/legal/legal-document'
import { COMPANY, LEGAL_VERSIONS, PHAROS_URL, legalPage } from '@/lib/legal'

const page = legalPage('cgu')

export const metadata: Metadata = { title: page.title }

const sections: LegalSection[] = [
  {
    id: 'objet',
    title: 'Objet et acceptation',
    content: (
      <>
        <p>
          Les présentes conditions générales d’utilisation (« CGU ») régissent l’accès et l’utilisation du site et
          des applications {COMPANY.brand} (la « Plateforme »), édités par <Ph>{COMPANY.name}</Ph>,{' '}
          <Ph>{COMPANY.legalForm}</Ph>, dont le siège est situé <Ph>{COMPANY.address}</Ph>, immatriculée sous le
          numéro <Ph>{COMPANY.registration}</Ph> (« {COMPANY.brand} », « nous »).
        </p>
        <p>
          La création d’un compte emporte l’acceptation sans réserve des présentes CGU et de la{' '}
          <Link href="/legal/confidentialite">Politique de confidentialité</Link>, matérialisée par une case à
          cocher. Les achats sont en outre régis par les{' '}
          <Link href="/legal/cgv">Conditions générales de vente</Link> (CGV), et l’activité des créateurs par les{' '}
          <Link href="/legal/conditions-createurs">Conditions créateurs</Link>. Les{' '}
          <Link href="/legal/regles-contenu">Règles de contenu</Link> font partie intégrante des présentes CGU.
        </p>
        <p>
          En cas de contradiction, les documents spécifiques (CGV, Conditions créateurs) prévalent sur les CGU
          pour les questions qu’ils traitent.
        </p>
      </>
    ),
  },
  {
    id: 'definitions',
    title: 'Définitions',
    content: (
      <ul>
        <li>
          <strong>Utilisateur</strong> : toute personne disposant d’un compte sur la Plateforme.
        </li>
        <li>
          <strong>Fan</strong> : Utilisateur qui consulte des contenus, s’abonne à des créateurs et effectue des
          achats.
        </li>
        <li>
          <strong>Créateur</strong> : Utilisateur dont l’identité a été vérifiée et qui publie des contenus,
          gratuits ou payants, dans les conditions des Conditions créateurs.
        </li>
        <li>
          <strong>Contenu</strong> : toute publication (photo, vidéo, texte, story, message, diffusion en direct,
          commentaire, image de profil, etc.) mise en ligne par un Utilisateur.
        </li>
        <li>
          <strong>Contenu pour adultes</strong> : Contenu à caractère sexuel ou érotique, y compris explicite,
          réservé aux personnes majeures ayant passé la vérification d’âge.
        </li>
        <li>
          <strong>Co-performeur</strong> : toute personne autre que le Créateur apparaissant dans un Contenu.
        </li>
      </ul>
    ),
  },
  {
    id: 'acces',
    title: 'Conditions d’accès : majorité et vérification d’âge',
    content: (
      <>
        <p>
          La Plateforme est <strong>strictement réservée aux personnes âgées de 18 ans ou plus</strong> et ayant
          la capacité juridique de contracter. En créant un compte, vous certifiez sur l’honneur avoir 18 ans ou
          plus. Toute fausse déclaration entraîne la fermeture immédiate du compte.
        </p>
        <p>
          Conformément à l’article 227-24 du Code pénal, à la loi n° 2024-449 du 21 mai 2024 visant à sécuriser et
          réguler l’espace numérique (loi SREN) et au référentiel technique de l’Arcom, l’affichage de tout
          Contenu pour adultes est subordonné à une <strong>vérification de l’âge</strong> réalisée par un
          prestataire tiers indépendant. Ce dispositif respecte le principe de « double anonymat » : le
          prestataire ne sait pas sur quel site vous vous rendez, et {COMPANY.brand} ne reçoit que le résultat
          (majeur / non majeur), jamais votre identité ni vos justificatifs. Tant que la vérification n’a pas
          abouti, les Contenus pour adultes sont masqués.
        </p>
        <p>
          Si vous constatez qu’un mineur utilise la Plateforme ou y apparaît, signalez-le immédiatement (voir la
          page <Link href="/legal/signalement">Signaler un contenu illicite</Link>).
        </p>
      </>
    ),
  },
  {
    id: 'compte',
    title: 'Création et sécurité du compte',
    content: (
      <>
        <p>
          Vous vous engagez à fournir des informations exactes et à les tenir à jour. Un seul compte est autorisé
          par personne, sauf autorisation expresse. Le nom d’utilisateur ne doit pas porter atteinte aux droits de
          tiers, usurper l’identité d’une personne ou d’une marque, ni être injurieux ou à caractère sexuel
          explicite.
        </p>
        <p>
          Vos identifiants sont personnels et confidentiels. Vous êtes responsable de toute activité réalisée
          depuis votre compte et devez nous informer sans délai de toute utilisation non autorisée. Nous vous
          recommandons d’activer la double authentification.
        </p>
        <p>
          Les images de profil et de couverture sont visibles sans vérification d’âge : elles{' '}
          <strong>ne doivent pas être explicites</strong> (pas de nudité ni d’acte sexuel).
        </p>
      </>
    ),
  },
  {
    id: 'services',
    title: 'Description des services',
    content: (
      <>
        <p>La Plateforme permet notamment :</p>
        <ul>
          <li>aux Créateurs de publier des Contenus gratuits ou réservés à leurs abonnés, des stories et des diffusions en direct ;</li>
          <li>aux Fans de s’abonner à des Créateurs (formules mensuelles ou annuelles à renouvellement automatique) ;</li>
          <li>d’acheter des Contenus à l’unité (« pay-per-view »), y compris dans les messages et pendant les lives ;</li>
          <li>d’envoyer des pourboires aux Créateurs ;</li>
          <li>d’échanger par messagerie privée entre Fans et Créateurs.</li>
        </ul>
        <p>
          Les conditions financières (prix, TVA, paiement, renouvellement, résiliation, droit de rétractation,
          remboursements) figurent dans les <Link href="/legal/cgv">CGV</Link>.
        </p>
        <p>
          <strong>Absence de rencontres physiques.</strong> La Plateforme est exclusivement un service de
          diffusion de contenus en ligne. Toute proposition, demande ou organisation de rencontre physique, de
          prestation sexuelle tarifée ou d’« escorting » est strictement interdite.
        </p>
      </>
    ),
  },
  {
    id: 'role-plateforme',
    title: 'Rôle de la Plateforme et responsabilité des Créateurs',
    content: (
      <>
        <p>
          Les Contenus sont créés et publiés par les Créateurs sous leur seule responsabilité. {COMPANY.brand} agit
          en qualité d’hébergeur et de plateforme en ligne au sens du règlement (UE) 2022/2065 sur les services
          numériques (« DSA ») et de la loi n° 2004-575 du 21 juin 2004 (LCEN). Pour les ventes aux Fans,{' '}
          {COMPANY.brand} agit en qualité de vendeur (voir les CGV).
        </p>
        <p>
          {COMPANY.brand} n’a pas d’obligation générale de surveillance des Contenus, mais met en œuvre les
          mesures de modération décrites ci-dessous et retire promptement tout Contenu illicite dont elle a
          connaissance.
        </p>
      </>
    ),
  },
  {
    id: 'regles',
    title: 'Règles de contenu et de comportement',
    content: (
      <>
        <p>
          Les Contenus pour adultes entre adultes consentants sont autorisés dans le respect de la loi et des{' '}
          <Link href="/legal/regles-contenu">Règles de contenu</Link>. Sont notamment strictement interdits :
        </p>
        <ul>
          <li>tout Contenu impliquant un mineur ou suggérant la présence d’un mineur (apparence, tenue, mise en scène, vocabulaire, jeu de rôle) ;</li>
          <li>tout Contenu non consenti, y compris la diffusion d’images intimes sans le consentement de la personne (article 226-2-1 du Code pénal) ;</li>
          <li>les montages, hypertrucages (« deepfakes ») et contenus générés représentant une personne sans son consentement, en particulier à caractère sexuel (articles 226-8 et 226-8-1 du Code pénal) ;</li>
          <li>l’inceste, la zoophilie, la nécrophilie, la violence sexuelle réelle ou simulée, l’usage de substances altérant le consentement ;</li>
          <li>la violence, la haine, le harcèlement, l’apologie du terrorisme ou de crimes ;</li>
          <li>la promotion ou la vente de drogues illicites, d’armes ou de tout produit ou service illégal ;</li>
          <li>l’escorting, la prostitution, le proxénétisme ou l’organisation de rencontres physiques ;</li>
          <li>la publication de données personnelles de tiers (adresse, téléphone, etc.) ;</li>
          <li>le spam, les arnaques, l’hameçonnage et la sollicitation de paiements en dehors de la Plateforme ;</li>
          <li>toute atteinte aux droits de propriété intellectuelle ou au droit à l’image de tiers.</li>
        </ul>
        <p>
          Il est également interdit d’enregistrer, de capturer, de télécharger ou de rediffuser les Contenus en
          dehors de la Plateforme, de contourner les mesures techniques de protection ou la vérification d’âge,
          et d’utiliser des robots ou procédés automatisés d’extraction.
        </p>
        <p>
          Lorsqu’un Créateur fait la promotion de biens ou de services contre rémunération ou avantage, il doit
          respecter la loi n° 2023-451 du 9 juin 2023 relative à l’influence commerciale (mention « Publicité » ou
          « Collaboration commerciale » claire et lisible, produits et pratiques interdits).
        </p>
      </>
    ),
  },
  {
    id: 'moderation',
    title: 'Modération des contenus',
    content: (
      <>
        <p>Pour assurer le respect de la loi et des présentes CGU, {COMPANY.brand} met en œuvre :</p>
        <ul>
          <li>
            <strong>une vérification d’identité</strong> de chaque Créateur (pièce d’identité et selfie, majorité
            vérifiée) et de chaque Co-performeur, qui doit en outre signer une autorisation de diffusion ;
          </li>
          <li>
            <strong>une modération a priori</strong> : chaque Contenu est examiné par un modérateur avant sa
            publication ;
          </li>
          <li>
            <strong>une détection automatisée</strong> par comparaison d’empreintes numériques (« hash matching »)
            avec des bases de contenus illicites connus, notamment pédocriminels ;
          </li>
          <li>
            <strong>une surveillance des diffusions en direct</strong>, qui peuvent être interrompues à tout
            moment ;
          </li>
          <li>
            <strong>un traitement des signalements</strong> des Utilisateurs et des tiers.
          </li>
        </ul>
        <p>
          Les outils automatisés servent à détecter et prioriser ; les décisions de retrait, de restriction ou de
          suspension sont prises ou validées par des personnes formées. Les Contenus manifestement illicites,
          notamment pédocriminels ou terroristes, sont retirés immédiatement, conservés pour les besoins de
          l’enquête et signalés aux autorités compétentes (plateforme{' '}
          <a href={PHAROS_URL} target="_blank" rel="noopener noreferrer">
            PHAROS
          </a>
          , et NCMEC le cas échéant). Conformément à l’article 18 du DSA, nous informons les autorités
          répressives de toute information donnant à penser qu’une infraction menaçant la vie ou la sécurité des
          personnes a été commise ou est en train d’être commise.
        </p>
      </>
    ),
  },
  {
    id: 'signalement',
    title: 'Signalement des contenus illicites',
    content: (
      <>
        <p>
          Conformément à l’article 16 du DSA, toute personne, inscrite ou non, peut nous signaler un Contenu
          qu’elle estime illicite ou contraire aux CGU :
        </p>
        <ul>
          <li>via le bouton « Signaler » présent sur chaque Contenu, profil, message et live ;</li>
          <li>
            via le formulaire et les informations de la page{' '}
            <Link href="/legal/signalement">Signaler un contenu illicite</Link> ;
          </li>
          <li>
            par courriel au point de contact unique : <Ph>{COMPANY.dsaEmail}</Ph>.
          </li>
        </ul>
        <p>
          Le signalement doit être suffisamment précis : explication des raisons pour lesquelles le Contenu est
          illicite, localisation exacte (lien), nom et adresse électronique de l’auteur (sauf pour les
          infractions relatives aux abus sexuels sur mineurs), et déclaration de bonne foi. Nous accusons
          réception, traitons le signalement avec diligence et de manière objective, et informons son auteur de
          la décision prise et des voies de recours.
        </p>
        <p>
          Les signalements émanant de <strong>signaleurs de confiance</strong> désignés en application de
          l’article 22 du DSA sont traités en priorité.
        </p>
      </>
    ),
  },
  {
    id: 'mesures',
    title: 'Mesures de modération et exposé des motifs',
    content: (
      <>
        <p>
          En cas de Contenu illicite ou contraire aux CGU, {COMPANY.brand} peut, de manière proportionnée à la
          gravité des faits : refuser ou retirer un Contenu, en restreindre la visibilité, démonétiser un Contenu
          ou un compte, suspendre ou bloquer les paiements, suspendre temporairement ou fermer définitivement un
          compte.
        </p>
        <p>
          Conformément à l’article 17 du DSA, l’Utilisateur concerné reçoit un{' '}
          <strong>exposé des motifs clair et précis</strong> indiquant la mesure prise, les faits et
          circonstances, le cas échéant le recours à des moyens automatisés, la base juridique ou contractuelle
          invoquée et les voies de recours, sauf si la loi ou une autorité s’y oppose (par exemple en cas
          d’enquête pénale).
        </p>
      </>
    ),
  },
  {
    id: 'reclamations',
    title: 'Réclamations et règlement des litiges de modération',
    content: (
      <>
        <p>
          Conformément à l’article 20 du DSA, vous pouvez contester gratuitement toute décision de modération
          (retrait ou restriction d’un Contenu, suspension ou fermeture de compte, restriction de la
          monétisation, ou rejet d’un signalement que vous avez effectué) <strong>dans un délai de six mois</strong>{' '}
          à compter de la notification de la décision, depuis le lien figurant dans la notification ou par
          courriel à <Ph>{COMPANY.dsaEmail}</Ph>. Votre réclamation est examinée par une personne qui n’a pas pris
          la décision initiale ; la décision est annulée si la réclamation est fondée.
        </p>
        <p>
          Vous pouvez également recourir à un <strong>organe de règlement extrajudiciaire des litiges</strong>{' '}
          certifié en application de l’article 21 du DSA, et conservez dans tous les cas le droit de saisir les
          juridictions compétentes. Pour les litiges de consommation liés à un achat, voir la médiation prévue aux{' '}
          <Link href="/legal/cgv">CGV</Link>.
        </p>
      </>
    ),
  },
  {
    id: 'recidive',
    title: 'Récidive et utilisation abusive',
    content: (
      <>
        <p>Conformément à l’article 23 du DSA :</p>
        <ul>
          <li>
            les comptes qui publient de manière répétée des Contenus manifestement illicites, ou qui portent
            atteinte de manière répétée aux droits de propriété intellectuelle de tiers, sont suspendus après
            avertissement, puis fermés en cas de nouvelle violation ;
          </li>
          <li>
            les personnes qui soumettent fréquemment des signalements ou des réclamations manifestement infondés
            peuvent voir le traitement de leurs signalements suspendu pour une durée raisonnable, après
            avertissement.
          </li>
        </ul>
        <p>
          Les infractions les plus graves (Contenu impliquant un mineur, Contenu non consenti, exploitation
          sexuelle) entraînent la fermeture immédiate et définitive du compte, sans avertissement préalable, et un
          signalement aux autorités. Les rejets de paiement abusifs (« chargebacks » injustifiés) peuvent
          entraîner la suspension du compte.
        </p>
      </>
    ),
  },
  {
    id: 'recommandation',
    title: 'Systèmes de recommandation et publicité',
    content: (
      <>
        <p>
          Conformément à l’article 27 du DSA, nous vous informons que l’ordre d’affichage des Créateurs et des
          Contenus (fil d’actualité, page Découvrir, recherche) repose principalement sur : vos abonnements et
          les Créateurs que vous suivez, la date de publication, la popularité (nombre d’abonnés, interactions),
          et les critères de recherche ou filtres que vous choisissez. Aucun profilage fondé sur des données
          sensibles n’est utilisé à des fins de recommandation.
        </p>
        <p>
          La Plateforme n’affiche pas de publicité de tiers ciblée. Les communications commerciales des Créateurs
          doivent être identifiées comme telles.
        </p>
      </>
    ),
  },
  {
    id: 'propriete-intellectuelle',
    title: 'Propriété intellectuelle',
    content: (
      <>
        <p>
          Les Créateurs conservent la propriété de leurs Contenus et concèdent à {COMPANY.brand} la licence
          nécessaire à leur hébergement, leur affichage et leur promotion, dans les conditions des{' '}
          <Link href="/legal/conditions-createurs">Conditions créateurs</Link>.
        </p>
        <p>
          L’accès à un Contenu, gratuit ou payant, confère au Fan un droit d’usage strictement personnel, privé et
          non exclusif, limité à la consultation sur la Plateforme, pour la durée de son abonnement ou, pour un
          achat à l’unité, tant que le Contenu et le compte existent. Toute autre utilisation est interdite.
        </p>
        <p>
          Les titulaires de droits peuvent signaler une contrefaçon selon la procédure décrite à la page{' '}
          <Link href="/legal/signalement">Signaler un contenu illicite</Link>.
        </p>
      </>
    ),
  },
  {
    id: 'donnees',
    title: 'Données personnelles',
    content: (
      <p>
        {COMPANY.brand} traite vos données personnelles conformément au règlement (UE) 2016/679 (RGPD) et à la loi
        n° 78-17 du 6 janvier 1978 « Informatique et Libertés », selon les modalités décrites dans la{' '}
        <Link href="/legal/confidentialite">Politique de confidentialité</Link>.
      </p>
    ),
  },
  {
    id: 'responsabilite',
    title: 'Disponibilité et responsabilité',
    content: (
      <>
        <p>
          Nous mettons en œuvre les moyens raisonnables pour assurer l’accès à la Plateforme, sans garantir une
          disponibilité ininterrompue. Des interruptions peuvent intervenir pour maintenance, mise à jour ou en
          cas de force majeure.
        </p>
        <p>
          {COMPANY.brand} n’est pas responsable des Contenus publiés par les Utilisateurs ni des échanges entre
          Utilisateurs, sauf si, ayant eu connaissance de leur caractère illicite, elle n’a pas agi promptement
          pour les retirer. Rien dans les présentes CGU n’exclut la responsabilité de {COMPANY.brand} lorsqu’elle
          ne peut légalement être exclue, notamment à l’égard des consommateurs.
        </p>
      </>
    ),
  },
  {
    id: 'resiliation',
    title: 'Durée, suspension et fermeture du compte',
    content: (
      <>
        <p>
          Les CGU s’appliquent pour une durée indéterminée. Vous pouvez supprimer votre compte à tout moment
          depuis « Paramètres ». La suppression met fin à vos abonnements en cours à l’échéance de la période payée
          (aucun renouvellement n’est effectué) ; les données sont ensuite supprimées ou anonymisées selon les
          durées indiquées dans la Politique de confidentialité.
        </p>
        <p>
          {COMPANY.brand} peut suspendre ou fermer un compte en cas de violation des CGU, des Règles de contenu ou
          de la loi, dans les conditions prévues aux articles « Mesures de modération » et « Récidive », avec
          notification motivée. En dehors de toute faute, {COMPANY.brand} peut mettre fin aux CGU moyennant un
          préavis de 30 jours ; les sommes correspondant à une période d’abonnement non consommée sont alors
          remboursées au prorata.
        </p>
      </>
    ),
  },
  {
    id: 'modification',
    title: 'Modification des CGU',
    content: (
      <p>
        Nous pouvons modifier les CGU, notamment pour tenir compte d’évolutions légales ou des services. Vous serez
        informé par courriel ou notification au moins 15 jours avant l’entrée en vigueur de toute modification
        substantielle, sauf obligation légale imposant un délai plus court. Il vous sera demandé d’accepter la
        nouvelle version lors de votre prochaine connexion ; à défaut, vous pouvez supprimer votre compte. La
        version en vigueur et sa date figurent en haut de cette page.
      </p>
    ),
  },
  {
    id: 'droit-applicable',
    title: 'Droit applicable et litiges',
    content: (
      <>
        <p>
          Les présentes CGU sont soumises au droit français. Si vous êtes un consommateur résidant dans un autre
          État membre de l’Union européenne, vous bénéficiez en outre des dispositions impératives de la loi de
          votre pays de résidence.
        </p>
        <p>
          En cas de litige, vous pouvez contacter notre service client à <Ph>{COMPANY.contactEmail}</Ph>. Les
          consommateurs peuvent recourir gratuitement au médiateur de la consommation : <Ph>{COMPANY.mediator}</Ph>.
          À défaut d’accord amiable, le litige sera porté devant les juridictions compétentes selon les règles de
          droit commun ; pour les Utilisateurs non consommateurs, compétence exclusive est attribuée aux tribunaux
          du ressort du siège de <Ph>{COMPANY.name}</Ph>.
        </p>
      </>
    ),
  },
  {
    id: 'contact',
    title: 'Points de contact',
    content: (
      <ul>
        <li>
          Point de contact unique pour les Utilisateurs et les autorités (articles 11 et 12 du DSA) :{' '}
          <Ph>{COMPANY.dsaEmail}</Ph>, en français ou en anglais.
        </li>
        <li>
          Service client : <Ph>{COMPANY.contactEmail}</Ph>.
        </li>
        <li>
          Données personnelles : <Ph>{COMPANY.dpoEmail}</Ph>.
        </li>
      </ul>
    ),
  },
]

export default function CguPage() {
  return <LegalDocument title={page.title} version={LEGAL_VERSIONS.terms} sections={sections} />
}
