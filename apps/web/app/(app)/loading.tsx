/**
 * Generic page skeleton shown inside the app shell while a route segment loads.
 */
export default function AppLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-live="polite" data-testid="page-loading">
      <span className="sr-only">Chargement...</span>
      <div className="space-y-2">
        <div className="h-8 w-56 max-w-full rounded-md bg-muted" />
        <div className="h-4 w-80 max-w-full rounded-md bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-lg border bg-muted/50" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg border bg-muted/50" />
        ))}
      </div>
    </div>
  )
}
