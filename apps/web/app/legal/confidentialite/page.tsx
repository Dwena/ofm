import type { Metadata } from 'next'
import Link from 'next/link'

import { LegalDocument, Ph, type LegalSection } from '@/components/legal/legal-document'
import { CNIL_COMPLAINT_URL, CNIL_URL, COMPANY, LEGAL_VERSIONS, legalPage } from '@/lib/legal'

const page = legalPage('confidentialite')

export const metadata: Metadata = { title: page.title }

const TableWrap = ({ children }: { children: React.ReactNode }) => (
  <div className="overflow-x-auto">
    <table>{children}</table>
  </div>
)

const sections: LegalSection[] = [
  {
    id: 'responsable',
    title: 'Responsable du traitement et contact',
    content: (
      <>
        <p>
          Le responsable du traitement de vos données personnelles est <Ph>{COMPANY.name}</Ph>,{' '}
          <Ph>{COMPANY.legalForm}</Ph>, <Ph>{COMPANY.address}</Ph> (« {COMPANY.brand} », « nous »).
        </p>
        <p>
          Pour toute question relative à vos données ou pour exercer vos droits, contactez notre délégué à la
          protection des données (DPO) : <Ph>{COMPANY.dpoEmail}</Ph>.
        </p>
        <p>
          La présente politique est établie conformément au règlement (UE) 2016/679 (« RGPD ») et à la loi
          n° 78-17 du 6 janvier 1978 relative à l’informatique, aux fichiers et aux libertés.
        </p>
      </>
    ),
  },
  {
    id: 'donnees',
    title: 'Données que nous traitons',
    content: (
      <>
        <TableWrap>
          <thead>
            <tr>
              <th>Catégorie</th>
              <th>Exemples</th>
              <th>Personnes concernées</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Compte</td>
              <td>Adresse e-mail, nom d’utilisateur, mot de passe (haché), nom affiché, photo de profil, biographie, préférences, langue, paramètres de sécurité (double authentification)</td>
              <td>Tous les Utilisateurs</td>
            </tr>
            <tr>
              <td>Acceptations légales</td>
              <td>Documents acceptés (CGU, confidentialité, déclaration de majorité, conditions créateurs, CGV), version, date, adresse IP et navigateur</td>
              <td>Tous les Utilisateurs</td>
            </tr>
            <tr>
              <td>Vérification de l’âge</td>
              <td>
                <strong>Uniquement le résultat</strong> (majeur oui/non), la date et la méthode de vérification.
                Aucune pièce d’identité, image ou date de naissance n’est transmise à {COMPANY.brand}.
              </td>
              <td>Visiteurs et Utilisateurs souhaitant voir des contenus pour adultes</td>
            </tr>
            <tr>
              <td>Paiements</td>
              <td>
                Références de transaction et d’abonnement chez le prestataire de paiement, montants, TVA, pays de
                facturation, type et 4 derniers chiffres de la carte, historique des achats et remboursements.{' '}
                <strong>Le numéro complet de carte n’est jamais reçu ni stocké par {COMPANY.brand}.</strong>
              </td>
              <td>Fans</td>
            </tr>
            <tr>
              <td>Vérification d’identité (KYC)</td>
              <td>Pièce d’identité, selfie, date de naissance, autorisations de diffusion signées, résultat de la vérification</td>
              <td>Créateurs et Co-performeurs</td>
            </tr>
            <tr>
              <td>Données fiscales et bancaires</td>
              <td>Identité, adresse, date de naissance, numéro d’identification fiscale, n° de TVA ou SIREN, IBAN, revenus perçus, factures émises par autofacturation</td>
              <td>Créateurs</td>
            </tr>
            <tr>
              <td>Contenus et interactions</td>
              <td>Publications, stories, lives, commentaires, likes, abonnements, abonnés, messages privés et pièces jointes, pourboires</td>
              <td>Tous les Utilisateurs</td>
            </tr>
            <tr>
              <td>Modération</td>
              <td>Signalements effectués ou reçus, décisions de modération et exposés des motifs, réclamations, empreintes numériques (hash) des fichiers</td>
              <td>Utilisateurs concernés, auteurs de signalements</td>
            </tr>
            <tr>
              <td>Données techniques</td>
              <td>Adresse IP, journaux de connexion, type d’appareil et de navigateur, sessions actives, rapports d’erreur techniques</td>
              <td>Tous les Utilisateurs et visiteurs</td>
            </tr>
          </tbody>
        </TableWrap>
      </>
    ),
  },
  {
    id: 'donnees-sensibles',
    title: 'Données sensibles et garanties particulières',
    content: (
      <>
        <p>
          Compte tenu de la nature de la Plateforme, vos abonnements, achats, messages ou contenus peuvent révéler
          des informations relatives à votre <strong>vie sexuelle ou à votre orientation sexuelle</strong>, qui
          sont des données sensibles au sens de l’article 9 du RGPD. Nous ne cherchons pas à déduire ces
          informations et ne les utilisons ni à des fins de profilage publicitaire ni de recommandation fondée sur
          ces caractéristiques. Leur traitement repose sur votre <strong>consentement explicite</strong>, exprimé
          par votre inscription et l’utilisation volontaire de ces fonctionnalités, et sur le fait que les
          données de contenus que vous rendez publiques sont manifestement rendues publiques par vous (article 9.2
          a et e du RGPD).
        </p>
        <p>Nous appliquons des garanties renforcées :</p>
        <ul>
          <li>aucun outil d’enregistrement de session, de publicité ciblée ou de traceur publicitaire ;</li>
          <li>vérification de l’âge en « double anonymat » : nous ne connaissons pas votre identité ;</li>
          <li>chiffrement des communications (HTTPS) et des documents d’identité et données bancaires au repos ;</li>
          <li>accès aux documents KYC limité au personnel habilité, soumis à une obligation de confidentialité, et journalisé ;</li>
          <li>libellé de relevé bancaire discret ;</li>
          <li>minimisation des données transmises aux prestataires ;</li>
          <li>analyse d’impact relative à la protection des données (AIPD) réalisée et tenue à jour.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'finalites',
    title: 'Finalités et bases légales',
    content: (
      <TableWrap>
        <thead>
          <tr>
            <th>Finalité</th>
            <th>Base légale (article 6 RGPD)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Créer et gérer votre compte, fournir les services (abonnements, contenus, messagerie, lives)</td>
            <td>Exécution du contrat (CGU, CGV)</td>
          </tr>
          <tr>
            <td>Traiter les paiements, factures, remboursements, TVA</td>
            <td>Exécution du contrat ; obligations légales comptables et fiscales</td>
          </tr>
          <tr>
            <td>Vérifier l’âge avant l’accès aux contenus pour adultes</td>
            <td>Obligation légale (loi SREN, article 227-24 du Code pénal)</td>
          </tr>
          <tr>
            <td>Vérifier l’identité et la majorité des Créateurs et Co-performeurs, conserver les autorisations de diffusion</td>
            <td>Obligation légale et intérêt légitime (prévention de l’exploitation sexuelle et des contenus non consentis)</td>
          </tr>
          <tr>
            <td>Verser les revenus des Créateurs, autofacturation, déclaration DAC7</td>
            <td>Exécution du contrat ; obligations légales (articles 242 bis et 1649 ter A du CGI)</td>
          </tr>
          <tr>
            <td>Modérer les contenus, traiter les signalements et réclamations, signaler les infractions aux autorités</td>
            <td>Obligations légales (DSA, LCEN) ; intérêt légitime (sécurité de la Plateforme)</td>
          </tr>
          <tr>
            <td>Prévenir la fraude, sécuriser les comptes, gérer les contestations de paiement</td>
            <td>Intérêt légitime ; obligations légales</td>
          </tr>
          <tr>
            <td>Conserver la preuve de vos acceptations (CGU, CGV, renonciation au droit de rétractation)</td>
            <td>Intérêt légitime (preuve) ; obligation légale</td>
          </tr>
          <tr>
            <td>Détecter et corriger les erreurs techniques</td>
            <td>Intérêt légitime (bon fonctionnement du service)</td>
          </tr>
          <tr>
            <td>Envoyer des notifications de service ; des communications commerciales le cas échéant</td>
            <td>Exécution du contrat ; consentement pour la prospection</td>
          </tr>
          <tr>
            <td>Répondre aux réquisitions des autorités</td>
            <td>Obligation légale</td>
          </tr>
        </tbody>
      </TableWrap>
    ),
  },
  {
    id: 'conservation',
    title: 'Durées de conservation',
    content: (
      <>
        <TableWrap>
          <thead>
            <tr>
              <th>Données</th>
              <th>Durée</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Données de compte</td>
              <td>Pendant la durée du compte, puis suppression ou anonymisation, sous réserve des durées légales ci-dessous</td>
            </tr>
            <tr>
              <td>Pièces comptables et factures (y compris autofacturation)</td>
              <td>10 ans (article L123-22 du Code de commerce)</td>
            </tr>
            <tr>
              <td>Données fiscales des Créateurs et déclarations DAC7</td>
              <td>10 ans</td>
            </tr>
            <tr>
              <td>Documents d’identité, selfies et autorisations de diffusion (Créateurs, Co-performeurs)</td>
              <td>Durée du compte + 5 ans <Ph>[durée à valider]</Ph>, pour répondre aux autorités et à toute contestation relative au consentement ou à l’âge des personnes</td>
            </tr>
            <tr>
              <td>Résultat de la vérification d’âge</td>
              <td>Pendant sa durée de validité, puis suppression</td>
            </tr>
            <tr>
              <td>Données d’identification et de connexion (adresse IP, journaux)</td>
              <td>1 an (décret n° 2021-1362 du 20 octobre 2021) ; jusqu’à 5 ans après la fermeture du compte pour les informations d’identité requises par ce décret</td>
            </tr>
            <tr>
              <td>Preuves d’acceptation des documents légaux</td>
              <td>Durée du compte + 5 ans (prescription)</td>
            </tr>
            <tr>
              <td>Messages et contenus</td>
              <td>Jusqu’à leur suppression par vous ou la fermeture du compte ; contenus retirés pour illicéité : conservés le temps nécessaire aux autorités</td>
            </tr>
            <tr>
              <td>Signalements et décisions de modération</td>
              <td>5 ans après la décision</td>
            </tr>
          </tbody>
        </TableWrap>
        <p>
          Les données nécessaires à une procédure judiciaire en cours peuvent être conservées jusqu’à son terme.
        </p>
      </>
    ),
  },
  {
    id: 'destinataires',
    title: 'Destinataires',
    content: (
      <>
        <p>Vos données ne sont jamais vendues. Elles sont accessibles, dans la limite de leurs besoins, à :</p>
        <ul>
          <li>nos équipes habilitées (support, modération, vérification d’identité, comptabilité) ;</li>
          <li>notre prestataire de paiement (CCBill), qui traite les données de carte ;</li>
          <li>notre hébergeur : <Ph>{COMPANY.host}</Ph> ;</li>
          <li>notre prestataire de vérification d’âge <Ph>[NOM DU PRESTATAIRE]</Ph>, qui ne nous transmet que le résultat ;</li>
          <li>le cas échéant, nos prestataires de vérification d’identité, de détection de contenus illicites par empreintes, d’envoi d’e-mails et de suivi des erreurs techniques <Ph>[NOMS DES PRESTATAIRES]</Ph> ;</li>
          <li>l’administration fiscale (DGFiP) pour la déclaration annuelle DAC7 des revenus des Créateurs ;</li>
          <li>les autorités judiciaires et administratives sur réquisition, la plateforme PHAROS et les organismes de signalement des contenus pédocriminels (NCMEC notamment) ;</li>
          <li>
            les Créateurs auxquels vous êtes abonné ou avec lesquels vous échangez, qui voient votre nom
            d’utilisateur, votre photo de profil, vos messages et vos achats chez eux, mais jamais vos données de
            paiement ni votre adresse e-mail.
          </li>
        </ul>
        <p>Nos prestataires agissent en qualité de sous-traitants liés par un contrat conforme à l’article 28 du RGPD, ou de responsables de traitement distincts pour leurs propres obligations (prestataire de paiement notamment).</p>
      </>
    ),
  },
  {
    id: 'transferts',
    title: 'Transferts hors de l’Union européenne',
    content: (
      <p>
        Certains prestataires peuvent être situés hors de l’Union européenne : <Ph>[TRANSFERTS HORS UE : prestataires, pays, garanties — par ex. prestataire de paiement aux États-Unis]</Ph>.
        Ces transferts sont encadrés par une décision d’adéquation de la Commission européenne (notamment le
        cadre de protection des données UE–États-Unis pour les entreprises certifiées) ou par des clauses
        contractuelles types, complétées si nécessaire de mesures supplémentaires. Vous pouvez en obtenir une
        copie auprès de notre DPO.
      </p>
    ),
  },
  {
    id: 'securite',
    title: 'Sécurité',
    content: (
      <p>
        Nous mettons en œuvre des mesures techniques et organisationnelles adaptées : chiffrement en transit et au
        repos des données les plus sensibles, hachage des mots de passe, double authentification, gestion stricte
        des habilitations, journalisation des accès, sauvegardes et tests de sécurité. En cas de violation de
        données présentant un risque, nous la notifions à la CNIL et, si le risque est élevé, aux personnes
        concernées, conformément aux articles 33 et 34 du RGPD.
      </p>
    ),
  },
  {
    id: 'droits',
    title: 'Vos droits',
    content: (
      <>
        <p>Vous disposez des droits suivants sur vos données :</p>
        <ul>
          <li><strong>accès</strong> et obtention d’une copie ;</li>
          <li><strong>rectification</strong> des données inexactes ;</li>
          <li><strong>effacement</strong>, sous réserve des conservations légales ;</li>
          <li><strong>limitation</strong> du traitement ;</li>
          <li><strong>portabilité</strong> des données que vous nous avez fournies ;</li>
          <li><strong>opposition</strong> aux traitements fondés sur l’intérêt légitime, et à tout moment à la prospection ;</li>
          <li><strong>retrait du consentement</strong>, sans effet sur la licéité des traitements antérieurs ;</li>
          <li>définition de <strong>directives relatives au sort de vos données après votre décès</strong> (article 85 de la loi Informatique et Libertés).</li>
        </ul>
        <p>
          Vous pouvez modifier la plupart de vos données et supprimer votre compte depuis « Paramètres ». Pour les
          autres demandes, écrivez à <Ph>{COMPANY.dpoEmail}</Ph>. Nous répondons dans un délai d’un mois,
          prolongeable de deux mois en cas de demande complexe. Une preuve d’identité peut être demandée en cas de
          doute raisonnable.
        </p>
        <p>
          Vous pouvez introduire une réclamation auprès de la Commission nationale de l’informatique et des
          libertés (CNIL),{' '}
          <a href={CNIL_URL} target="_blank" rel="noopener noreferrer">
            www.cnil.fr
          </a>{' '}
          (
          <a href={CNIL_COMPLAINT_URL} target="_blank" rel="noopener noreferrer">
            adresser une plainte
          </a>
          ).
        </p>
      </>
    ),
  },
  {
    id: 'decisions-automatisees',
    title: 'Décisions automatisées',
    content: (
      <p>
        Des outils automatisés aident à détecter les contenus illicites (comparaison d’empreintes) et la fraude.
        Aucune décision produisant des effets juridiques ou vous affectant de manière significative (fermeture de
        compte, refus de vérification) n’est prise sur le seul fondement d’un traitement automatisé : elle est
        toujours prise ou validée par une personne, et vous pouvez la contester.
      </p>
    ),
  },
  {
    id: 'mineurs',
    title: 'Mineurs',
    content: (
      <p>
        La Plateforme est interdite aux mineurs. Si nous apprenons qu’un compte appartient à une personne de
        moins de 18 ans, il est immédiatement fermé et les données sont supprimées, sauf celles nécessaires aux
        signalements aux autorités.
      </p>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies et traceurs',
    content: (
      <p>
        Nous n’utilisons que des traceurs strictement nécessaires au fonctionnement du service. Voir la{' '}
        <Link href="/legal/cookies">Politique cookies</Link>.
      </p>
    ),
  },
  {
    id: 'modifications',
    title: 'Modifications',
    content: (
      <p>
        Cette politique peut évoluer. En cas de modification substantielle, vous en serez informé par courriel ou
        notification et, si nécessaire, votre accord vous sera à nouveau demandé. La date et la version figurent en
        haut de cette page.
      </p>
    ),
  },
]

export default function ConfidentialitePage() {
  return <LegalDocument title={page.title} version={LEGAL_VERSIONS.privacy} sections={sections} />
}
