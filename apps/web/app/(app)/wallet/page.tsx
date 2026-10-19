'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';

/**
 * Legacy "wallet" route. Creators manage balances and payouts on
 * /creator/earnings; fans have no balance, only their payment history.
 */
export default function WalletPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    router.replace(user?.role === 'CREATOR' ? '/creator/earnings' : '/transactions');
  }, [isLoading, user, router]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
