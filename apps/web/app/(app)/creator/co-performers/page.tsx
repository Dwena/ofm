'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { AlertCircle, Loader2, Plus, RotateCcw, Trash2, Upload, Users, X } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'
import { contentErrorMessage } from '@/lib/creator-content'
import {
  ACCEPTED_IDENTITY_FILES,
  ACCEPTED_SELFIE_FILES,
  CO_PERFORMER_STATUS_LABELS,
  CoPerformer,
  IDENTITY_DOCUMENT_LABELS,
  IdentityDocumentType,
  STATUS_VARIANT,
  coPerformerName,
  coPerformersApi,
  identityFileError,
  isAdultDate,
} from '@/lib/verification'

const formatDate = (value: string) => format(new Date(value), 'd MMM yyyy', { locale: fr })
const today = () => new Date().toISOString().slice(0, 10)

interface FormState {
  legalFirstName: string
  legalLastName: string
  stageName: string
  dateOfBirth: string
  email: string
  platformUsername: string
  documentType: IdentityDocumentType
  consentSignedAt: string
  documentFront: File | null
  documentBack: File | null
  releaseForm: File | null
  selfie: File | null
}

const emptyForm = (): FormState => ({
  legalFirstName: '',
  legalLastName: '',
  stageName: '',
  dateOfBirth: '',
  email: '',
  platformUsername: '',
  documentType: 'ID_CARD',
  consentSignedAt: today(),
  documentFront: null,
  documentBack: null,
  releaseForm: null,
  selfie: null,
})

/** Form validation; `editing` = correction of a rejected co-performer (files optional) */
function formErrors(form: FormState, editing: boolean): string[] {
  const errors: string[] = []
  if (!form.legalFirstName.trim() || !form.legalLastName.trim()) errors.push('Nom et prénom légaux requis')
  if (!form.dateOfBirth) errors.push('Date de naissance requise')
  else if (!isAdultDate(form.dateOfBirth)) errors.push('Toute personne apparaissant dans vos contenus doit avoir au moins 18 ans.')
  if (!form.consentSignedAt) errors.push("Date de signature de l'autorisation requise")
  if (!editing && !form.documentFront) errors.push("Pièce d'identité requise")
  if (!editing && !form.releaseForm) errors.push('Autorisation signée requise')
  for (const [file, accept] of [
    [form.documentFront, ACCEPTED_IDENTITY_FILES],
    [form.documentBack, ACCEPTED_IDENTITY_FILES],
    [form.releaseForm, ACCEPTED_IDENTITY_FILES],
    [form.selfie, ACCEPTED_SELFIE_FILES],
  ] as const) {
    const error = identityFileError(file, accept)
    if (error) errors.push(error)
  }
  return errors
}

export default function CoPerformersPage() {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [form, setForm] = useState<FormState | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const { data: coPerformers = [], isLoading } = useQuery({
    queryKey: ['co-performers'],
    queryFn: async () => (await coPerformersApi.list()).data,
  })

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current))

  const closeForm = () => {
    setForm(null)
    setEditingId(null)
    setSubmitted(false)
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const f = form!
      if (editingId) {
        return coPerformersApi.update(editingId, {
          legalFirstName: f.legalFirstName.trim(),
          legalLastName: f.legalLastName.trim(),
          stageName: f.stageName.trim(),
          dateOfBirth: f.dateOfBirth,
          email: f.email.trim(),
          consentSignedAt: f.consentSignedAt,
          ...(f.documentFront || f.documentBack ? { documentType: f.documentType } : {}),
          documentFront: f.documentFront,
          documentBack: f.documentBack,
          releaseForm: f.releaseForm,
          selfie: f.selfie,
        })
      }
      return coPerformersApi.create({
        legalFirstName: f.legalFirstName.trim(),
        legalLastName: f.legalLastName.trim(),
        stageName: f.stageName.trim() || undefined,
        dateOfBirth: f.dateOfBirth,
        email: f.email.trim() || undefined,
        platformUsername: f.platformUsername.trim() || undefined,
        documentType: f.documentType,
        consentSignedAt: f.consentSignedAt,
        documentFront: f.documentFront!,
        documentBack: f.documentBack,
        releaseForm: f.releaseForm!,
        selfie: f.selfie,
      })
    },
    onSuccess: () => {
      toast({ title: editingId ? 'Co-participant renvoyé en vérification' : 'Co-participant déclaré', description: 'Notre équipe vérifie son identité et son autorisation.' })
      closeForm()
      queryClient.invalidateQueries({ queryKey: ['co-performers'] })
    },
    onError: (error) => {
      toast({ title: 'Enregistrement impossible', description: contentErrorMessage(error), variant: 'destructive' })
    },
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => coPerformersApi.remove(id),
    onSuccess: () => {
      toast({ title: 'Co-participant retiré' })
      queryClient.invalidateQueries({ queryKey: ['co-performers'] })
    },
    onError: (error) => {
      toast({ title: 'Suppression impossible', description: contentErrorMessage(error), variant: 'destructive' })
    },
  })

  const startEdit = (coPerformer: CoPerformer) => {
    setEditingId(coPerformer.id)
    setSubmitted(false)
    setForm({
      ...emptyForm(),
      legalFirstName: coPerformer.legalFirstName,
      legalLastName: coPerformer.legalLastName,
      stageName: coPerformer.stageName ?? '',
      dateOfBirth: coPerformer.dateOfBirth.slice(0, 10),
      email: coPerformer.email ?? '',
      consentSignedAt: coPerformer.consentSignedAt.slice(0, 10),
    })
  }

  const remove = async (coPerformer: CoPerformer) => {
    const ok = await confirm({
      title: 'Retirer ce co-participant ?',
      description: `${coPerformerName(coPerformer)} ne pourra plus être ajouté(e) à vos publications. Ses documents sont conservés pendant la durée légale.`,
      confirmText: 'Retirer',
      variant: 'destructive',
    })
    if (ok) removeMutation.mutate(coPerformer.id)
  }

  const errors = form ? formErrors(form, !!editingId) : []

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Users className="h-7 w-7" />
            Co-participants
          </h1>
          <p className="mt-2 text-muted-foreground">
            Toute personne autre que vous apparaissant dans vos contenus doit être majeure, vérifiée et avoir signé une
            autorisation de diffusion.
          </p>
        </div>
        {!form && (
          <Button
            onClick={() => {
              setEditingId(null)
              setSubmitted(false)
              setForm(emptyForm())
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Déclarer une personne
          </Button>
        )}
      </div>

      {form && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">{editingId ? 'Corriger et renvoyer' : 'Nouveau co-participant'}</CardTitle>
              <CardDescription>
                Identité légale telle qu’elle figure sur la pièce d’identité. Les documents ne sont visibles que par
                l’équipe de modération.
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={closeForm} aria-label="Fermer">
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault()
                setSubmitted(true)
                if (errors.length === 0) saveMutation.mutate()
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cp-first">Prénom légal</Label>
                  <Input id="cp-first" value={form.legalFirstName} onChange={(e) => set('legalFirstName', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cp-last">Nom légal</Label>
                  <Input id="cp-last" value={form.legalLastName} onChange={(e) => set('legalLastName', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cp-stage">Nom de scène (facultatif)</Label>
                  <Input id="cp-stage" value={form.stageName} onChange={(e) => set('stageName', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cp-dob">Date de naissance</Label>
                  <Input
                    id="cp-dob"
                    type="date"
                    max={today()}
                    value={form.dateOfBirth}
                    onChange={(e) => set('dateOfBirth', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cp-email">E-mail (facultatif)</Label>
                  <Input id="cp-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
                </div>
                {!editingId && (
                  <div className="space-y-1.5">
                    <Label htmlFor="cp-username">Pseudo FanVIP (facultatif)</Label>
                    <Input
                      id="cp-username"
                      placeholder="@pseudo"
                      value={form.platformUsername}
                      onChange={(e) => set('platformUsername', e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cp-doc-type">Type de pièce d’identité</Label>
                  <Select value={form.documentType} onValueChange={(value) => set('documentType', value as IdentityDocumentType)}>
                    <SelectTrigger id="cp-doc-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(IDENTITY_DOCUMENT_LABELS) as IdentityDocumentType[]).map((type) => (
                        <SelectItem key={type} value={type}>
                          {IDENTITY_DOCUMENT_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cp-consent">Date de signature de l’autorisation</Label>
                  <Input
                    id="cp-consent"
                    type="date"
                    max={today()}
                    value={form.consentSignedAt}
                    onChange={(e) => set('consentSignedAt', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cp-front">Pièce d’identité (recto){editingId ? ' – facultatif' : ''}</Label>
                  <Input id="cp-front" type="file" accept={ACCEPTED_IDENTITY_FILES} onChange={(e) => set('documentFront', e.target.files?.[0] ?? null)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cp-back">Verso (facultatif)</Label>
                  <Input id="cp-back" type="file" accept={ACCEPTED_IDENTITY_FILES} onChange={(e) => set('documentBack', e.target.files?.[0] ?? null)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cp-release">Autorisation signée (PDF ou photo){editingId ? ' – facultatif' : ''}</Label>
                  <Input id="cp-release" type="file" accept={ACCEPTED_IDENTITY_FILES} onChange={(e) => set('releaseForm', e.target.files?.[0] ?? null)} />
                  <p className="text-xs text-muted-foreground">
                    Consentement écrit à être filmé(e) et à la diffusion des contenus sur FanVIP, daté et signé.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cp-selfie">Selfie avec la pièce (facultatif)</Label>
                  <Input id="cp-selfie" type="file" accept={ACCEPTED_SELFIE_FILES} onChange={(e) => set('selfie', e.target.files?.[0] ?? null)} />
                </div>
              </div>

              {submitted && errors.length > 0 && (
                <ul className="space-y-1 text-sm text-red-600">
                  {errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}

              <div className="flex gap-2">
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  {editingId ? 'Renvoyer en vérification' : 'Envoyer pour vérification'}
                </Button>
                <Button type="button" variant="outline" onClick={closeForm}>
                  Annuler
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : coPerformers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Aucun co-participant déclaré. Si vous êtes seul(e) dans vos contenus, rien à faire.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {coPerformers.map((coPerformer) => (
            <Card key={coPerformer.id} data-testid="co-performer-item">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{coPerformerName(coPerformer)}</span>
                    <Badge variant={STATUS_VARIANT[coPerformer.status]}>{CO_PERFORMER_STATUS_LABELS[coPerformer.status]}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {coPerformer.legalFirstName} {coPerformer.legalLastName} · né(e) le {formatDate(coPerformer.dateOfBirth)} ·
                    autorisation signée le {formatDate(coPerformer.consentSignedAt)}
                    {coPerformer.contentCount ? ` · ${coPerformer.contentCount} contenu(s)` : ''}
                  </p>
                  {coPerformer.status === 'REJECTED' && coPerformer.rejectionReason && (
                    <p className="flex items-center gap-1 text-sm text-red-600">
                      <AlertCircle className="h-4 w-4" />
                      Motif du refus : {coPerformer.rejectionReason}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {coPerformer.status !== 'VERIFIED' && (
                    <Button variant="outline" size="sm" onClick={() => startEdit(coPerformer)}>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Corriger
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => remove(coPerformer)} disabled={removeMutation.isPending}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Retirer
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Alert>
        <AlertDescription className="text-sm">
          Seules les personnes <strong>vérifiées</strong> peuvent être ajoutées à un contenu (« Avec d’autres personnes »
          lors de l’<Link href="/creator/upload" className="font-medium text-primary hover:underline">upload</Link>), une story
          ou un live. Publier une personne non déclarée entraîne la suppression du contenu et peut entraîner la fermeture
          du compte.
        </AlertDescription>
      </Alert>
    </div>
  )
}
