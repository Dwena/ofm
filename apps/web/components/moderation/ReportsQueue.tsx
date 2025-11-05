'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, XCircle, AlertTriangle, Clock } from 'lucide-react';
import axios from 'axios';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Report {
  id: string;
  reporterId: string;
  reporter: {
    id: string;
    username: string;
    displayName: string;
    avatar: string;
  };
  reportedType: string;
  reportedId: string;
  reason: string;
  description: string;
  status: string;
  createdAt: string;
  reportedEntity: any;
}

export function ReportsQueue() {
  const [statusFilter, setStatusFilter] = useState('pending');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [resolution, setResolution] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [action, setAction] = useState<'RESOLVE' | 'DISMISS' | 'ESCALATE'>('RESOLVE');

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch reports
  const { data, isLoading } = useQuery({
    queryKey: ['reports', statusFilter, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (typeFilter !== 'all') params.append('reportedType', typeFilter);

      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL}/moderation/reports/queue?${params}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('access_token')}`,
          },
        }
      );
      return response.data;
    },
  });

  // Handle report mutation
  const handleReportMutation = useMutation({
    mutationFn: async ({ reportId, decision, resolution }: any) => {
      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/moderation/reports/${reportId}/handle`,
        { decision, resolution },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('access_token')}`,
          },
        }
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['moderation-stats'] });
      toast({
        title: 'Signalement traité',
        description: 'Le signalement a été traité avec succès',
      });
      setDialogOpen(false);
      setSelectedReport(null);
      setResolution('');
    },
    onError: () => {
      toast({
        title: 'Erreur',
        description: 'Impossible de traiter le signalement',
        variant: 'destructive',
      });
    },
  });

  const handleReport = (report: Report, actionType: 'RESOLVE' | 'DISMISS' | 'ESCALATE') => {
    setSelectedReport(report);
    setAction(actionType);
    setDialogOpen(true);
  };

  const confirmAction = () => {
    if (!selectedReport || !resolution.trim()) {
      toast({
        title: 'Erreur',
        description: 'Veuillez fournir une explication',
        variant: 'destructive',
      });
      return;
    }

    handleReportMutation.mutate({
      reportId: selectedReport.id,
      decision: action,
      resolution,
    });
  };

  const getReasonBadge = (reason: string) => {
    const colors: Record<string, string> = {
      SPAM: 'bg-yellow-500',
      HARASSMENT: 'bg-red-500',
      HATE_SPEECH: 'bg-red-700',
      NUDITY: 'bg-orange-500',
      VIOLENCE: 'bg-red-600',
      COPYRIGHT: 'bg-blue-500',
      OTHER: 'bg-gray-500',
    };

    return (
      <Badge className={`${colors[reason] || 'bg-gray-500'} text-white`}>
        {reason}
      </Badge>
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-orange-500" />;
      case 'resolved':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'dismissed':
        return <XCircle className="h-4 w-4 text-gray-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    }
  };

  if (isLoading) {
    return <div>Chargement...</div>;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>File d'attente des signalements</CardTitle>
              <CardDescription>
                {data?.pagination.total || 0} signalements au total
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="pending">En attente</SelectItem>
                  <SelectItem value="reviewed">Examiné</SelectItem>
                  <SelectItem value="resolved">Résolu</SelectItem>
                  <SelectItem value="dismissed">Rejeté</SelectItem>
                </SelectContent>
              </Select>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les types</SelectItem>
                  <SelectItem value="USER">Utilisateur</SelectItem>
                  <SelectItem value="CONTENT">Contenu</SelectItem>
                  <SelectItem value="COMMENT">Commentaire</SelectItem>
                  <SelectItem value="MESSAGE">Message</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data?.reports.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Aucun signalement à afficher
              </div>
            ) : (
              data?.reports.map((report: Report) => (
                <Card key={report.id} className="border-l-4 border-l-orange-500">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-4 flex-1">
                        <Avatar>
                          <AvatarImage src={report.reporter.avatar} />
                          <AvatarFallback>
                            {report.reporter.displayName?.[0] || 'U'}
                          </AvatarFallback>
                        </Avatar>

                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {report.reporter.displayName || report.reporter.username}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              a signalé un {report.reportedType.toLowerCase()}
                            </span>
                            {getReasonBadge(report.reason)}
                            {getStatusIcon(report.status)}
                          </div>

                          {report.description && (
                            <p className="text-sm text-muted-foreground">
                              {report.description}
                            </p>
                          )}

                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span>
                              {formatDistanceToNow(new Date(report.createdAt), {
                                addSuffix: true,
                                locale: fr,
                              })}
                            </span>
                            <span>ID: {report.reportedId.slice(0, 8)}...</span>
                          </div>

                          {report.status === 'pending' && (
                            <div className="flex gap-2 pt-2">
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => handleReport(report, 'RESOLVE')}
                              >
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Résoudre
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleReport(report, 'DISMISS')}
                              >
                                <XCircle className="h-4 w-4 mr-1" />
                                Rejeter
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleReport(report, 'ESCALATE')}
                              >
                                <AlertTriangle className="h-4 w-4 mr-1" />
                                Escalader
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Action Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === 'RESOLVE' && 'Résoudre le signalement'}
              {action === 'DISMISS' && 'Rejeter le signalement'}
              {action === 'ESCALATE' && 'Escalader le signalement'}
            </DialogTitle>
            <DialogDescription>
              Veuillez fournir une explication de votre décision.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            placeholder="Explication de la décision..."
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            rows={4}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={confirmAction} disabled={!resolution.trim()}>
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
