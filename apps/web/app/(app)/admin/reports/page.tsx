'use client'

import { ReportsQueue } from '@/components/admin/reports-queue'
import { AlertTriangle } from 'lucide-react'

export default function AdminReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <AlertTriangle className="h-7 w-7" />
          Signalements
        </h1>
        <p className="text-muted-foreground mt-1">
          Traitez les signalements des utilisateurs et appliquez les sanctions
        </p>
      </div>

      <ReportsQueue />
    </div>
  )
}
