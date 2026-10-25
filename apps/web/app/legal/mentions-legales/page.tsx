import type { Metadata } from 'next'
import Link from 'next/link'

import { LegalDocument, Ph, type LegalSection } from '@/components/legal/legal-document'
import { COMPANY, LEGAL_VERSIONS, PHAROS_URL, legalPage } from '@/lib/legal'

const page = legalPage('mentions-legales')

export const metadata: Metadata = { title: page.title }

const sections: LegalSection[] = [
  {
    id: 'editeur',
    title: 'Éditeur du site',
    content: (
      <>
        <p>
          Le site et l’application {COMPANY.brand} (ci-après « la Plateforme ») sont édités par :
        </p>
        <ul>
          <li>
            Raison sociale : <Ph>{COMPANY.name}</Ph>
          </li>
          <li>
            Forme juridique et capital social : <Ph>{COMPANY.legalForm}</Ph>
          </li>
          <li>
            Siège social : <Ph>{COMPANY.address}</Ph>
          </li>
          <li>
            Immatriculation : <Ph>{COMPANY.registration}</Ph>
          </li>
          <li>
            Numéro de TVA intracommunautaire : <Ph>{COMPANY.vatNumber}</Ph>
          </li>
          <li>
            Adresse électronique : <Ph>{COMPANY.contactEmail}</Ph>
          </li>
        </ul>
        <p>
          Ces informations sont fournies en application de la loi n° 2004-575 du 21 juin 2004 pour la confiance
          dans l’économie numérique (LCEN) et des articles L111-1 et suivants du Code de la consommation.
        </p>
      </>
    ),
  },
  {
    id: 'directeur-publication',
    title: 'Directeur de la publication',
    content: (
      <p>
        Le directeur de la publication est <Ph>{COMPANY.publicationDirector}</Ph>, en sa qualité de représentant
        légal de <Ph>{COMPANY.name}</Ph>. Les contenus publiés par les créateurs le sont sous leur propre
        responsabilité ; {COMPANY.brand} agit à leur égard en qualité d’hébergeur au sens de la LCEN et de
        fournisseur de plateforme en ligne au sens du règlement (UE) 2022/2065 sur les services numériques (DSA).
      </p>
    ),
  },
  {
    id: 'hebergeur',
    title: 'Hébergement',
    content: (
      <p>
        La Plateforme est hébergée par : <Ph>{COMPANY.host}</Ph>.
      </p>
    ),
  },
  {
    id: 'acces-majeurs',
    title: 'Accès réservé aux personnes majeures',
    content: (
      <>
        <p>
          La Plateforme peut héberger des contenus à caractère sexuel entre adultes consentants. Elle est
          strictement réservée aux personnes âgées de 18 ans ou plus. Conformément à l’article 227-24 du Code pénal,
          à la loi n° 2024-449 du 21 mai 2024 visant à sécuriser et réguler l’espace numérique (loi SREN) et au
          référentiel technique de l’Arcom, l’accès aux contenus pour adultes est subordonné à une vérification de l’âge
          réalisée par un prestataire indépendant, selon un procédé respectueux de la vie privée (« double
          anonymat ») : {COMPANY.brand} ne reçoit que le résultat de la vérification, jamais votre identité.
        </p>
      </>
    ),
  },
  {
    id: 'contact',
    title: 'Contact et signalement',
    content: (
      <>
        <p>
          Pour toute question : <Ph>{COMPANY.contactEmail}</Ph>.
        </p>
        <p>
          Pour signaler un contenu illicite, utilisez le bouton « Signaler » présent sur chaque contenu, profil et
          message, ou consultez la page <Link href="/legal/signalement">Signaler un contenu illicite</Link>, qui
          indique également notre point de contact unique au titre du DSA. Vous pouvez aussi signaler un contenu
          illicite aux autorités via la plateforme PHAROS :{' '}
          <a href={PHAROS_URL} target="_blank" rel="noopener noreferrer">
            internet-signalement.gouv.fr
          </a>
          .
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
          La marque {COMPANY.brand}, le logo, la charte graphique, les textes, logiciels et bases de données de la
          Plateforme sont la propriété de <Ph>{COMPANY.name}</Ph> ou de ses concédants. Toute reproduction ou
          représentation, totale ou partielle, sans autorisation écrite préalable est interdite et constitue une
          contrefaçon sanctionnée par les articles L335-2 et suivants du Code de la propriété intellectuelle.
        </p>
        <p>
          Les contenus publiés par les créateurs restent leur propriété. Leur copie, enregistrement, capture ou
          rediffusion en dehors de la Plateforme est interdit (voir les{' '}
          <Link href="/legal/cgu">Conditions générales d’utilisation</Link>).
        </p>
      </>
    ),
  },
  {
    id: 'donnees-personnelles',
    title: 'Données personnelles et cookies',
    content: (
      <p>
        Le traitement de vos données personnelles est décrit dans la{' '}
        <Link href="/legal/confidentialite">Politique de confidentialité</Link>, et l’usage des cookies et autres
        traceurs dans la <Link href="/legal/cookies">Politique cookies</Link>.
      </p>
    ),
  },
  {
    id: 'mediation',
    title: 'Médiation de la consommation',
    content: (
      <p>
        Conformément aux articles L611-1 et suivants du Code de la consommation, tout consommateur peut recourir
        gratuitement au médiateur de la consommation suivant, après avoir tenté de résoudre le litige directement
        auprès de notre service client : <Ph>{COMPANY.mediator}</Ph>. Les modalités sont détaillées dans les{' '}
        <Link href="/legal/cgv">Conditions générales de vente</Link>.
      </p>
    ),
  },
]

export default function MentionsLegalesPage() {
  return <LegalDocument title={page.title} version={LEGAL_VERSIONS.terms} sections={sections} />
}
