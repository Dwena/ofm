import type { Metadata } from 'next'
import Link from 'next/link'
import { BRAND_NAME } from '@/components/brand/logo'
import { LandingEarnings, LandingHeroActions, MinimumPayout, PlatformFee } from '@/components/landing-actions'
import { CheckList, type FaqItem, LandingFaq, LandingLayout, Steps } from '@/components/landing/landing-layout'
import { CreatorPagePreview } from '@/components/landing/previews'

export const metadata: Metadata = {
  title: 'Pour les créateurs',
  description: 'Publiez pour vos abonnés, fixez vos prix et soyez payé chaque mois.',
}

const features = [
  'Vous fixez vos prix : un ou plusieurs paliers mensuels, plus des posts payants à l’unité.',
  'Photos, vidéos, stories et lives, visibles seulement par les abonnés du bon palier.',
  'Une messagerie privée avec vos fans, et les pourboires qui vont avec.',
  'En live, des objectifs de dons par paliers : 100 €, 200 €, 500 €… chacun se débloque devant vos spectateurs.',
  'Vos revenus et vos abonnés suivis jour par jour, retrait sur votre compte bancaire.',
]

const steps = [
  { title: 'Créez votre page', text: 'Photo, bannière, quelques mots sur vous. Cinq minutes suffisent.' },
  { title: 'Choisissez vos prix', text: 'Un palier ou plusieurs, et ce qui est inclus dans chacun. Modifiable à tout moment.' },
  { title: 'Publiez et partagez', text: 'Postez votre premier contenu, mettez le lien de votre page dans vos réseaux.' },
]

const faq: FaqItem[] = [
  {
    question: 'Combien ça coûte ?',
    answer: (
      <>
        L’inscription est gratuite. Sur chaque paiement que vous recevez, {BRAND_NAME} garde une commission de{' '}
        <PlatformFee /> ; tout le reste est pour vous.
      </>
    ),
  },
  {
    question: 'Quand est-ce que je suis payé ?',
    answer: (
      <>
        Vos gains s’accumulent sur votre solde au fil des abonnements, pourboires et achats. Vous pouvez demander un
        retrait dès <MinimumPayout /> : l’argent est versé par virement bancaire (SEPA), 7 jours après chaque paiement.
      </>
    ),
  },
  {
    question: 'Qui peut voir ce que je publie ?',
    answer:
      'Vous choisissez pour chaque publication : visible par tous, réservée à vos abonnés (ou à un palier précis), ou payante à l’unité. Vous pouvez bloquer un utilisateur et signaler un comportement à la modération.',
  },
  {
    question: 'Faut-il vérifier son identité ?',
    answer:
      'Oui : une pièce d’identité et un selfie avant de publier (vous devez être majeur·e), puis un profil fiscal et un RIB avant de recevoir vos virements. Chaque personne qui apparaît avec vous doit aussi être vérifiée.',
  },
  {
    question: 'Comment marchent les objectifs de dons en live ?',
    answer:
      'Avant ou pendant le live, vous fixez quelques paliers avec ce que vous ferez en échange. Les pourboires du live remplissent une cagnotte commune : chaque palier atteint s’affiche en direct, et vous le marquez comme fait une fois réalisé.',
  },
  {
    question: 'Je peux couper les messages privés ?',
    answer: 'Oui, depuis votre profil. Vous pouvez aussi désactiver les pourboires ou fixer un montant minimum.',
  },
]

export default function CreatorsLanding() {
  return (
    <LandingLayout
      audience="creators"
      cta={{
        title: 'Votre page peut être en ligne ce soir.',
        text: 'Créez votre compte, choisissez vos prix, publiez votre premier post. Vos fans n’auront plus qu’à s’abonner.',
        crossLink: (
          <>
            Vous cherchez plutôt à suivre des créateurs ?{' '}
            <Link href="/" className="underline underline-offset-4 hover:text-white">
              C’est par ici
            </Link>
          </>
        ),
      }}
    >
      <section className="grid items-center gap-16 py-10 sm:py-16 lg:grid-cols-2">
        <div>
          <p className="mb-4 text-sm font-medium text-indigo-600 dark:text-indigo-400">Pour les créateurs</p>
          <h1 className="mb-6 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Vos fans en veulent plus.
            <br />
            Donnez-leur un accès{' '}
            <span className="relative whitespace-nowrap">
              VIP
              <svg
                viewBox="0 0 120 12"
                className="absolute -bottom-2 left-0 h-3 w-full text-amber-400"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d="M2 8c20-5 40-6 58-3s38 3 58-2" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
            </span>
            .
          </h1>
          <p className="mb-8 max-w-xl text-lg text-muted-foreground">
            Sur {BRAND_NAME}, vous publiez pour les gens qui vous soutiennent vraiment : photos, vidéos, lives et messages
            privés. Ils s’abonnent chaque mois, vous êtes payé, et vous décidez de ce que vous montrez, et à qui.
          </p>
          <LandingHeroActions audience="creators" />
          <p className="mt-6 text-sm text-muted-foreground">
            Inscription gratuite · <PlatformFee /> de commission · Retrait dès <MinimumPayout />
          </p>
        </div>
        <div className="pb-20">
          <CreatorPagePreview />
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-3 text-3xl font-bold tracking-tight">Ce que ça peut vous rapporter</h2>
          <p className="mb-8 text-muted-foreground">
            Pas de formule magique : un nombre d’abonnés, un prix, et la commission de la plateforme. Faites le calcul
            avec vos chiffres.
          </p>
          <LandingEarnings />
        </div>
      </section>

      <section className="grid gap-12 border-t py-16 md:grid-cols-2">
        <div>
          <h2 className="mb-6 text-2xl font-bold tracking-tight">Tout est déjà là</h2>
          <CheckList items={features} />
        </div>
        <div>
          <h2 className="mb-6 text-2xl font-bold tracking-tight">Pour démarrer</h2>
          <Steps items={steps} />
        </div>
      </section>

      <LandingFaq title="Les questions des créateurs" items={faq} />
    </LandingLayout>
  )
}
