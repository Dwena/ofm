import type { Metadata } from 'next'
import Link from 'next/link'

import { LegalDocument, Ph, type LegalSection } from '@/components/legal/legal-document'
import { COMPANY, LEGAL_VERSIONS, legalPage } from '@/lib/legal'

const page = legalPage('cgv')

export const metadata: Metadata = { title: page.title }

const sections: LegalSection[] = [
  {
    id: 'objet',
    title: 'Objet et vendeur',
    content: (
      <>
        <p>
          Les présentes conditions générales de vente (« CGV ») s’appliquent à tous les achats effectués par les
          Fans sur la Plateforme {COMPANY.brand} : abonnements, contenus à l’unité, pourboires et accès payants
          aux diffusions en direct.
        </p>
        <p>
          Le vendeur est <Ph>{COMPANY.name}</Ph>, <Ph>{COMPANY.legalForm}</Ph>, dont le siège est situé{' '}
          <Ph>{COMPANY.address}</Ph>, immatriculée sous le numéro <Ph>{COMPANY.registration}</Ph>, numéro de TVA{' '}
          <Ph>{COMPANY.vatNumber}</Ph>, joignable à <Ph>{COMPANY.contactEmail}</Ph> (« {COMPANY.brand} »).{' '}
          {COMPANY.brand} vend en son nom les accès aux contenus des Créateurs, qu’elle rémunère ensuite selon les{' '}
          <Link href="/legal/conditions-createurs">Conditions créateurs</Link>. Vous contractez donc avec{' '}
          {COMPANY.brand} et non directement avec le Créateur.
        </p>
        <p>
          Les CGV complètent les <Link href="/legal/cgu">Conditions générales d’utilisation</Link>. Elles sont
          acceptées lors de chaque commande, sont accessibles à tout moment sur cette page et peuvent être
          enregistrées ou imprimées. Les achats sont réservés aux personnes majeures agissant en qualité de
          consommateurs.
        </p>
      </>
    ),
  },
  {
    id: 'offres',
    title: 'Offres proposées',
    content: (
      <ul>
        <li>
          <strong>Abonnement</strong> à un Créateur : accès, pendant la période souscrite (mensuelle ou annuelle),
          aux contenus réservés aux abonnés de ce Créateur selon la formule choisie, et à sa messagerie lorsqu’il
          l’a ouverte.
        </li>
        <li>
          <strong>Contenu à l’unité</strong> (« pay-per-view ») : déblocage d’un contenu précis, publié sur le
          profil, envoyé en message privé ou proposé pendant un live.
        </li>
        <li>
          <strong>Pourboire</strong> : somme librement choisie versée pour soutenir un Créateur, sans contrepartie
          spécifique garantie.
        </li>
        <li>
          <strong>Live payant</strong> : accès à une diffusion en direct ou à des fonctionnalités payantes
          pendant celle-ci.
        </li>
      </ul>
    ),
  },
  {
    id: 'prix',
    title: 'Prix et TVA',
    content: (
      <>
        <p>
          Les prix sont fixés librement par chaque Créateur, hors taxes, en euros. La{' '}
          <strong>TVA applicable dans votre pays de résidence</strong> (services fournis par voie électronique à
          des consommateurs de l’Union européenne) est ajoutée lors du paiement. Le pays retenu est celui que vous
          déclarez, contrôlé au moyen d’éléments tels que le pays d’émission de votre carte ou votre adresse IP.
        </p>
        <p>
          Le <strong>prix total toutes taxes comprises</strong>, la durée de l’abonnement et sa périodicité de
          renouvellement vous sont indiqués avant la validation de la commande. Aucun frais supplémentaire n’est
          facturé par {COMPANY.brand} ; votre banque peut appliquer des frais de change ou de paiement à
          l’étranger.
        </p>
        <p>
          Un Créateur peut modifier le prix de son abonnement. Le nouveau prix ne s’applique pas à la période en
          cours ; il ne s’applique au renouvellement qu’après vous en avoir informé au préalable, ce qui vous
          laisse la possibilité de résilier avant l’échéance.
        </p>
      </>
    ),
  },
  {
    id: 'commande-paiement',
    title: 'Commande et paiement',
    content: (
      <>
        <p>
          La commande est passée en sélectionnant l’offre, en vérifiant le récapitulatif (description, prix TTC,
          durée, renouvellement), en cochant les cases requises puis en cliquant sur le bouton de paiement
          mentionnant expressément l’obligation de payer. Le contrat est conclu à la confirmation du paiement.
          Une confirmation récapitulant la commande vous est envoyée par courriel.
        </p>
        <p>
          Le paiement s’effectue par carte bancaire via un <strong>prestataire de paiement agréé</strong>{' '}
          (CCBill), qui collecte et traite vos données de carte dans un environnement sécurisé conforme à la
          norme PCI-DSS. <strong>{COMPANY.brand} ne reçoit ni ne conserve jamais votre numéro de carte</strong> :
          elle ne connaît qu’une référence de paiement, le type et les derniers chiffres de la carte. Une
          authentification forte (3-D Secure) peut vous être demandée. Le libellé apparaissant sur votre relevé
          est <Ph>[LIBELLÉ SUR LE RELEVÉ BANCAIRE]</Ph>.
        </p>
        <p>
          Une facture est disponible dans votre espace « Paiements ». En cas d’échec du paiement, la commande
          n’est pas validée et l’accès n’est pas ouvert.
        </p>
      </>
    ),
  },
  {
    id: 'abonnements',
    title: 'Abonnements : renouvellement et résiliation',
    content: (
      <>
        <h3>Renouvellement automatique</h3>
        <p>
          Sauf résiliation, l’abonnement est <strong>renouvelé automatiquement</strong> à chaque échéance pour une
          période de même durée, au prix alors en vigueur, et le montant est prélevé sur la carte enregistrée. Le
          récapitulatif de commande et le courriel de confirmation rappellent la date du prochain
          renouvellement. Pour les abonnements annuels, vous êtes informé par courriel, au plus tôt trois mois et
          au plus tard un mois avant l’échéance, de la possibilité de ne pas reconduire le contrat, conformément
          à l’article L215-1 du Code de la consommation.
        </p>
        <h3>Résiliation en quelques clics</h3>
        <p>
          Vous pouvez résilier à tout moment, sans frais ni justification, depuis la page{' '}
          <strong>« Mes abonnements »</strong>, au moyen de la fonctionnalité de résiliation directement
          accessible prévue à l’article L215-1-1 du Code de la consommation (loi n° 2022-1158 du 16 août 2022). Un
          accusé de réception de la résiliation vous est adressé par courriel. La résiliation prend effet à la fin
          de la période en cours : <strong>vous conservez l’accès jusqu’à cette date</strong> et aucun nouveau
          prélèvement n’est effectué. La période en cours n’est pas remboursée, sauf dans les cas prévus à
          l’article « Remboursements ».
        </p>
        <h3>Échec du renouvellement</h3>
        <p>
          Si le prélèvement échoue, de nouvelles tentatives peuvent être effectuées pendant quelques jours ; à
          défaut de paiement, l’abonnement prend fin et l’accès aux contenus réservés est suspendu.
        </p>
        <h3>Fin de l’abonnement à l’initiative du Créateur ou de {COMPANY.brand}</h3>
        <p>
          Si le compte du Créateur est fermé ou si le Créateur cesse son activité, votre abonnement n’est plus
          renouvelé. Si la période en cours ne peut plus être exécutée du fait d’une fermeture décidée par{' '}
          {COMPANY.brand} pour un motif ne vous étant pas imputable, la part non consommée vous est remboursée au
          prorata.
        </p>
      </>
    ),
  },
  {
    id: 'acces-contenus',
    title: 'Accès aux contenus achetés',
    content: (
      <>
        <p>
          Les contenus sont accessibles immédiatement après le paiement, en ligne uniquement, depuis votre compte
          et après vérification de votre âge pour les contenus pour adultes. Ils ne sont pas téléchargeables.
          L’accès est personnel : il ne peut être partagé, cédé ou revendu.
        </p>
        <p>
          Un contenu acheté à l’unité reste accessible tant que votre compte et le contenu existent sur la
          Plateforme. Les contenus peuvent être retirés par leur Créateur ou par {COMPANY.brand} lorsqu’ils sont
          illicites ou contraires aux règles de la Plateforme.
        </p>
      </>
    ),
  },
  {
    id: 'retractation',
    title: 'Droit de rétractation',
    content: (
      <>
        <p>
          Le consommateur dispose en principe d’un délai de 14 jours pour se rétracter d’un contrat conclu à
          distance (article L221-18 du Code de la consommation). Toutefois, conformément à l’article{' '}
          <strong>L221-28, 13°</strong> du Code de la consommation, ce droit ne peut être exercé pour la fourniture
          d’un contenu numérique non fourni sur un support matériel dont l’exécution a commencé après accord
          préalable exprès du consommateur et renoncement exprès à son droit de rétractation.
        </p>
        <p>
          Les contenus étant mis à disposition immédiatement, il vous est demandé lors de chaque commande, au
          moyen d’une case à cocher, de{' '}
          <strong>
            demander expressément l’accès immédiat au contenu et de reconnaître perdre ainsi votre droit de
            rétractation
          </strong>
          . Cet accord vous est confirmé dans le courriel de confirmation de commande (article L221-13 du Code de
          la consommation). Sans cet accord, la commande ne peut être passée.
        </p>
        <p>
          Les pourboires, versés pour un service intégralement exécuté dès leur paiement, ne donnent pas lieu à
          rétractation (article L221-28, 1°).
        </p>
      </>
    ),
  },
  {
    id: 'garanties',
    title: 'Garanties légales',
    content: (
      <p>
        Vous bénéficiez de la garantie légale de conformité des contenus et services numériques prévue aux
        articles L224-25-12 et suivants du Code de la consommation. En cas de défaut de conformité (contenu
        inaccessible, illisible, ne correspondant manifestement pas à sa description), vous pouvez obtenir la mise
        en conformité du contenu ou, à défaut, une réduction du prix ou le remboursement, en contactant le service
        client.
      </p>
    ),
  },
  {
    id: 'remboursements',
    title: 'Remboursements',
    content: (
      <>
        <p>Vous pouvez obtenir le remboursement, total ou partiel, notamment en cas :</p>
        <ul>
          <li>de défaillance technique vous ayant empêché d’accéder à un contenu payé, à laquelle nous n’avons pas pu remédier ;</li>
          <li>de contenu payé non délivré ou ne correspondant manifestement pas à sa description ;</li>
          <li>de double prélèvement ou d’erreur de facturation ;</li>
          <li>d’utilisation frauduleuse de votre moyen de paiement, sur justificatif.</li>
        </ul>
        <p>
          La demande est à adresser au service client (<Ph>{COMPANY.contactEmail}</Ph>) en précisant la
          transaction concernée, de préférence dans les 30 jours suivant le paiement. Le remboursement est
          effectué sur le moyen de paiement utilisé, dans un délai de 14 jours à compter de l’acceptation de la
          demande, et l’accès au contenu remboursé est retiré.
        </p>
        <p>
          Nous vous invitons à contacter le service client avant toute contestation auprès de votre banque. Les
          contestations de paiement (« chargebacks ») injustifiées ou abusives, notamment après consultation du
          contenu, peuvent entraîner la suspension du compte et des achats.
        </p>
      </>
    ),
  },
  {
    id: 'service-client',
    title: 'Service client et réclamations',
    content: (
      <p>
        Pour toute question ou réclamation : <Ph>{COMPANY.contactEmail}</Ph> ou <Ph>{COMPANY.address}</Ph>. Nous
        nous efforçons de répondre sous 72 heures ouvrées.
      </p>
    ),
  },
  {
    id: 'mediation',
    title: 'Médiation de la consommation',
    content: (
      <>
        <p>
          Conformément aux articles L611-1 et L612-1 du Code de la consommation, en cas de litige non résolu
          après une réclamation écrite préalable auprès de notre service client, vous pouvez recourir gratuitement
          au médiateur de la consommation dont nous relevons : <Ph>{COMPANY.mediator}</Ph>. La saisine doit
          intervenir dans un délai d’un an à compter de votre réclamation écrite.
        </p>
      </>
    ),
  },
  {
    id: 'donnees',
    title: 'Données personnelles',
    content: (
      <p>
        Les données nécessaires à la commande et au paiement sont traitées conformément à la{' '}
        <Link href="/legal/confidentialite">Politique de confidentialité</Link>. Les factures et pièces comptables
        sont conservées dix ans (article L123-22 du Code de commerce).
      </p>
    ),
  },
  {
    id: 'droit-applicable',
    title: 'Droit applicable et juridiction',
    content: (
      <p>
        Les CGV sont soumises au droit français, sans préjudice des dispositions impératives plus protectrices de
        la loi de votre pays de résidence habituelle au sein de l’Union européenne. À défaut de résolution amiable
        ou de médiation, le consommateur peut saisir, à son choix, la juridiction du lieu où il demeurait au moment
        de la conclusion du contrat ou de la survenance du fait dommageable, ou toute autre juridiction compétente
        (article R631-3 du Code de la consommation).
      </p>
    ),
  },
]

export default function CgvPage() {
  return <LegalDocument title={page.title} version={LEGAL_VERSIONS.cgv} sections={sections} />
}
