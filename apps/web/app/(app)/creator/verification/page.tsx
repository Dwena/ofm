'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { AlertCircle, CheckCircle2, Clock, FileCheck, Loader2, Lock, ShieldCheck, Upload, Users } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { contentErrorMessage } from '@/lib/creator-content'
import {
  ACCEPTED_IDENTITY_FILES,
  ACCEPTED_SELFIE_FILES,
  IDENTITY_DOCUMENT_LABELS,
  IdentityDocumentType,
  KYC_STATUS_LABELS,
  STATUS_VARIANT,
  TWO_SIDED_DOCUMENTS,
  documentLabel,
  identityFileError,
  isAdultDate,
  verificationApi,
} from '@/lib/verification'

const formatDate = (value: string) => format(new Date(value), 'd MMMM yyyy', { locale: fr })

function FileField({
  id,
  label,
  hint,
  accept,
  file,
  onChange,
}: {
  id: string
  label: string
  hint?: string
  accept: string
  file: File | null
  onChange: (file: File | null) => void
}) {
  const error = identityFileError(file, accept)
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="file" accept={accept} onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

export default function CreatorVerificationPage() {
  const queryClient = useQueryClient()
  const [documentType, setDocumentType] = useState<IdentityDocumentType>('ID_CARD')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [front, setFront] = useState<File | null>(null)
  const [back, setBack] = useState<File | null>(null)
  const [selfie, setSelfie] = useState<File | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['creator-verification'],
    queryFn: async () => (await verificationApi.getStatus()).data,
  })

  const needsBack = TWO_SIDED_DOCUMENTS.includes(documentType)
  const dobError = !dateOfBirth
    ? 'Indiquez votre date de naissance'
    : !isAdultDate(dateOfBirth)
      ? 'Vous devez avoir au moins 18 ans pour devenir créateur ou créatrice sur FanVIP.'
      : null
  const fileErrors = [
    !front ? 'Ajoutez votre pièce d’identité (recto)' : identityFileError(front),
    needsBack && !back ? 'Ajoutez le verso de votre pièce' : identityFileError(back),
    !selfie ? 'Ajoutez un selfie tenant votre pièce' : identityFileError(selfie, ACCEPTED_SELFIE_FILES),
  ].filter(Boolean) as string[]
  const canSend = !dobError && fileErrors.length === 0

  const submitMutation = useMutation({
    mutationFn: () =>
      verificationApi.submit({
        documentType,
        dateOfBirth,
        documentFront: front!,
        documentBack: back,
        selfie: selfie!,
      }),
    onSuccess: () => {
      toast({ title: 'Documents envoyés', description: 'Notre équipe vérifie votre identité, généralement sous 48 h.' })
      setFront(null)
      setBack(null)
      setSelfie(null)
      setSubmitted(false)
      queryClient.invalidateQueries({ queryKey: ['creator-verification'] })
    },
    onError: (error) => {
      toast({ title: 'Envoi impossible', description: contentErrorMessage(error), variant: 'destructive' })
    },
  })

  if (isLoading || !data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const status = data.kycStatus

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <ShieldCheck className="h-7 w-7" />
          Vérification d’identité
        </h1>
        <p className="mt-2 text-muted-foreground">
          Obligatoire pour publier des contenus, des stories et des lives, et pour percevoir vos revenus.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-lg">Statut</CardTitle>
            <CardDescription>
              {data.kycSubmittedAt ? `Documents envoyés le ${formatDate(data.kycSubmittedAt)}` : 'Aucun document envoyé'}
            </CardDescription>
          </div>
          <Badge variant={STATUS_VARIANT[status]} data-testid="kyc-status">
            {KYC_STATUS_LABELS[status]}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {status === 'VERIFIED' && (
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle>Identité vérifiée</AlertTitle>
              <AlertDescription>
                {data.kycVerifiedAt ? `Vérifiée le ${formatDate(data.kycVerifiedAt)}. ` : ''}
                Vous pouvez publier. Chaque contenu est relu par notre équipe avant sa mise en ligne.
              </AlertDescription>
            </Alert>
          )}
          {(status === 'PENDING' || status === 'UNDER_REVIEW') && (
            <Alert>
              <Clock className="h-4 w-4" />
              <AlertTitle>Vérification en cours</AlertTitle>
              <AlertDescription>
                Nos modérateurs examinent vos documents. Vous serez notifié(e) dès qu’une décision est prise.
              </AlertDescription>
            </Alert>
          )}
          {(status === 'REJECTED' || status === 'RESUBMIT_REQUIRED') && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Vérification refusée</AlertTitle>
              <AlertDescription>
                {data.kycRejectionReason ? `Motif : ${data.kycRejectionReason}. ` : ''}
                Vous pouvez envoyer de nouveaux documents ci-dessous.
              </AlertDescription>
            </Alert>
          )}
          {data.documents.length > 0 && (
            <div className="text-sm text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">Documents reçus</p>
              <ul className="space-y-1">
                {data.documents.map((doc) => (
                  <li key={doc.id} className="flex items-center gap-2">
                    <FileCheck className="h-4 w-4" />
                    {documentLabel(doc)} · {formatDate(doc.createdAt)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {data.canSubmit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Envoyer mes documents</CardTitle>
            <CardDescription>
              Une pièce d’identité officielle en cours de validité et un selfie de vous tenant cette pièce, visage et
              document bien lisibles.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault()
                setSubmitted(true)
                if (canSend) submitMutation.mutate()
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="kyc-document-type">Type de pièce</Label>
                  <Select value={documentType} onValueChange={(value) => setDocumentType(value as IdentityDocumentType)}>
                    <SelectTrigger id="kyc-document-type">
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
                  <Label htmlFor="kyc-dob">Date de naissance</Label>
                  <Input
                    id="kyc-dob"
                    type="date"
                    value={dateOfBirth}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(event) => setDateOfBirth(event.target.value)}
                  />
                  {(submitted || dateOfBirth) && dobError && <p className="text-xs text-red-600">{dobError}</p>}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FileField
                  id="kyc-front"
                  label="Pièce d’identité (recto)"
                  accept={ACCEPTED_IDENTITY_FILES}
                  file={front}
                  onChange={setFront}
                  hint="JPG, PNG, WEBP, HEIC ou PDF, 10 Mo max."
                />
                <FileField
                  id="kyc-back"
                  label={needsBack ? 'Pièce d’identité (verso)' : 'Verso (facultatif)'}
                  accept={ACCEPTED_IDENTITY_FILES}
                  file={back}
                  onChange={setBack}
                />
              </div>
              <FileField
                id="kyc-selfie"
                label="Selfie avec votre pièce d’identité"
                accept={ACCEPTED_SELFIE_FILES}
                file={selfie}
                onChange={setSelfie}
                hint="Photo de vous tenant la pièce à côté de votre visage. JPG, PNG, WEBP ou HEIC."
              />

              {submitted && fileErrors.length > 0 && (
                <ul className="space-y-1 text-sm text-red-600">
                  {fileErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}

              <Button type="submit" disabled={submitMutation.isPending}>
                {submitMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Envoyer pour vérification
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lock className="h-5 w-5" />
            Pourquoi et comment nous utilisons ces documents
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            La loi et les réseaux de cartes bancaires imposent de vérifier l’identité et la majorité de toute personne
            qui publie ou apparaît dans un contenu pour adultes.
          </p>
          <p>
            Vos documents sont stockés chiffrés dans un espace privé, consultables uniquement par l’équipe de modération
            (chaque consultation est tracée), et ne sont jamais visibles par vos fans. Ils sont conservés pendant la
            durée légale requise, puis supprimés.
          </p>
          <p className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            D’autres personnes apparaissent dans vos contenus ?{' '}
            <Link href="/creator/co-performers" className="font-medium text-primary hover:underline">
              Déclarez vos co-participants
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
