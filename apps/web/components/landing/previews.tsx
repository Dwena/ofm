import { Heart, Lock, MessageCircle, Radio } from 'lucide-react'

/** Static mock of a creator page, so visitors see the product before signing up */
export function CreatorPagePreview() {
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

const stories = [
  { initials: 'AM', name: 'Alice', color: 'bg-amber-200 text-amber-900' },
  { initials: 'CL', name: 'Claire', color: 'bg-rose-200 text-rose-900' },
  { initials: 'BO', name: 'Bob', color: 'bg-sky-200 text-sky-900' },
  { initials: 'IN', name: 'Inès', color: 'bg-emerald-200 text-emerald-900' },
]

/** Static mock of a fan's feed: stories, a post, a live and a reply from a creator */
export function FanFeedPreview() {
  return (
    <div className="relative mx-auto w-full max-w-sm" aria-hidden="true">
      <div className="overflow-hidden rounded-2xl border bg-card shadow-xl lg:-rotate-1">
        <div className="flex gap-4 border-b px-5 py-4">
          {stories.map((story) => (
            <div key={story.name} className="flex flex-col items-center gap-1">
              <div className="rounded-full bg-gradient-to-tr from-amber-400 to-pink-500 p-[2px]">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-full border-2 border-card text-sm font-semibold ${story.color}`}
                >
                  {story.initials}
                </div>
              </div>
              <span className="text-xs text-muted-foreground">{story.name}</span>
            </div>
          ))}
        </div>

        <div className="px-5 py-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-200 text-xs font-semibold text-rose-900">
              CL
            </div>
            <div className="text-sm">
              <p className="font-medium">Claire Dubois</p>
              <p className="text-xs text-muted-foreground">Cheffe à domicile · il y a 2 h</p>
            </div>
          </div>
          <div className="mb-3 flex h-36 items-end rounded-lg bg-[linear-gradient(135deg,#fed7aa,#fca5a5)] p-3 dark:bg-[linear-gradient(135deg,#7c2d12,#7f1d1d)]">
            <span className="rounded-md bg-white/80 px-2 py-1 text-xs font-medium text-gray-900">
              Tarte tatin en 30 minutes 🍎
            </span>
          </div>
          <p className="text-sm">La recette pas à pas, comme promis. Dites-moi si vous la tentez ce week-end !</p>
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Heart className="h-3.5 w-3.5" /> 342
            </span>
            <span className="flex items-center gap-1">
              <MessageCircle className="h-3.5 w-3.5" /> 27
            </span>
          </div>
        </div>

        <div className="mx-5 mb-5 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <Radio className="h-4 w-4" />
          Bob est en live · 128 spectateurs
        </div>
      </div>

      <div className="absolute -bottom-24 -right-2 max-w-[15rem] rounded-2xl border bg-card p-3 text-sm shadow-lg sm:-right-8 lg:rotate-2">
        <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MessageCircle className="h-3.5 w-3.5" />
          Réponse d’Alice
        </div>
        Merci pour ton message ! Le programme du mois prochain sort lundi 💪
      </div>
    </div>
  )
}
