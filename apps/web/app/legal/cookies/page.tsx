import type { Metadata } from 'next'
import Link from 'next/link'

import { LegalDocument, Ph, type LegalSection } from '@/components/legal/legal-document'
import { CNIL_URL, COMPANY, LEGAL_VERSIONS, legalPage } from '@/lib/legal'

const page = legalPage('cookies')

export const metadata: Metadata = { title: page.title }

/** Keep this list in sync with what the web app really stores (grep localStorage / sessionStorage / cookies) */
const trackers: { name: string; type: string; purpose: string; duration: string }[] = [
  {
    name: 'accessToken, refreshToken, user',
    type: 'Stockage local (localStorage)',
    purpose: 'Authentification : maintenir votre session ouverte de façon sécurisée',
    duration: 'Jusqu’à la déconnexion ; jeton de rafraîchissement valable 7 jours',
  },
  {
    name: 'ageVerificationToken, ageVerificationExpiresAt',
    type: 'Stockage local',
    purpose:
      'Mémoriser que la vérification de l’âge a réussi, pour ne pas vous la redemander à chaque page (obligation légale). Jeton anonyme signé : ne contient aucune donnée d’identité',
    duration: 'Durée de validité de la vérification',
  },
  {
    name: 'ageGateDismissed',
    type: 'Stockage de session (sessionStorage)',
    purpose: 'Ne pas réafficher l’écran d’avertissement « contenu pour adultes » pendant la visite',
    duration: 'Fermeture de l’onglet',
  },
  {
    name: 'ofm-locale',
    type: 'Stockage local',
    purpose: 'Mémoriser la langue choisie',
    duration: 'Jusqu’à suppression par vous',
  },
  {
    name: 'theme, app-storage',
    type: 'Stockage local',
    purpose: 'Mémoriser le thème (clair / sombre) et l’état de l’interface (menu latéral)',
    duration: 'Jusqu’à suppression par vous',
  },
  {
    name: 'discover-view-mode, live-viewer-quality, live-viewer-quality-livekit, live-quality-preset',
    type: 'Stockage local',
    purpose: 'Mémoriser vos préférences d’affichage et de qualité vidéo',
    duration: 'Jusqu’à suppression par vous',
  },
  {
    name: 'ofm:media-jobs',
    type: 'Stockage local',
    purpose: 'Créateurs : suivre l’avancement des fichiers en cours de traitement',
    duration: 'Jusqu’à la fin du traitement',
  },
  {
    name: 'ofm-email-banner-dismissed',
    type: 'Stockage de session (sessionStorage)',
    purpose: 'Ne plus afficher le bandeau de confirmation d’e-mail que vous avez fermé',
    duration: 'Fermeture de l’onglet',
  },
  {
    name: 'Cookies du prestataire de paiement',
    type: 'Cookies du prestataire, sur les pages de paiement',
    purpose: 'Sécuriser le paiement et prévenir la fraude à la carte bancaire',
    duration: 'Fixée par le prestataire, limitée à cette finalité',
  },
]

const sections: LegalSection[] = [
  {
    id: 'principe',
    title: 'Notre principe : aucun traceur publicitaire ni de mesure d’audience',
    content: (
      <>
        <p>
          Un « traceur » (ou « cookie ») est une information stockée sur votre appareil lorsque vous consultez un
          site : cookie, stockage local du navigateur (localStorage, sessionStorage), identifiant, etc.
          Conformément à l’article 82 de la loi n° 78-17 du 6 janvier 1978 et aux lignes directrices de la CNIL,
          les traceurs non nécessaires au service exigent votre consentement préalable.
        </p>
        <p>
          {COMPANY.brand} a fait le choix de n’utiliser <strong>que des traceurs strictement nécessaires</strong>{' '}
          au fonctionnement du service que vous demandez. Nous n’utilisons{' '}
          <strong>
            aucun cookie publicitaire, aucun outil de mesure d’audience tiers, aucun bouton de réseau social
            traceur et aucun outil d’enregistrement de session
          </strong>
          . Ces traceurs étant exemptés de consentement, aucun bandeau cookies ne vous est présenté.
        </p>
      </>
    ),
  },
  {
    id: 'liste',
    title: 'Traceurs utilisés',
    content: (
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Type</th>
              <th>Finalité</th>
              <th>Durée</th>
            </tr>
          </thead>
          <tbody>
            {trackers.map((tracker) => (
              <tr key={tracker.name}>
                <td className="break-words">{tracker.name}</td>
                <td>{tracker.type}</td>
                <td>{tracker.purpose}</td>
                <td>{tracker.duration}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  },
  {
    id: 'erreurs',
    title: 'Suivi des erreurs techniques',
    content: (
      <p>
        Pour détecter et corriger les dysfonctionnements, nous pouvons transmettre des rapports d’erreur à notre
        prestataire <Ph>[Sentry ou autre — région de stockage]</Ph>. Ce service ne dépose aucun cookie, n’enregistre
        pas votre session et est configuré pour ne transmettre ni adresse IP, ni adresse e-mail, ni contenu saisi
        ou consulté : seul un identifiant technique opaque peut être associé à l’erreur. Ce traitement repose sur
        notre intérêt légitime à assurer le bon fonctionnement du service (voir la{' '}
        <Link href="/legal/confidentialite">Politique de confidentialité</Link>).
      </p>
    ),
  },
  {
    id: 'gerer',
    title: 'Comment les gérer',
    content: (
      <>
        <p>
          Vous pouvez supprimer à tout moment les cookies et données de site depuis les paramètres de votre
          navigateur. Les traceurs étant nécessaires, leur suppression vous déconnecte, efface vos préférences et
          peut vous obliger à refaire la vérification de l’âge.
        </p>
        <p>
          Pour en savoir plus :{' '}
          <a href={CNIL_URL} target="_blank" rel="noopener noreferrer">
            www.cnil.fr
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: 'evolution',
    title: 'Évolution de cette politique',
    content: (
      <p>
        Si nous devions un jour utiliser des traceurs soumis à consentement (mesure d’audience non exemptée,
        par exemple), nous vous demanderions préalablement votre accord au moyen d’un bandeau permettant
        d’accepter ou de refuser aussi simplement, et cette page serait mise à jour.
      </p>
    ),
  },
]

export default function CookiesPage() {
  return <LegalDocument title={page.title} version={LEGAL_VERSIONS.privacy} sections={sections} />
}
