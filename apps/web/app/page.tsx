import Link from 'next/link'
import { BRAND_NAME } from '@/components/brand/logo'
import { LandingHeroActions } from '@/components/landing-actions'
import { CheckList, type FaqItem, LandingFaq, LandingLayout, Steps } from '@/components/landing/landing-layout'
import { FanFeedPreview } from '@/components/landing/previews'

const benefits = [
  'Le contenu qu’ils ne publient nulle part ailleurs : photos, vidéos, coulisses.',
  'Leurs stories et leurs lives, et vous pouvez réagir en direct.',
  'Vous pouvez leur écrire directement, et ils vous répondent.',
  'Un seul fil d’actualité pour tous les créateurs que vous suivez.',
]

const reassurance = [
  'Chaque créateur fixe son prix : vous voyez le montant exact avant de payer.',
  'Sans engagement : vous résiliez en un clic, l’accès reste ouvert jusqu’à la fin du mois payé.',
  'Paiement par carte via Stripe : vos coordonnées bancaires ne passent jamais par nous.',
  'Envie d’un seul post ? Certains sont vendus à l’unité, sans abonnement.',
]

const steps = [
  { title: 'Créez votre compte', text: 'Un e-mail et un mot de passe. C’est gratuit, et ça ne vous engage à rien.' },
  { title: 'Trouvez vos créateurs', text: 'Cherchez ceux que vous suivez déjà, ou parcourez la page Découvrir pour en trouver de nouveaux.' },
  { title: 'Abonnez-vous', text: 'Choisissez une formule, et tout leur contenu réservé s’ouvre aussitôt.' },
]

const faq: FaqItem[] = [
  {
    question: 'Combien ça coûte ?',
    answer:
      'Créer un compte est gratuit. Ensuite, vous ne payez que les créateurs auxquels vous vous abonnez, au prix qu’ils ont choisi, plus les pourboires et posts à l’unité si vous le souhaitez.',
  },
  {
    question: 'Je peux résilier quand je veux ?',
    answer:
      'Oui, en un clic depuis « Mes abonnements ». Vous gardez l’accès jusqu’à la fin de la période déjà payée, et vous n’êtes plus prélevé ensuite.',
  },
  {
    question: 'Mes coordonnées bancaires sont-elles en sécurité ?',
    answer: `Les paiements passent par Stripe, qui gère aussi ceux de milliers de sites. ${BRAND_NAME} ne voit ni ne stocke jamais votre numéro de carte.`,
  },
  {
    question: 'Je peux écrire à un créateur ?',
    answer: 'Oui, depuis sa page ou depuis vos messages, sauf s’il a choisi de désactiver les messages privés.',
  },
  {
    question: 'Je peux acheter un post sans m’abonner ?',
    answer:
      'Oui, quand le créateur le vend à l’unité : vous payez une fois, et le post reste débloqué pour vous.',
  },
]

export default function Home() {
  return (
    <LandingLayout
      audience="fans"
      cta={{
        title: 'Vos créateurs vous attendent.',
        text: 'Créez votre compte en une minute, trouvez ceux que vous suivez déjà, et ne ratez plus rien de ce qu’ils publient.',
        crossLink: (
          <>
            Vous êtes créateur ?{' '}
            <Link href="/createurs" className="underline underline-offset-4 hover:text-white">
              Découvrez ce que {BRAND_NAME} peut faire pour vous
            </Link>
          </>
        ),
      }}
    >
      <section className="grid items-center gap-16 py-10 sm:py-16 lg:grid-cols-2">
        <div>
          <p className="mb-4 text-sm font-medium text-indigo-600 dark:text-indigo-400">Pour les fans</p>
          <h1 className="mb-6 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Vos créateurs préférés,
            <br />
            en{' '}
            <span className="relative whitespace-nowrap">
              accès VIP
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
            Abonnez-vous à ceux que vous suivez déjà, et voyez ce qu’ils ne montrent pas sur leurs réseaux : contenus
            exclusifs, coulisses, lives, et une vraie conversation avec eux.
          </p>
          <LandingHeroActions audience="fans" />
          <p className="mt-6 text-sm text-muted-foreground">
            Compte gratuit · Sans engagement · Paiement sécurisé par Stripe
          </p>
        </div>
        <div className="pb-28">
          <FanFeedPreview />
        </div>
      </section>

      <section className="border-t py-16">
        <h2 className="mb-10 text-3xl font-bold tracking-tight">Comment ça marche</h2>
        <Steps items={steps} inline />
      </section>

      <section className="grid gap-12 border-t py-16 md:grid-cols-2">
        <div>
          <h2 className="mb-6 text-2xl font-bold tracking-tight">Ce que vous y trouvez</h2>
          <CheckList items={benefits} />
        </div>
        <div>
          <h2 className="mb-6 text-2xl font-bold tracking-tight">Ce que vous payez</h2>
          <CheckList items={reassurance} />
        </div>
      </section>

      <LandingFaq title="Les questions des fans" items={faq} />
    </LandingLayout>
  )
}
