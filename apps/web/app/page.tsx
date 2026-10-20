import Link from 'next/link'
import { Check, Lock, MessageCircle } from 'lucide-react'
import { BRAND_NAME, Logo } from '@/components/brand/logo'
import {
  LandingEarnings,
  LandingFooterCta,
  LandingHeaderActions,
  LandingHeroActions,
  LandingMaintenanceBanner,
  MinimumPayout,
  PlatformFee,
} from '@/components/landing-actions'

const forCreators = [
  'Vous fixez vos prix : un ou plusieurs paliers mensuels, plus des posts payants à l’unité.',
  'Photos, vidéos, stories et lives, visibles seulement par les abonnés du bon palier.',
  'Une messagerie privée avec vos fans, et les pourboires qui vont avec.',
  'Vos revenus et vos abonnés suivis jour par jour, retrait sur votre compte bancaire.',
]

const forFans = [
  'Un abonnement par créateur, sans engagement : vous arrêtez quand vous voulez.',
  'Le contenu qu’ils ne publient nulle part ailleurs, au même endroit.',
  'Vous pouvez leur écrire directement, et ils vous répondent.',
  'Paiement par carte via Stripe : vos coordonnées bancaires ne passent jamais par nous.',
]

const faq = [
  {
    question: 'Combien ça coûte ?',
    answer: (
      <>
        L’inscription est gratuite, pour les créateurs comme pour les fans. Sur chaque paiement reçu par un créateur,{' '}
        {BRAND_NAME} garde une commission de <PlatformFee /> ; tout le reste lui revient.
      </>
    ),
  },
  {
    question: 'Quand est-ce que je suis payé ?',
    answer: (
      <>
        Vos gains s’accumulent sur votre solde au fil des abonnements, pourboires et achats. Vous pouvez demander un
        retrait dès <MinimumPayout /> : l’argent est versé sur votre compte bancaire par Stripe.
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
      'Pour un fan, non. Pour un créateur, oui avant de recevoir de l’argent : Stripe demande une pièce d’identité et un RIB, comme n’importe quel service de paiement.',
  },
  {
    question: 'Je peux résilier un abonnement quand je veux ?',
    answer:
      'Oui, en un clic depuis « Mes abonnements ». Vous gardez l’accès jusqu’à la fin de la période déjà payée, et vous n’êtes plus prélevé ensuite.',
  },
]

/** Static mock of a creator page, so visitors see the product before signing up */
function ProfilePreview() {
  return (
    <div className="relative mx-auto w-full max-w-sm" aria-hidden="true">
      <div className="overflow-hidden rounded-2xl border bg-card shadow-xl lg:rotate-1">
        <div className="h-24 bg-[linear-gradient(120deg,#c7d2fe,#f5d0fe)] dark:bg-[linear-gradient(120deg,#312e81,#581c87)]" />
        <div className="px-5 pb-5">
          <div className="-mt-8 flex items-end justify-between">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-card bg-amber-200 text-lg font-semibold text-amber-900">
              AM
            </div>
            <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">1 284 abonnés</span>
          </div>
          <p className="mt-2 font-semibold">Alice Martin</p>
          <p className="text-sm text-muted-foreground">Coach fitness · programmes maison sans matériel</p>

          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg border p-3">
              <p className="font-medium">Fan</p>
              <p className="text-muted-foreground">4,99 € / mois</p>
            </div>
            <div className="rounded-lg border-2 border-indigo-600 p-3">
              <p className="font-medium">VIP</p>
              <p className="text-muted-foreground">14,99 € / mois</p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div className="rounded-lg bg-muted/60 p-3 text-sm">
              Séance jambes de ce matin, 25 minutes chrono. Le programme complet des 4 semaines est juste en dessous 👇
            </div>
            <div className="relative overflow-hidden rounded-lg border">
              <div className="h-24 bg-[repeating-linear-gradient(45deg,#e5e7eb_0_10px,#f3f4f6_10px_20px)] blur-[2px] dark:bg-[repeating-linear-gradient(45deg,#1f2937_0_10px,#111827_10px_20px)]" />
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm font-medium">
                <Lock className="h-4 w-4" />
                Réservé aux VIP · ou 7,99 € à l’unité
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-20 -left-2 max-w-[15rem] rounded-2xl border bg-card p-3 text-sm shadow-lg sm:-left-10 lg:-rotate-2">
        <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MessageCircle className="h-3.5 w-3.5" />
          Message de Julie
        </div>
        J’ai tenu les 4 semaines, merci pour le programme !
        <p className="mt-1 text-xs font-medium text-emerald-600">+ 5 € de pourboire</p>
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4">
        <LandingMaintenanceBanner />
        <nav className="flex items-center justify-between gap-4 py-6">
          <Logo markClassName="h-10 w-10" />
          <LandingHeaderActions />
        </nav>

        {/* Hero */}
        <section className="grid items-center gap-16 py-10 sm:py-16 lg:grid-cols-2">
          <div>
            <p className="mb-4 text-sm font-medium text-indigo-600 dark:text-indigo-400">
              Pour les créateurs, et ceux qui les suivent
            </p>
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
              Sur {BRAND_NAME}, vous publiez pour les gens qui vous soutiennent vraiment : photos, vidéos, lives et
              messages privés. Ils s’abonnent chaque mois, vous êtes payé, et vous décidez de ce que vous montrez, et à
              qui.
            </p>
            <LandingHeroActions />
            <p className="mt-6 text-sm text-muted-foreground">
              Inscription gratuite · Paiement sécurisé par Stripe · Résiliable à tout moment
            </p>
          </div>
          <div className="pb-20">
            <ProfilePreview />
          </div>
        </section>

        {/* Earnings */}
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

        {/* Creators / fans */}
        <section className="grid gap-12 border-t py-16 md:grid-cols-2">
          {[
            { title: 'Vous êtes créateur', items: forCreators },
            { title: 'Vous êtes fan', items: forFans },
          ].map((column) => (
            <div key={column.title}>
              <h2 className="mb-6 text-2xl font-bold tracking-tight">{column.title}</h2>
              <ul className="space-y-4">
                {column.items.map((item) => (
                  <li key={item} className="flex gap-3">
                    <Check className="mt-1 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {/* FAQ */}
        <section className="border-t py-16">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-8 text-3xl font-bold tracking-tight">Les questions qu’on nous pose</h2>
            <div className="divide-y rounded-xl border">
              {faq.map((item) => (
                <details key={item.question} className="group p-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    {item.question}
                    <span className="text-xl leading-none text-muted-foreground transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-muted-foreground">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final call to action */}
        <section className="mb-16 rounded-2xl bg-gray-900 px-6 py-12 text-center text-white sm:px-12 dark:bg-indigo-950 dark:ring-1 dark:ring-indigo-900">
          <h2 className="mb-3 text-3xl font-bold tracking-tight">Votre page peut être en ligne ce soir.</h2>
          <p className="mx-auto mb-8 max-w-xl text-gray-300 dark:text-indigo-200">
            Créez votre compte, choisissez vos prix, publiez votre premier post. Vos fans n’auront plus qu’à s’abonner.
          </p>
          <LandingFooterCta />
        </section>
      </div>

      <footer className="border-t">
        <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row">
          <Logo className="text-lg" markClassName="h-7 w-7" />
          <div className="flex gap-6">
            <Link href="/discover" className="hover:text-foreground">
              Découvrir des créateurs
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Connexion
            </Link>
            <Link href="/register" className="hover:text-foreground">
              Inscription
            </Link>
          </div>
          <p>&copy; {new Date().getFullYear()} {BRAND_NAME}</p>
        </div>
      </footer>
    </div>
  )
}
