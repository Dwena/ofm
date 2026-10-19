import { redirect } from 'next/navigation'

// Merged into /payments (same transaction history, with filters and refunds)
export default function TransactionsPage() {
  redirect('/payments')
}
