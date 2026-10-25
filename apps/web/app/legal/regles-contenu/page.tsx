import type { Metadata } from 'next'
import Link from 'next/link'

import { LegalDocument, type LegalSection } from '@/components/legal/legal-document'
import { COMPANY, LEGAL_VERSIONS, legalPage } from '@/lib/legal'

const page = legalPage('regles-contenu')

export const metadata: Metadata = { title: page.title }

const sections: LegalSection[] = [
  {
    id: 'autorise',
    title: 'Ce qui est autorisé',
    content: (
      <>
        <p>
          {COMPANY.brand} accueille les contenus pour adultes, y compris sexuellement explicites, à condition que :
        </p>
        <ul>
          <li>toutes les personnes qui apparaissent soient <strong>majeures</strong>, identifiées et vérifiées sur la Plateforme ;</li>
          <li>toutes aient donné leur <strong>consentement</strong> libre et éclairé, par écrit, à l’enregistrement et à la diffusion ;</li>
          <li>le contenu ait été <strong>validé par un modérateur</strong> avant publication ;</li>
          <li>le contenu pour adultes ne soit visible qu’après la vérification d’âge (la Plateforme s’en charge).</li>
        </ul>
        <p>
          Les <strong>photos de profil et de couverture</strong>, visibles par tous, doivent rester non explicites :
          pas de nudité ni d’acte sexuel.
        </p>
      </>
    ),
  },
  {
    id: 'interdit',
    title: 'Ce qui est strictement interdit',
    content: (
      <>
        <h3>Mineurs</h3>
        <ul>
          <li>toute personne de moins de 18 ans, quel que soit le contenu, même non sexuel dans un contexte sexuel ;</li>
          <li>
            tout ce qui <strong>suggère un mineur</strong> : apparence, uniformes scolaires, accessoires ou décors
            enfantins, vocabulaire (« petite », « ado »…), jeux de rôle ou mises en scène évoquant un mineur, y
            compris dessins, images générées ou retouchées.
          </li>
        </ul>
        <h3>Absence de consentement</h3>
        <ul>
          <li>toute personne non vérifiée ou qui n’a pas signé d’autorisation de diffusion ;</li>
          <li>les images intimes diffusées sans l’accord de la personne (« revenge porn », article 226-2-1 du Code pénal) ;</li>
          <li>les contenus filmés à l’insu des personnes (voyeurisme, caméra cachée) ;</li>
          <li>
            les <strong>hypertrucages (« deepfakes »)</strong>, montages et contenus générés représentant une personne
            réelle sans son consentement, en particulier à caractère sexuel (articles 226-8 et 226-8-1 du Code
            pénal) ;
          </li>
          <li>les personnes endormies, inconscientes, sous l’emprise de l’alcool ou de drogues, ou dont le consentement est altéré ;</li>
          <li>la violence sexuelle ou la contrainte, réelle ou simulée (y compris jeux de rôle de viol ou d’enlèvement).</li>
        </ul>
        <h3>Autres pratiques interdites</h3>
        <ul>
          <li>l’inceste, réel ou simulé (y compris jeux de rôle familiaux) ;</li>
          <li>la zoophilie, la nécrophilie ;</li>
          <li>les excréments, le sang et les pratiques présentant un risque grave pour la santé ;</li>
          <li>la violence, la torture, l’automutilation, l’incitation au suicide ;</li>
          <li>la haine ou la discrimination, le harcèlement, les menaces, l’apologie du terrorisme ou de crimes ;</li>
          <li>la consommation, la promotion ou la vente de drogues illicites, la vente d’armes ;</li>
          <li>
            l’<strong>escorting</strong>, la prostitution, le proxénétisme et toute proposition ou organisation de{' '}
            <strong>rencontre physique</strong>, payante ou non ;
          </li>
          <li>
            la publication de <strong>données personnelles</strong> (vous concernant ou concernant des tiers) :
            adresse, téléphone, lieu de travail, plaque d’immatriculation, documents ;
          </li>
          <li>le spam, les arnaques, l’hameçonnage, les faux comptes, la vente de comptes ou d’abonnés ;</li>
          <li>les demandes de paiement en dehors de {COMPANY.brand} ;</li>
          <li>la contrefaçon : contenus d’autres créateurs, films, musiques, marques sans autorisation.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'comportement',
    title: 'Comportement entre utilisateurs',
    content: (
      <ul>
        <li>respectez les limites des autres : un refus est un refus ;</li>
        <li>n’enregistrez pas, ne capturez pas et ne rediffusez pas les contenus d’un créateur en dehors de la Plateforme ;</li>
        <li>n’essayez pas de contourner la vérification d’âge, les paiements ou les blocages ;</li>
        <li>signalez tout contenu ou comportement qui vous semble illicite ou dangereux.</li>
      </ul>
    ),
  },
  {
    id: 'publicite',
    title: 'Partenariats et publicité',
    content: (
      <p>
        Si vous êtes payé ou recevez un avantage pour promouvoir un produit ou un service, indiquez-le clairement
        (« Publicité » ou « Collaboration commerciale »), conformément à la loi n° 2023-451 du 9 juin 2023 sur
        l’influence commerciale. Certaines promotions sont interdites (chirurgie esthétique, produits financiers
        risqués, abstention thérapeutique, etc.).
      </p>
    ),
  },
  {
    id: 'controles',
    title: 'Comment nous faisons respecter ces règles',
    content: (
      <ul>
        <li>vérification d’identité de chaque créateur et de chaque co-performeur (pièce d’identité et selfie) ;</li>
        <li>examen de chaque contenu par un modérateur avant publication ;</li>
        <li>comparaison automatique des fichiers avec des bases d’images illicites connues ;</li>
        <li>surveillance des lives, qui peuvent être coupés à tout moment ;</li>
        <li>traitement de tous les signalements ;</li>
        <li>signalement des contenus illicites aux autorités (PHAROS).</li>
      </ul>
    ),
  },
  {
    id: 'sanctions',
    title: 'Sanctions',
    content: (
      <>
        <p>
          Selon la gravité : refus ou retrait du contenu, avertissement, démonétisation, suspension temporaire,
          fermeture définitive du compte. Chaque décision vous est notifiée avec ses motifs, et vous pouvez la
          contester pendant six mois.
        </p>
        <p>
          <strong>
            Tout contenu impliquant un mineur ou une personne non consentante entraîne la fermeture immédiate et
            définitive du compte et un signalement aux autorités.
          </strong>
        </p>
        <p>
          Ces règles résument les obligations prévues par les{' '}
          <Link href="/legal/cgu">Conditions générales d’utilisation</Link> et les{' '}
          <Link href="/legal/conditions-createurs">Conditions créateurs</Link>, qui font foi.
        </p>
      </>
    ),
  },
]

export default function ReglesContenuPage() {
  return (
    <LegalDocument
      title={page.title}
      version={LEGAL_VERSIONS.terms}
      intro={
        <p>
          Ces règles s’appliquent à tout ce qui est publié sur {COMPANY.brand} : posts, stories, lives, messages,
          commentaires, photos de profil. En cas de doute, ne publiez pas, et{' '}
          <Link href="/legal/signalement">signalez</Link> ce qui vous paraît problématique.
        </p>
      }
      sections={sections}
    />
  )
}
