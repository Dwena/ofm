import type { Metadata } from 'next'
import Link from 'next/link'

import { LegalDocument, Ph, type LegalSection } from '@/components/legal/legal-document'
import { ALLO_119_URL, COMPANY, E_ENFANCE_URL, LEGAL_VERSIONS, PHAROS_URL, legalPage } from '@/lib/legal'

const page = legalPage('signalement')

export const metadata: Metadata = { title: page.title }

const sections: LegalSection[] = [
  {
    id: 'urgence',
    title: 'En cas d’urgence',
    content: (
      <>
        <p>
          Si une personne est en danger immédiat, appelez le <strong>17</strong> (police / gendarmerie) ou le{' '}
          <strong>112</strong> (numéro d’urgence européen).
        </p>
        <ul>
          <li>
            Enfant ou adolescent en danger : <strong>119</strong> – Allô Enfance en danger (gratuit, 24 h/24) –{' '}
            <a href={ALLO_119_URL} target="_blank" rel="noopener noreferrer">
              allo119.gouv.fr
            </a>
            .
          </li>
          <li>
            Mineur victime de violences numériques (harcèlement, diffusion d’images intimes, chantage) :{' '}
            <strong>3018</strong> – association e-Enfance (gratuit, anonyme) –{' '}
            <a href={E_ENFANCE_URL} target="_blank" rel="noopener noreferrer">
              e-enfance.org
            </a>
            .
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'sur-la-plateforme',
    title: 'Signaler sur la Plateforme',
    content: (
      <>
        <p>
          Le moyen le plus rapide : le bouton <strong>« Signaler »</strong> présent sur chaque publication,
          profil, message, story et live. Indiquez le motif et, si possible, quelques précisions.
        </p>
        <p>
          Les signalements concernant un mineur, un contenu non consenti ou un contenu pédocriminel sont traités
          en priorité absolue ; le contenu est retiré dès que le caractère illicite est vraisemblable.
        </p>
      </>
    ),
  },
  {
    id: 'sans-compte',
    title: 'Signaler sans compte : point de contact unique (DSA)',
    content: (
      <>
        <p>
          Toute personne, même sans compte, peut nous adresser une notification au titre de l’article 16 du
          règlement (UE) 2022/2065 sur les services numériques (DSA), à notre{' '}
          <strong>point de contact unique</strong> (articles 11 et 12 du DSA) :
        </p>
        <p className="rounded-md border p-3">
          <Ph>{COMPANY.dsaEmail}</Ph>
          <br />
          Langues acceptées : français, anglais.
          <br />
          Par courrier : <Ph>{COMPANY.name}</Ph> – Signalements – <Ph>{COMPANY.address}</Ph>
        </p>
        <p>Pour que nous puissions agir rapidement, votre notification doit contenir :</p>
        <ol>
          <li>les raisons pour lesquelles vous estimez que le contenu est illicite ;</li>
          <li>l’adresse exacte (URL) du ou des contenus, ou tout élément permettant de les identifier ;</li>
          <li>
            vos nom et adresse électronique, sauf si le signalement concerne des abus sexuels sur mineurs (vous
            pouvez alors rester anonyme) ;
          </li>
          <li>
            une déclaration confirmant que vous êtes de bonne foi et que les informations fournies sont exactes et
            complètes.
          </li>
        </ol>
        <p>
          Nous accusons réception de votre notification, la traitons avec diligence, de manière objective et non
          arbitraire, et vous informons de notre décision et des voies de recours. Les signaleurs de confiance
          désignés au titre de l’article 22 du DSA bénéficient d’un traitement prioritaire.
        </p>
        <p className="text-sm text-muted-foreground">
          Attention : un signalement abusif ou sciemment inexact peut engager votre responsabilité, et des
          signalements manifestement infondés répétés peuvent entraîner la suspension de leur traitement.
        </p>
      </>
    ),
  },
  {
    id: 'droit-image',
    title: 'Vous apparaissez dans un contenu sans votre accord',
    content: (
      <>
        <p>
          Si une image ou une vidéo intime de vous est publiée sans votre consentement, si vous êtes victime d’un
          hypertrucage (« deepfake ») ou si vous apparaissez dans un contenu sans y avoir consenti, écrivez-nous à{' '}
          <Ph>{COMPANY.dsaEmail}</Ph> en joignant le lien du contenu. Le contenu est suspendu immédiatement pendant
          l’examen. Vous n’avez pas à prouver votre identité au-delà de ce qui est nécessaire pour vous reconnaître
          sur le contenu.
        </p>
        <p>
          Ces faits sont des délits (articles 226-1, 226-2-1, 226-8 et 226-8-1 du Code pénal) : vous pouvez porter
          plainte auprès de la police, de la gendarmerie ou du procureur de la République.
        </p>
      </>
    ),
  },
  {
    id: 'droits-auteur',
    title: 'Atteinte à vos droits d’auteur',
    content: (
      <p>
        Les titulaires de droits peuvent signaler une contrefaçon (reproduction de leurs contenus sans
        autorisation) au point de contact ci-dessus, en précisant l’œuvre protégée, la qualité de titulaire des
        droits ou de mandataire, et le lien du contenu litigieux. Les comptes contrefacteurs récidivistes sont
        fermés.
      </p>
    ),
  },
  {
    id: 'autorites',
    title: 'Signaler aux autorités',
    content: (
      <>
        <p>
          Vous pouvez également, et sans préjudice de votre signalement auprès de nous, signaler tout contenu
          illicite sur internet (pédocriminalité, terrorisme, incitation à la haine, escroquerie…) sur la
          plateforme officielle <strong>PHAROS</strong> du ministère de l’Intérieur :{' '}
          <a href={PHAROS_URL} target="_blank" rel="noopener noreferrer">
            www.internet-signalement.gouv.fr
          </a>
          .
        </p>
        <p>
          De notre côté, nous signalons aux autorités compétentes (PHAROS notamment) les contenus manifestement
          illicites dont nous avons connaissance, et les conservons pour les besoins de l’enquête.
        </p>
      </>
    ),
  },
  {
    id: 'apres',
    title: 'Après votre signalement : décision et recours',
    content: (
      <>
        <ul>
          <li>
            <strong>Décision</strong> : nous pouvons retirer le contenu, en restreindre l’accès, suspendre ou fermer
            le compte concerné, ou conclure que le contenu n’est ni illicite ni contraire à nos règles.
          </li>
          <li>
            <strong>Information</strong> : l’auteur du signalement et l’auteur du contenu sont informés de la
            décision ; l’auteur du contenu reçoit un exposé des motifs (article 17 du DSA).
          </li>
          <li>
            <strong>Réclamation</strong> : chacun peut contester la décision gratuitement, dans un délai de{' '}
            <strong>six mois</strong>, depuis le lien de la notification ou à <Ph>{COMPANY.dsaEmail}</Ph>. La
            réclamation est examinée par une personne différente de celle qui a pris la décision (article 20 du
            DSA).
          </li>
          <li>
            <strong>Règlement extrajudiciaire</strong> : vous pouvez saisir un organe de règlement extrajudiciaire
            des litiges certifié (article 21 du DSA), ou les tribunaux.
          </li>
        </ul>
        <p>
          Voir aussi les <Link href="/legal/regles-contenu">Règles de contenu</Link> et les articles « Modération »
          et suivants des <Link href="/legal/cgu">CGU</Link>.
        </p>
      </>
    ),
  },
]

export default function SignalementPage() {
  return <LegalDocument title={page.title} version={LEGAL_VERSIONS.terms} sections={sections} />
}
