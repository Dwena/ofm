'use client'

import { ExternalLink, FileText, Lock } from 'lucide-react'
import { IdentityDocumentInfo, documentLabel } from '@/lib/verification'
import { formatDateTime } from '@/components/admin/admin-shared'

/**
 * Identity documents shown to moderators through short-lived signed URLs.
 * Every opening of this view is written to the audit log by the API.
 */
export function IdentityDocumentsViewer({
  documents,
  expiresInSeconds,
}: {
  documents: IdentityDocumentInfo[]
  expiresInSeconds?: number
}) {
  if (documents.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun document au dossier.</p>
  }

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5" />
        Documents confidentiels : consultation journalisée
        {expiresInSeconds ? `, liens valables ${Math.round(expiresInSeconds / 60)} min` : ''}. Ne pas télécharger ni
        partager.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {documents.map((doc) => (
          <figure key={doc.id} className="overflow-hidden rounded-lg border">
            {doc.url && doc.mimeType.startsWith('image/') ? (
              <a href={doc.url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={doc.url}
                  alt={documentLabel(doc)}
                  className="h-56 w-full bg-muted object-contain"
                  referrerPolicy="no-referrer"
                />
              </a>
            ) : (
              <a
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-56 flex-col items-center justify-center gap-2 bg-muted text-sm text-primary hover:underline"
              >
                <FileText className="h-8 w-8" />
                Ouvrir le PDF
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
              <span className="font-medium">{documentLabel(doc)}</span>
              <span className="text-muted-foreground">{formatDateTime(doc.createdAt)}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}
