'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Loader2, User, Users } from 'lucide-react'
import { coPerformerName, coPerformersApi } from '@/lib/verification'

interface CoPerformersPickerProps {
  soloContent: boolean
  onSoloContentChange: (solo: boolean) => void
  selectedIds: string[]
  onSelectedIdsChange: (ids: string[]) => void
  disabled?: boolean
  /** Show the validation error (nobody selected while "with others") */
  showError?: boolean
}

/**
 * "Seulement moi" / "Avec d'autres personnes" + choice among the creator's
 * VERIFIED co-performers (the only ones the API accepts)
 */
export function CoPerformersPicker({
  soloContent,
  onSoloContentChange,
  selectedIds,
  onSelectedIdsChange,
  disabled,
  showError,
}: CoPerformersPickerProps) {
  const { data: verified = [], isLoading } = useQuery({
    queryKey: ['co-performers', 'VERIFIED'],
    queryFn: async () => (await coPerformersApi.list('VERIFIED')).data,
  })

  const toggle = (id: string) =>
    onSelectedIdsChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id])

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Personnes présentes">
        {([
          { solo: true, label: 'Seulement moi', hint: 'Personne d’autre n’apparaît', icon: User },
          { solo: false, label: 'Avec d’autres personnes', hint: 'Co-participants vérifiés uniquement', icon: Users },
        ] as const).map((option) => (
          <label
            key={String(option.solo)}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
              soloContent === option.solo ? 'border-primary bg-primary/5' : 'hover:bg-accent'
            }`}
          >
            <input
              type="radio"
              name="soloContent"
              checked={soloContent === option.solo}
              onChange={() => {
                onSoloContentChange(option.solo)
                if (option.solo) onSelectedIdsChange([])
              }}
              disabled={disabled}
              className="mt-1"
              data-testid={`solo-content-${option.solo ? 'yes' : 'no'}`}
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <option.icon className="h-4 w-4" />
                {option.label}
              </span>
              <span className="block text-xs text-muted-foreground">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {!soloContent && (
        <div className="space-y-2 rounded-lg border p-3">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : verified.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun co-participant vérifié.{' '}
              <Link href="/creator/co-performers" className="font-medium text-primary hover:underline">
                Déclarez les personnes présentes
              </Link>{' '}
              (pièce d’identité et autorisation signée) : elles pourront être ajoutées une fois vérifiées.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium">Qui apparaît dans ce contenu ?</p>
              <div className="flex flex-wrap gap-2">
                {verified.map((coPerformer) => {
                  const selected = selectedIds.includes(coPerformer.id)
                  return (
                    <button
                      type="button"
                      key={coPerformer.id}
                      onClick={() => toggle(coPerformer.id)}
                      disabled={disabled}
                      aria-pressed={selected}
                      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                        selected ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      {coPerformerName(coPerformer)}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Quelqu’un manque ?{' '}
                <Link href="/creator/co-performers" className="text-primary hover:underline">
                  Gérer mes co-participants
                </Link>
              </p>
            </>
          )}
          {showError && selectedIds.length === 0 && (
            <p className="text-xs text-red-600">Sélectionnez au moins une personne vérifiée</p>
          )}
        </div>
      )}
    </div>
  )
}
