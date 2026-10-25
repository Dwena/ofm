'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ExternalLink,
  FileText,
  Info,
  Landmark,
  Loader2,
  Lock,
  Save,
  User,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useToast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'
import { cn, formatDateTime } from '@/lib/utils'
import {
  COUNTRY_OPTIONS,
  TAX_FIELD_LABELS,
  formatIban,
  getFieldErrors,
  taxApi,
  type EntityType,
  type TaxProfile,
  type TaxProfileResponse,
  type TaxProfileUpdate,
  type VatRegime,
} from '@/lib/tax'

interface FormState {
  entityType: EntityType
  firstName: string
  lastName: string
  dateOfBirth: string
  placeOfBirth: string
  companyName: string
  companyRegistrationNumber: string
  vatNumber: string
  vatRegime: VatRegime
  addressLine1: string
  addressLine2: string
  postalCode: string
  city: string
  country: string
  taxIdentificationNumber: string
  tinCountry: string
  tinNotIssued: boolean
  accountHolderName: string
  iban: string
  bic: string
  selfBillingAccepted: boolean
}

const TEXT_KEYS = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'placeOfBirth',
  'companyName',
  'companyRegistrationNumber',
  'vatNumber',
  'addressLine1',
  'addressLine2',
  'postalCode',
  'city',
  'country',
  'taxIdentificationNumber',
  'tinCountry',
  'accountHolderName',
  'bic',
] as const

function toForm(profile: TaxProfile): FormState {
  const form = {
    entityType: profile.entityType,
    vatRegime: profile.vatRegime,
    tinNotIssued: profile.tinNotIssued,
    selfBillingAccepted: profile.selfBillingAccepted,
    iban: '',
  } as FormState
  for (const key of TEXT_KEYS) form[key] = profile[key] ?? ''
  return form
}

function toPayload(form: FormState): TaxProfileUpdate {
  const payload: TaxProfileUpdate = {
    entityType: form.entityType,
    vatRegime: form.vatRegime,
    tinNotIssued: form.tinNotIssued,
    selfBillingAccepted: form.selfBillingAccepted,
    // Empty: the saved account is kept
    iban: form.iban.replace(/\s+/g, ''),
  }
  for (const key of TEXT_KEYS) payload[key] = form[key].trim() || null
  return payload
}

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

function Field({
  id,
  label,
  error,
  hint,
  required,
  children,
  className,
}: {
  id: string
  label: string
  error?: string
  hint?: ReactNode
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

function CountrySelect({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
}) {
  const known = COUNTRY_OPTIONS.some((c) => c.code === value)
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(selectClass, invalid && 'border-destructive')}
      aria-invalid={invalid || undefined}
    >
      <option value="">Choisir...</option>
      {!known && value && <option value={value}>{value}</option>}
      {COUNTRY_OPTIONS.map((country) => (
        <option key={country.code} value={country.code}>
          {country.label}
        </option>
      ))}
    </select>
  )
}

function ChoiceCard({
  selected,
  onSelect,
  icon,
  title,
  description,
}: {
  selected: boolean
  onSelect: () => void
  icon?: ReactNode
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors',
        selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent',
      )}
    >
      {icon && <span className="mt-0.5 text-muted-foreground">{icon}</span>}
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}

export default function TaxProfilePage() {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['tax-profile'],
    queryFn: async () => (await taxApi.getProfile()).data,
  })

  useEffect(() => {
    if (data && !form) setForm(toForm(data.profile))
  }, [data, form])

  const save = useMutation({
    mutationFn: async (payload: TaxProfileUpdate) => (await taxApi.updateProfile(payload)).data,
    onSuccess: (response: TaxProfileResponse) => {
      queryClient.setQueryData(['tax-profile'], response)
      setForm(toForm(response.profile))
      setErrors({})
      toast({
        title: 'Profil fiscal enregistré',
        description: response.status.complete
          ? 'Votre profil est complet : vos virements sont possibles.'
          : 'Complétez les informations manquantes pour débloquer vos virements.',
      })
    },
    onError: (error: any) => {
      const fieldErrors = getFieldErrors(error)
      setErrors(fieldErrors)
      toast({
        title: 'Enregistrement impossible',
        description:
          Object.keys(fieldErrors).length > 0
            ? 'Certaines informations sont invalides : vérifiez les champs signalés.'
            : error?.response?.data?.message ?? 'Une erreur est survenue. Réessayez plus tard.',
        variant: 'destructive',
      })
    },
  })

  if (isLoading || (!form && !isError)) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    )
  }

  if (isError || !data || !form) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 py-12 text-center">
        <p className="text-muted-foreground">Impossible de charger votre profil fiscal.</p>
        <Button variant="outline" onClick={() => refetch()}>
          Réessayer
        </Button>
      </div>
    )
  }

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current))
    if (errors[key]) setErrors(({ [key]: _removed, ...rest }) => rest)
  }

  const text = (key: (typeof TEXT_KEYS)[number] | 'iban') => ({
    id: key,
    value: form[key] as string,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => update(key, event.target.value),
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${key}-error` : undefined,
    className: errors[key] ? 'border-destructive' : undefined,
  })

  const isCompany = form.entityType === 'company'
  const profile = data.profile
  const { status, mandate, information } = data
  const missing = new Set(status.missingFields)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (profile.selfBillingAccepted && !form.selfBillingAccepted) {
      const ok = await confirm({
        title: 'Révoquer le mandat d’autofacturation ?',
        description:
          'Sans ce mandat, FanVIP ne peut plus établir vos factures : vos virements seront bloqués jusqu’à ce que vous l’acceptiez à nouveau.',
        confirmText: 'Révoquer',
        variant: 'destructive',
      })
      if (!ok) return
    }
    save.mutate(toPayload(form))
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-4xl space-y-6" noValidate>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Profil fiscal</h1>
          <p className="mt-2 text-muted-foreground">
            Informations exigées par la réglementation (DAC7) pour vous verser vos revenus et établir vos factures.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/creator/documents">
            <FileText className="mr-2 h-4 w-4" />
            Mes documents
          </Link>
        </Button>
      </div>

      {status.complete ? (
        <Alert className="border-green-600/40 bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-100">
          <CheckCircle2 className="h-4 w-4 !text-green-600" />
          <AlertTitle>Profil complet — virements possibles</AlertTitle>
          <AlertDescription>
            {profile.completedAt ? `Complété le ${formatDateTime(profile.completedAt)}. ` : ''}
            Pensez à le mettre à jour en cas de changement (adresse, compte bancaire, régime de TVA).
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Profil incomplet — vos virements sont bloqués</AlertTitle>
          <AlertDescription>
            <p>Informations manquantes :</p>
            <ul className="mt-1 list-disc pl-5">
              {status.missingFields.map((field) => (
                <li key={field}>{TAX_FIELD_LABELS[field] ?? field}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Seller type */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Vous vendez en tant que</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Type de vendeur">
          <ChoiceCard
            selected={!isCompany}
            onSelect={() => update('entityType', 'individual')}
            icon={<User className="h-5 w-5" />}
            title="Particulier ou micro-entrepreneur"
            description="Vous exercez en votre nom propre."
          />
          <ChoiceCard
            selected={isCompany}
            onSelect={() => update('entityType', 'company')}
            icon={<Building2 className="h-5 w-5" />}
            title="Société"
            description="SASU, EURL, SARL... ou entité étrangère."
          />
        </CardContent>
      </Card>

      {/* Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{isCompany ? 'Société' : 'Identité'}</CardTitle>
          <CardDescription>
            {isCompany
              ? 'Telle qu’elle figure sur l’extrait Kbis (ou le registre de votre pays).'
              : 'Telle qu’elle figure sur votre pièce d’identité.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {isCompany ? (
            <>
              <Field id="companyName" label="Raison sociale" required error={errors.companyName} className="sm:col-span-2">
                <Input {...text('companyName')} autoComplete="organization" />
              </Field>
              <Field
                id="companyRegistrationNumber"
                label={form.country === 'FR' ? 'SIREN ou SIRET' : 'Numéro d’immatriculation'}
                required
                error={errors.companyRegistrationNumber}
              >
                <Input {...text('companyRegistrationNumber')} inputMode={form.country === 'FR' ? 'numeric' : undefined} />
              </Field>
              <div className="hidden sm:block" />
              <Field
                id="firstName"
                label="Prénom du représentant légal"
                error={errors.firstName}
              >
                <Input {...text('firstName')} autoComplete="given-name" />
              </Field>
              <Field id="lastName" label="Nom du représentant légal" error={errors.lastName}>
                <Input {...text('lastName')} autoComplete="family-name" />
              </Field>
            </>
          ) : (
            <>
              <Field id="firstName" label="Prénom(s)" required error={errors.firstName}>
                <Input {...text('firstName')} autoComplete="given-name" />
              </Field>
              <Field id="lastName" label="Nom" required error={errors.lastName}>
                <Input {...text('lastName')} autoComplete="family-name" />
              </Field>
              <Field id="dateOfBirth" label="Date de naissance" required error={errors.dateOfBirth}>
                <Input {...text('dateOfBirth')} type="date" autoComplete="bday" max={new Date().toISOString().slice(0, 10)} />
              </Field>
              <Field
                id="placeOfBirth"
                label="Lieu de naissance (ville, pays)"
                required={form.tinNotIssued}
                error={errors.placeOfBirth}
                hint={form.tinNotIssued ? 'Obligatoire lorsque vous n’avez pas de numéro fiscal.' : undefined}
              >
                <Input {...text('placeOfBirth')} />
              </Field>
              <Field
                id="companyRegistrationNumber"
                label="Numéro SIREN (si micro-entrepreneur)"
                error={errors.companyRegistrationNumber}
                className="sm:col-span-2"
              >
                <Input {...text('companyRegistrationNumber')} inputMode="numeric" />
              </Field>
            </>
          )}
        </CardContent>
      </Card>

      {/* Address */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{isCompany ? 'Siège social' : 'Adresse de résidence'}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="addressLine1" label="Adresse" required error={errors.addressLine1} className="sm:col-span-2">
            <Input {...text('addressLine1')} autoComplete="address-line1" />
          </Field>
          <Field id="addressLine2" label="Complément d’adresse" error={errors.addressLine2} className="sm:col-span-2">
            <Input {...text('addressLine2')} autoComplete="address-line2" />
          </Field>
          <Field id="postalCode" label="Code postal" required error={errors.postalCode}>
            <Input {...text('postalCode')} autoComplete="postal-code" />
          </Field>
          <Field id="city" label="Ville" required error={errors.city}>
            <Input {...text('city')} autoComplete="address-level2" />
          </Field>
          <Field id="country" label="Pays de résidence" required error={errors.country}>
            <CountrySelect
              id="country"
              value={form.country}
              invalid={!!errors.country}
              onChange={(value) => {
                update('country', value)
                if (!form.tinCountry) update('tinCountry', value)
              }}
            />
          </Field>
        </CardContent>
      </Card>

      {/* Tax identification */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Identification fiscale</CardTitle>
          <CardDescription>
            {isCompany
              ? 'Numéro d’identification fiscale de la société, ou à défaut son numéro de TVA intracommunautaire.'
              : 'En France, votre numéro fiscal (13 chiffres) figure en haut de votre avis d’impôt et dans votre espace impots.gouv.fr.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            id="taxIdentificationNumber"
            label={form.tinCountry === 'FR' && !isCompany ? 'Numéro fiscal' : 'Numéro d’identification fiscale (NIF)'}
            required={!form.tinNotIssued && !isCompany}
            error={errors.taxIdentificationNumber}
          >
            <Input {...text('taxIdentificationNumber')} disabled={form.tinNotIssued} />
          </Field>
          <Field id="tinCountry" label="Pays qui a délivré ce numéro" error={errors.tinCountry}>
            <CountrySelect
              id="tinCountry"
              value={form.tinCountry}
              invalid={!!errors.tinCountry}
              onChange={(value) => update('tinCountry', value)}
            />
          </Field>
          {!isCompany && (
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-primary"
                checked={form.tinNotIssued}
                onChange={(event) => update('tinNotIssued', event.target.checked)}
              />
              <span>
                Mon pays de résidence ne délivre pas de numéro d’identification fiscale
                <span className="block text-muted-foreground">Votre lieu de naissance est alors obligatoire.</span>
              </span>
            </label>
          )}
        </CardContent>
      </Card>

      {/* VAT */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Régime de TVA</CardTitle>
          <CardDescription>
            FanVIP vend vos contenus aux fans et vous achète vos prestations : vos factures mensuelles (établies par
            FanVIP en votre nom) portent sur votre part des ventes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Régime de TVA">
            <ChoiceCard
              selected={form.vatRegime === 'franchise'}
              onSelect={() => update('vatRegime', 'franchise')}
              title="Franchise en base de TVA"
              description="Cas général des micro-entrepreneurs sous les seuils : pas de TVA sur vos factures (« TVA non applicable, art. 293 B du CGI »)."
            />
            <ChoiceCard
              selected={form.vatRegime === 'subject'}
              onSelect={() => update('vatRegime', 'subject')}
              title="Assujetti à la TVA"
              description="Vous facturez la TVA (20 % en France) sur votre part, versée en plus par FanVIP, et vous la reversez aux impôts."
            />
          </div>
          <Field
            id="vatNumber"
            label="Numéro de TVA intracommunautaire"
            required={form.vatRegime === 'subject'}
            error={errors.vatNumber}
            hint="Ex. FR12345678901. Si vous êtes établi hors de France, vos factures sont émises sans TVA (autoliquidation par FanVIP)."
          >
            <Input {...text('vatNumber')} />
          </Field>
        </CardContent>
      </Card>

      {/* Bank details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Landmark className="h-5 w-5" />
            Coordonnées bancaires
          </CardTitle>
          <CardDescription>Compte de la zone SEPA sur lequel vos revenus sont versés par virement.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            id="accountHolderName"
            label="Titulaire du compte"
            required
            error={errors.accountHolderName}
            className="sm:col-span-2"
          >
            <Input {...text('accountHolderName')} autoComplete="name" />
          </Field>
          <Field
            id="iban"
            label="IBAN"
            required={!profile.hasIban}
            error={errors.iban}
            hint={
              profile.hasIban ? (
                <>Compte enregistré : •••• {profile.ibanLast4}. Laissez vide pour le conserver.</>
              ) : (
                'Ex. FR76 3000 6000 0112 3456 7890 189'
              )
            }
            className="sm:col-span-2"
          >
            <Input
              {...text('iban')}
              value={form.iban}
              onChange={(event) => update('iban', formatIban(event.target.value))}
              placeholder={profile.hasIban ? `•••• •••• •••• ${profile.ibanLast4 ?? ''}` : undefined}
              autoComplete="off"
              spellCheck={false}
              className={cn('font-mono uppercase', errors.iban && 'border-destructive')}
            />
          </Field>
          <Field
            id="bic"
            label="BIC"
            error={errors.bic}
            hint="Obligatoire pour un compte situé hors de l’Espace économique européen (Suisse, Royaume-Uni, Monaco...)."
          >
            <Input {...text('bic')} className={cn('font-mono uppercase', errors.bic && 'border-destructive')} />
          </Field>
          <p className="flex items-start gap-2 text-xs text-muted-foreground sm:col-span-2">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Votre IBAN est chiffré et n’est plus jamais affiché en entier. Toute modification vous est notifiée par e-mail.
          </p>
        </CardContent>
      </Card>

      {/* Self-billing mandate */}
      <Card className={cn(missing.has('selfBillingAccepted') && 'border-destructive/50')}>
        <CardHeader>
          <CardTitle className="text-xl">Mandat d’autofacturation</CardTitle>
          <CardDescription>Version du {mandate.version}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border bg-muted/40 p-4 text-sm">
            {mandate.text.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-primary"
              checked={form.selfBillingAccepted}
              onChange={(event) => update('selfBillingAccepted', event.target.checked)}
            />
            <span>
              J’accepte le mandat d’autofacturation ci-dessus et autorise FanVIP à émettre mes factures en mon nom et pour
              mon compte.
              {profile.selfBillingAccepted && profile.selfBillingAcceptedAt && (
                <span className="block text-muted-foreground">
                  Accepté le {formatDateTime(profile.selfBillingAcceptedAt)}.
                </span>
              )}
              {!profile.selfBillingAccepted && mandate.acceptedVersion && mandate.acceptedVersion !== mandate.version && (
                <span className="block text-destructive">Le mandat a été mis à jour : merci de l’accepter à nouveau.</span>
              )}
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            Voir aussi les{' '}
            <Link href="/legal/conditions-createurs" className="underline" target="_blank">
              conditions créateurs
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
        {Object.keys(errors).length > 0 && (
          <p className="text-sm text-destructive">Corrigez les champs signalés avant d’enregistrer.</p>
        )}
        <Button type="submit" disabled={save.isPending} size="lg">
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Enregistrer
        </Button>
      </div>

      {/* Tax and social obligations */}
      <Card className="border-blue-500/30 bg-blue-50/60 dark:bg-blue-950/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Info className="h-5 w-5 text-blue-600" />
            Vos obligations fiscales et sociales
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {information.text.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <ul className="space-y-1">
            {information.links.map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-start gap-1 text-primary underline-offset-4 hover:underline"
                >
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </form>
  )
}
