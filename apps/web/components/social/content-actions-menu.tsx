'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Flag, Link2, MoreHorizontal, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import ReportDialog, { ReportTarget } from '@/components/social/report-dialog'
import { copyContentLink } from '@/hooks/use-content-actions'

interface ContentActionsMenuProps {
  content: { id: string; creator: { username: string } }
  isOwner: boolean
  /** Hide "Voir la publication" when already on the detail page */
  showOpen?: boolean
}

export default function ContentActionsMenu({ content, isOwner, showOpen = true }: ContentActionsMenuProps) {
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null)

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Plus d'actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {showOpen && (
            <DropdownMenuItem asChild>
              <Link href={`/content/${content.id}`}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Voir la publication
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href={`/${content.creator.username}`}>
              <UserRound className="h-4 w-4 mr-2" />
              Voir le profil
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copyContentLink(content.id)}>
            <Link2 className="h-4 w-4 mr-2" />
            Copier le lien
          </DropdownMenuItem>
          {!isOwner && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setReportTarget({ type: 'CONTENT', id: content.id })}
              >
                <Flag className="h-4 w-4 mr-2" />
                Signaler
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ReportDialog target={reportTarget} onClose={() => setReportTarget(null)} />
    </>
  )
}
