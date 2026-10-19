import { redirect } from 'next/navigation'

// Tier management lives in the "Offres" tab of /creator/subscriptions
export default function SubscriptionTiersPage() {
  redirect('/creator/subscriptions?tab=tiers')
}
