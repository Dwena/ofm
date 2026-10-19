/**
 * French message for a failed payment call: API errors (English messages),
 * Stripe.js errors (already localized) or plain errors.
 */
const API_MESSAGES: [RegExp, string | ((match: RegExpMatchArray) => string)][] = [
  [/payments are not configured/i, 'Les paiements ne sont pas encore configurés sur la plateforme.'],
  [/creator payment account is not ready/i, 'Ce créateur n’a pas encore activé les paiements. Réessayez plus tard.'],
  [/minimum tip amount is €?\s*([\d.,]+)/i, (m) => `Le pourboire minimum est de ${m[1].replace('.', ',')} €.`],
  [/does not accept tips/i, 'Ce créateur n’accepte pas les pourboires.'],
  [/cannot tip yourself/i, 'Vous ne pouvez pas vous envoyer un pourboire.'],
  [/cannot subscribe to yourself/i, 'Vous ne pouvez pas vous abonner à vous-même.'],
  [/already subscribed to this tier/i, 'Vous êtes déjà abonné à cette offre.'],
  [/already subscribed to another tier/i, 'Vous êtes déjà abonné à une autre offre de ce créateur : changez d’offre depuis vos abonnements.'],
  [/scheduled for cancellation, resume it/i, 'Votre abonnement est en cours de résiliation : reprenez-le depuis vos abonnements.'],
  [/already scheduled for cancellation/i, 'La résiliation de cet abonnement est déjà programmée.'],
  [/subscription is not active/i, 'Cet abonnement n’est plus actif.'],
  [/update your payment method/i, 'Mettez à jour votre moyen de paiement pour réactiver cet abonnement.'],
  [/only a past-due subscription/i, 'Cet abonnement n’a pas de paiement en retard.'],
  [/no payment to retry/i, 'Aucun paiement à relancer pour cet abonnement.'],
  [/tier not found/i, 'Cette offre n’existe plus.'],
  [/content not found/i, 'Ce contenu n’existe plus.'],
  [/stream not found/i, 'Ce live n’existe plus.'],
  [/creator not found/i, 'Créateur introuvable.'],
  [/stream is over/i, 'Ce live est terminé.'],
  [/not pay-per-view/i, 'Cet élément n’est pas payant.'],
  [/cannot (unlock|buy) your own/i, 'Vous ne pouvez pas acheter votre propre contenu.'],
  [/payment method not found/i, 'Moyen de paiement introuvable.'],
]

export function getPaymentErrorMessage(error: any, fallback = 'Une erreur est survenue lors du paiement.'): string {
  const raw = error?.response?.data?.message ?? error?.message
  const message = Array.isArray(raw) ? raw.join(', ') : raw
  if (!message || typeof message !== 'string') return fallback

  for (const [pattern, translation] of API_MESSAGES) {
    const match = message.match(pattern)
    if (match) return typeof translation === 'string' ? translation : translation(match)
  }
  if (error?.response?.status >= 500) return fallback
  return message
}
