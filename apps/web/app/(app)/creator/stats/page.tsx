import { redirect } from 'next/navigation';

/**
 * Former "Statistiques détaillées" page, merged into /creator/analytics
 * (same metrics, period selector and CSV export).
 */
export default function DetailedStatsPage() {
  redirect('/creator/analytics');
}
