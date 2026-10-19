'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { subscriptionsApi } from '@/lib/api'
import { formatEuros } from '@/lib/utils'
import { useConfirm } from '@/hooks/use-confirm'
import { useToast } from '@/hooks/use-toast'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CheckCircle, Edit, EyeOff, Eye, Loader2, Plus, Trash2, Users, X } from 'lucide-react'

export interface CreatorTier {
  id: string
  name: string
  description: string | null
  price: number // euros
  currency: string
  interval: 'month' | 'year' | string
  benefits: string[]
  isActive: boolean
  subscribersCount: number
  totalSubscriptionsCount: number
  monthlyRevenue: number
  canDelete: boolean
}

export const MY_TIERS_QUERY_KEY = ['creator-subscription-tiers']

const MAX_PRICE = 10000
const MIN_PAID_PRICE = 0.5
const MAX_BENEFITS = 20

interface TierForm {
  name: string
  description: string
  price: string
  interval: 'month' | 'year'
  benefits: string[]
  isActive: boolean
}

type TierFormErrors = Partial<Record<'name' | 'description' | 'price' | 'benefits', string>>

const emptyForm: TierForm = {
  name: '',
  description: '',
  price: '',
  interval: 'month',
  benefits: [''],
  isActive: true,
}

export function apiErrorMessage(error: unknown, fallback = 'Une erreur est survenue'): string {
  const message = (error as any)?.response?.data?.message
  if (Array.isArray(message)) return message.join(', ')
  if (typeof message === 'string' && message) return message
  return fallback
}

function parsePrice(value: string): number {
  return Number(value.replace(',', '.').trim())
}

function validate(form: TierForm): TierFormErrors {
  const errors: TierFormErrors = {}
  const name = form.name.trim()
  if (!name) errors.name = 'Le nom est requis'
  else if (name.length > 50) errors.name = '50 caractères maximum'

  if (form.description.length > 500) errors.description = '500 caractères maximum'

  const rawPrice = form.price.trim()
  const price = parsePrice(rawPrice)
  if (!rawPrice) errors.price = 'Le prix est requis (0 pour une offre gratuite)'
  else if (!Number.isFinite(price) || price < 0) errors.price = 'Prix invalide'
  else if (!/^\d+([.,]\d{1,2})?$/.test(rawPrice)) errors.price = 'Format invalide (ex. 9,99, deux décimales maximum)'
  else if (price > 0 && price < MIN_PAID_PRICE) errors.price = `Minimum ${formatEuros(MIN_PAID_PRICE)} pour une offre payante`
  else if (price > MAX_PRICE) errors.price = `Maximum ${formatEuros(MAX_PRICE)}`

  const benefits = form.benefits.map((b) => b.trim()).filter(Boolean)
  if (benefits.length > MAX_BENEFITS) errors.benefits = `${MAX_BENEFITS} avantages maximum`
  else if (benefits.some((b) => b.length > 100)) errors.benefits = '100 caractères maximum par avantage'

  return errors
}

function intervalLabel(interval: string) {
  return interval === 'year' ? 'an' : 'mois'
}

interface TierManagerProps {
  tiers: CreatorTier[]
}

export function TierManager({ tiers }: TierManagerProps) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTier, setEditingTier] = useState<CreatorTier | null>(null)
  const [form, setForm] = useState<TierForm>(emptyForm)
  const [errors, setErrors] = useState<TierFormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pendingTierId, setPendingTierId] = useState<string | null>(null)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: MY_TIERS_QUERY_KEY })
    queryClient.invalidateQueries({ queryKey: ['creator-subscribers'] })
    // Tiers shown on the public profile
    queryClient.invalidateQueries({ queryKey: ['creator-tiers'] })
  }

  const saveMutation = useMutation({
    mutationFn: async ({ tierId, values }: { tierId?: string; values: TierForm }) => {
      const payload = {
        name: values.name.trim(),
        description: values.description.trim(),
        price: Math.round(parsePrice(values.price) * 100) / 100,
        interval: values.interval,
        benefits: values.benefits.map((b) => b.trim()).filter(Boolean),
        isActive: values.isActive,
      }
      const response = tierId
        ? await subscriptionsApi.updateTier(tierId, payload)
        : await subscriptionsApi.createTier({ ...payload, currency: 'EUR' })
      return response.data
    },
    onSuccess: (_data, { tierId }) => {
      refresh()
      setDialogOpen(false)
      toast({
        title: tierId ? 'Offre mise à jour' : 'Offre créée',
        description: tierId ? 'Les modifications ont été enregistrées.' : 'Votre nouvelle offre est en ligne.',
      })
    },
    onError: (error) => setSubmitError(apiErrorMessage(error, "Impossible d'enregistrer l'offre")),
  })

  const toggleMutation = useMutation({
    mutationFn: async (tier: CreatorTier) => {
      await subscriptionsApi.updateTier(tier.id, { isActive: !tier.isActive })
    },
    onMutate: (tier) => setPendingTierId(tier.id),
    onSuccess: (_data, tier) => {
      refresh()
      toast({
        title: tier.isActive ? 'Offre désactivée' : 'Offre activée',
        description: tier.isActive
          ? `« ${tier.name} » n'est plus proposée aux nouveaux abonnés.`
          : `« ${tier.name} » est de nouveau proposée sur votre profil.`,
      })
    },
    onError: (error) =>
      toast({ title: 'Erreur', description: apiErrorMessage(error, "Impossible de modifier l'offre"), variant: 'destructive' }),
    onSettled: () => setPendingTierId(null),
  })

  const deleteMutation = useMutation({
    mutationFn: async (tier: CreatorTier) => {
      await subscriptionsApi.deleteTier(tier.id)
    },
    onMutate: (tier) => setPendingTierId(tier.id),
    onSuccess: (_data, tier) => {
      refresh()
      toast({ title: 'Offre supprimée', description: `« ${tier.name} » a été supprimée.` })
    },
    onError: (error) =>
      toast({
        title: 'Suppression impossible',
        description: apiErrorMessage(error, "Impossible de supprimer l'offre"),
        variant: 'destructive',
      }),
    onSettled: () => setPendingTierId(null),
  })

  const openCreate = () => {
    setEditingTier(null)
    setForm(emptyForm)
    setErrors({})
    setSubmitError(null)
    setDialogOpen(true)
  }

  const openEdit = (tier: CreatorTier) => {
    setEditingTier(tier)
    setForm({
      name: tier.name,
      description: tier.description || '',
      price: Number(tier.price).toFixed(2).replace('.', ','),
      interval: tier.interval === 'year' ? 'year' : 'month',
      benefits: tier.benefits.length > 0 ? [...tier.benefits] : [''],
      isActive: tier.isActive,
    })
    setErrors({})
    setSubmitError(null)
    setDialogOpen(true)
  }

  const updateField = <K extends keyof TierForm>(key: K, value: TierForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (key in errors) setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const nextErrors = validate(form)
    setErrors(nextErrors)
    setSubmitError(null)
    if (Object.values(nextErrors).some(Boolean)) return
    saveMutation.mutate({ tierId: editingTier?.id, values: form })
  }

  const handleToggle = async (tier: CreatorTier) => {
    if (tier.isActive) {
      const ok = await confirm({
        title: `Désactiver l'offre « ${tier.name} » ?`,
        description:
          tier.subscribersCount > 0
            ? `Elle ne sera plus proposée aux nouveaux fans. Ses ${tier.subscribersCount} abonné(s) actuel(s) gardent leur abonnement jusqu'à ce qu'ils le résilient.`
            : 'Elle ne sera plus proposée sur votre profil. Vous pourrez la réactiver à tout moment.',
        confirmText: 'Désactiver',
        variant: 'destructive',
      })
      if (!ok) return
    }
    toggleMutation.mutate(tier)
  }

  const handleDelete = async (tier: CreatorTier) => {
    if (!tier.canDelete) {
      const reason =
        tier.subscribersCount > 0
          ? `Elle compte ${tier.subscribersCount} abonné(s) actif(s).`
          : `Elle est liée à ${tier.totalSubscriptionsCount} ancien(s) abonnement(s), conservés pour votre historique.`
      if (!tier.isActive) {
        toast({
          title: 'Suppression impossible',
          description: `${reason} L'offre est déjà désactivée et n'apparaît plus sur votre profil.`,
        })
        return
      }
      const deactivate = await confirm({
        title: `Impossible de supprimer « ${tier.name} »`,
        description: `${reason} Vous pouvez la désactiver pour qu'elle ne soit plus proposée aux nouveaux fans.`,
        confirmText: 'Désactiver',
        cancelText: 'Fermer',
      })
      if (deactivate) toggleMutation.mutate(tier)
      return
    }

    const ok = await confirm({
      title: `Supprimer l'offre « ${tier.name} » ?`,
      description: 'Cette action est définitive.',
      confirmText: 'Supprimer',
      variant: 'destructive',
    })
    if (ok) deleteMutation.mutate(tier)
  }

  const saving = saveMutation.isPending
  const editingHasSubscribers = !!editingTier && editingTier.subscribersCount > 0
  const pricingChanged =
    !!editingTier &&
    (parsePrice(form.price) !== Number(editingTier.price) || form.interval !== editingTier.interval)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Les offres actives sont proposées sur votre profil public, de la moins chère à la plus chère.
        </p>
        <Button onClick={openCreate} className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle offre
        </Button>
      </div>

      {tiers.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tiers.map((tier) => {
            const busy = pendingTierId === tier.id
            return (
              <Card key={tier.id} className={tier.isActive ? '' : 'opacity-75'}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-xl break-words">{tier.name}</CardTitle>
                    {tier.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </div>
                  <CardDescription>{tier.description || 'Aucune description'}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-3xl font-bold">
                      {Number(tier.price) === 0 ? 'Gratuit' : formatEuros(tier.price)}
                    </p>
                    {Number(tier.price) > 0 && (
                      <p className="text-sm text-muted-foreground">
                        par {intervalLabel(tier.interval)}
                        {tier.interval === 'year' && ` (${formatEuros(Number(tier.price) / 12)}/mois)`}
                      </p>
                    )}
                  </div>

                  {tier.benefits.length > 0 && (
                    <ul className="space-y-1 text-sm">
                      {tier.benefits.map((benefit, index) => (
                        <li key={index} className="flex items-start">
                          <CheckCircle className="h-4 w-4 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
                          <span className="break-words">{benefit}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="pt-2 border-t space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Abonnés actifs</span>
                      <span className="font-semibold">{tier.subscribersCount}</span>
                    </div>
                    {Number(tier.price) > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Revenus/mois</span>
                        <span className="font-semibold">{formatEuros(tier.monthlyRevenue)}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(tier)} disabled={busy}>
                    <Edit className="h-3 w-3 mr-1" />
                    Modifier
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleToggle(tier)}
                    disabled={busy}
                  >
                    {busy && toggleMutation.isPending ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : tier.isActive ? (
                      <EyeOff className="h-3 w-3 mr-1" />
                    ) : (
                      <Eye className="h-3 w-3 mr-1" />
                    )}
                    {tier.isActive ? 'Désactiver' : 'Activer'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(tier)}
                    disabled={busy}
                    aria-label={`Supprimer l'offre ${tier.name}`}
                    title={tier.canDelete ? 'Supprimer' : "Cette offre a des abonnés : elle ne peut qu'être désactivée"}
                  >
                    {busy && deleteMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3 text-destructive" />
                    )}
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="font-medium">Aucune offre d&apos;abonnement</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Créez votre première offre pour permettre aux fans de s&apos;abonner.
            </p>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Créer votre première offre
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => !saving && setDialogOpen(open)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editingTier ? "Modifier l'offre" : 'Nouvelle offre'}</DialogTitle>
              <DialogDescription>
                Définissez le prix, la période et les avantages de cette offre d&apos;abonnement.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="tier-name">
                Nom <span className="text-destructive">*</span>
              </Label>
              <Input
                id="tier-name"
                placeholder="Essentiel, Premium, VIP..."
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                maxLength={50}
                aria-invalid={!!errors.name}
              />
              {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="tier-description">Description</Label>
              <Textarea
                id="tier-description"
                placeholder="Décrivez ce qu'inclut cette offre..."
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                maxLength={500}
                rows={3}
              />
              {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tier-price">
                  Prix (€) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="tier-price"
                  type="text"
                  inputMode="decimal"
                  placeholder="9,99"
                  value={form.price}
                  onChange={(e) => updateField('price', e.target.value)}
                  aria-invalid={!!errors.price}
                />
                {errors.price ? (
                  <p className="text-sm text-destructive">{errors.price}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">0 pour une offre gratuite</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="tier-interval">Période</Label>
                <Select
                  value={form.interval}
                  onValueChange={(value) => updateField('interval', value as TierForm['interval'])}
                >
                  <SelectTrigger id="tier-interval">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Mensuel</SelectItem>
                    <SelectItem value="year">Annuel</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {editingHasSubscribers && pricingChanged && (
              <p className="text-sm rounded-md bg-muted p-3">
                Le nouveau tarif s&apos;appliquera aux nouveaux abonnés. Les {editingTier?.subscribersCount} abonné(s)
                actuel(s) conservent leur tarif actuel.
              </p>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Avantages</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => updateField('benefits', [...form.benefits, ''])}
                  disabled={form.benefits.length >= MAX_BENEFITS}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Ajouter
                </Button>
              </div>
              <div className="space-y-2">
                {form.benefits.map((benefit, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder={`Avantage ${index + 1}`}
                      value={benefit}
                      onChange={(e) =>
                        updateField(
                          'benefits',
                          form.benefits.map((b, i) => (i === index ? e.target.value : b)),
                        )
                      }
                      maxLength={100}
                      aria-label={`Avantage ${index + 1}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Retirer l'avantage ${index + 1}`}
                      onClick={() =>
                        updateField(
                          'benefits',
                          form.benefits.length > 1 ? form.benefits.filter((_, i) => i !== index) : [''],
                        )
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              {errors.benefits && <p className="text-sm text-destructive">{errors.benefits}</p>}
            </div>

            <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={form.isActive}
                onChange={(e) => updateField('isActive', e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium">Offre active</span>
                <span className="block text-sm text-muted-foreground">
                  Proposée aux fans sur votre profil public
                </span>
              </span>
            </label>

            {submitError && (
              <p className="text-sm text-destructive rounded-md bg-destructive/10 p-3" role="alert">
                {submitError}
              </p>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                Annuler
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingTier ? 'Enregistrer' : "Créer l'offre"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
