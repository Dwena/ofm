# Infrastructure de Base de Données - OFM Platform

## Vue d'ensemble

Ce document décrit l'infrastructure complète de gestion de la base de données PostgreSQL pour la plateforme OFM, incluant les migrations, le seed data, les backups automatiques, et le monitoring des performances.

---

## 📊 Seed Data pour le Développement

### Description

Le fichier `apps/api/prisma/seed.ts` contient un ensemble complet de données de test pour faciliter le développement et les tests.

### Données Créées

#### Utilisateurs (7 comptes)
- **1 Admin**: admin@ofm.com
- **3 Créateurs**:
  - creator@demo.com (Alice Martin - Lifestyle/Voyage)
  - creator2@demo.com (Bob Dupont - Fitness)
  - creator3@demo.com (Charlotte Leclerc - Art Digital)
- **2 Abonnés**:
  - subscriber@demo.com (David Bernard)
  - subscriber2@demo.com (Emma Petit)

#### Contenu
- 5 publications (photos et vidéos)
- 6 likes
- 5 commentaires
- 3 stories (avec expiration 24h)

#### Abonnements
- 5 paliers d'abonnement (Bronze, Silver, Basic, Pro, Fan)
- 3 abonnements actifs

#### Transactions
- 4 transactions complétées (abonnements et tips)

### Utilisation

```bash
# Réinitialiser et populer la base de données
cd apps/api
npm run prisma:seed

# Ou avec Prisma directement
npx prisma db seed
```

### Comptes de Test

Tous les comptes utilisent le mot de passe: `SecurePass123!`

```
Admin:        admin@ofm.com
Créateur 1:   creator@demo.com
Créateur 2:   creator2@demo.com
Créateur 3:   creator3@demo.com
Abonné 1:     subscriber@demo.com
Abonné 2:     subscriber2@demo.com
```

---

## 💾 Système de Backup Automatique

### Scripts Disponibles

#### 1. Script de Backup (`apps/api/scripts/backup-database.sh`)

Crée un backup compressé de la base de données PostgreSQL.

**Fonctionnalités**:
- Extraction automatique des credentials depuis DATABASE_URL
- Compression gzip des backups
- Nettoyage automatique des anciens backups
- Logs détaillés du processus

**Utilisation**:

```bash
# Backup manuel
cd apps/api/scripts
chmod +x backup-database.sh
DATABASE_URL="postgresql://user:pass@host:5432/db" ./backup-database.sh

# Avec configuration personnalisée
BACKUP_DIR="/custom/path" RETENTION_DAYS=14 ./backup-database.sh
```

**Configuration**:
- `BACKUP_DIR`: Répertoire des backups (défaut: `/var/backups/ofm-database`)
- `RETENTION_DAYS`: Nombre de jours de rétention (défaut: 7)

#### 2. Setup Cron (`apps/api/scripts/setup-backup-cron.sh`)

Configure un job cron pour automatiser les backups.

**Utilisation**:

```bash
cd apps/api/scripts
chmod +x setup-backup-cron.sh
./setup-backup-cron.sh
```

**Planifications Disponibles**:
1. Quotidien à 2h00
2. Quotidien à 3h00
3. Toutes les 12h (2h et 14h)
4. Toutes les 6h
5. Chaque heure
6. Expression cron personnalisée

**Vérification**:

```bash
# Voir les crons actifs
crontab -l

# Voir les logs de backup
tail -f /var/log/ofm-backup.log
```

#### 3. Script de Restauration (`apps/api/scripts/restore-database.sh`)

Restaure un backup de la base de données.

**Fonctionnalités**:
- Liste interactive des backups disponibles
- Confirmation obligatoire avant restauration
- Décompression automatique
- Statistiques post-restauration

**Utilisation**:

```bash
cd apps/api/scripts
chmod +x restore-database.sh
DATABASE_URL="postgresql://user:pass@host:5432/db" ./restore-database.sh
```

**⚠️ ATTENTION**: La restauration écrase toutes les données existantes!

---

## 📈 Monitoring des Performances

### Service de Monitoring

Le `DatabaseMonitorService` collecte automatiquement des métriques de performance PostgreSQL.

#### Métriques Disponibles

1. **Statistiques des Tables**
   - Nombre de lignes
   - Taille totale, taille de la table, taille des index
   - Derniers VACUUM et ANALYZE

2. **Statistiques de Connexion**
   - Connexions totales/actives/idle
   - Connexions en attente
   - Limite max de connexions

3. **Requêtes Lentes**
   - Temps moyen d'exécution
   - Nombre d'appels
   - Temps total (nécessite pg_stat_statements)

4. **Taille de la Base de Données**
   - Taille formatée et en bytes

5. **Utilisation des Index**
   - Nombre de scans d'index
   - Lignes lues
   - Taille des index

6. **Taux de Hit Cache**
   - Pourcentage de hits cache (objectif: > 95%)

#### Endpoints API (Admin seulement)

```bash
# Métriques complètes
GET /admin/database/metrics

# Statistiques des tables
GET /admin/database/metrics/tables

# Statistiques de connexion
GET /admin/database/metrics/connections

# Requêtes lentes
GET /admin/database/metrics/slow-queries

# Taille de la base
GET /admin/database/metrics/size

# Utilisation des index
GET /admin/database/metrics/indexes

# Taux de cache hit
GET /admin/database/metrics/cache-hit-rate

# Index inutilisés
GET /admin/database/metrics/unused-indexes

# Tables avec bloat
GET /admin/database/metrics/table-bloat

# Requêtes bloquantes
GET /admin/database/metrics/blocking-queries

# Statut de santé global
GET /admin/database/health

# Maintenance
POST /admin/database/maintenance/analyze
POST /admin/database/maintenance/vacuum
```

### Health Check Automatique

Un cron s'exécute **toutes les heures** pour vérifier:
- Taux de cache hit (alerte si < 95%)
- Utilisation des connexions (alerte si > 80%)
- Tables avec bloat significatif
- Index inutilisés

**Logs**:

```bash
# Voir les logs de monitoring
tail -f apps/api/logs/application.log | grep DatabaseMonitor
```

### Exemple de Réponse Health Check

```json
{
  "status": "healthy",
  "timestamp": "2025-11-05T20:30:00.000Z",
  "metrics": {
    "databaseSize": "245 MB",
    "cacheHitRate": 98.5,
    "connections": {
      "active": 5,
      "total": 12,
      "max": 100,
      "usagePercent": "12.0"
    },
    "tables": 25
  },
  "issues": [],
  "warnings": [
    {
      "severity": "warning",
      "message": "5 tables with significant bloat",
      "recommendation": "Run VACUUM ANALYZE on affected tables"
    }
  ],
  "recommendations": [
    "Run VACUUM ANALYZE on affected tables"
  ]
}
```

---

## 🔧 Maintenance de la Base de Données

### VACUUM

Récupère l'espace disque des lignes supprimées/modifiées.

```bash
# Via API
curl -X POST http://localhost:3001/admin/database/maintenance/vacuum \
  -H "Authorization: Bearer <admin-token>"

# Via psql
psql -h host -U user -d database -c "VACUUM VERBOSE;"
```

**Quand exécuter**:
- Tables avec > 20% de bloat
- Après suppression massive de données
- Hebdomadairement en maintenance

### ANALYZE

Met à jour les statistiques de la base pour l'optimiseur de requêtes.

```bash
# Via API
curl -X POST http://localhost:3001/admin/database/maintenance/analyze \
  -H "Authorization: Bearer <admin-token>"

# Via psql
psql -h host -U user -d database -c "ANALYZE;"
```

**Quand exécuter**:
- Après insertion/modification massive
- Si les plans de requête sont sous-optimaux
- Quotidiennement ou hebdomadairement

---

## 🚨 Alertes et Seuils

### Seuils Critiques

| Métrique | Seuil Warn | Seuil Critical | Action |
|----------|------------|----------------|--------|
| Cache Hit Rate | < 95% | < 90% | Augmenter shared_buffers |
| Connection Usage | > 80% | > 90% | Configurer pooling |
| Table Bloat | > 5 tables | > 10 tables | Exécuter VACUUM |
| Unused Indexes | > 10 | > 20 | Supprimer index |
| Blocking Queries | > 0 | > 5 | Investiguer immédiatement |

### Notifications

Le système log automatiquement les warnings. Pour des alertes actives, intégrer avec:
- Sentry / Datadog
- Slack / Discord webhooks
- Email (via SendGrid / Mailgun)

---

## 📖 Best Practices

### Performance

1. **Indexes**
   - Créer des index sur les colonnes fréquemment filtrées
   - Supprimer les index inutilisés (0 scans)
   - Utiliser des index composites pour requêtes multi-colonnes

2. **Connection Pooling**
   - Utiliser PgBouncer ou Prisma connection pooling
   - Limiter le nombre de connexions par instance
   - Fermer les connexions inutilisées

3. **Query Optimization**
   - Activer pg_stat_statements pour identifier les requêtes lentes
   - Utiliser EXPLAIN ANALYZE pour optimiser
   - Éviter N+1 queries (utiliser includes/joins)

4. **Caching**
   - Implémenter Redis pour données fréquemment accédées
   - Cache applicatif pour queries coûteuses
   - Utiliser materialized views si approprié

### Backups

1. **Stratégie 3-2-1**
   - 3 copies des données
   - 2 types de médias différents
   - 1 copie hors site

2. **Test de Restauration**
   - Tester la restauration mensuellement
   - Documenter le processus
   - Mesurer le RTO (Recovery Time Objective)

3. **Sécurité**
   - Chiffrer les backups
   - Stocker dans S3/cloud storage
   - Rotation des credentials

### Monitoring

1. **Métriques Clés**
   - Response time (P50, P95, P99)
   - Throughput (req/s)
   - Error rate
   - Resource utilization (CPU, RAM, disk I/O)

2. **Logs**
   - Activer slow query log (> 1s)
   - Logger les erreurs de connexion
   - Analyser les patterns d'accès

3. **Dashboards**
   - Grafana pour visualisation
   - Prometheus pour métriques
   - Alertmanager pour notifications

---

## 🛠️ Troubleshooting

### Problèmes Courants

#### 1. Base de Données Lente

**Symptômes**: Requêtes lentes, timeout

**Diagnostic**:
```bash
# Voir les requêtes actives
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active'
ORDER BY duration DESC;

# Requêtes bloquantes
GET /admin/database/metrics/blocking-queries
```

**Solutions**:
- Optimiser les index
- Exécuter VACUUM ANALYZE
- Augmenter shared_buffers
- Activer query caching

#### 2. Trop de Connexions

**Symptômes**: "too many connections" error

**Diagnostic**:
```bash
GET /admin/database/metrics/connections
```

**Solutions**:
- Implémenter connection pooling
- Augmenter max_connections
- Fermer les connexions inutilisées
- Utiliser PgBouncer

#### 3. Espace Disque Plein

**Symptômes**: Impossible d'insérer de données

**Diagnostic**:
```bash
GET /admin/database/metrics/size
GET /admin/database/metrics/table-bloat
```

**Solutions**:
- Exécuter VACUUM FULL
- Supprimer anciennes données
- Archiver données historiques
- Augmenter la taille du disque

#### 4. Cache Hit Rate Faible

**Symptômes**: Performance dégradée

**Diagnostic**:
```bash
GET /admin/database/metrics/cache-hit-rate
```

**Solutions**:
- Augmenter shared_buffers (25% RAM)
- Optimiser les requêtes fréquentes
- Implémenter Redis cache
- Analyser les patterns d'accès

---

## 📚 Ressources

### PostgreSQL
- [Official Documentation](https://www.postgresql.org/docs/)
- [Performance Tuning](https://wiki.postgresql.org/wiki/Performance_Optimization)
- [pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html)

### Prisma
- [Prisma Documentation](https://www.prisma.io/docs/)
- [Connection Pooling](https://www.prisma.io/docs/guides/performance-and-optimization/connection-management)
- [Best Practices](https://www.prisma.io/docs/guides/performance-and-optimization/query-optimization-performance)

### Outils
- [PgAdmin](https://www.pgadmin.org/) - Interface graphique
- [PgBouncer](https://www.pgbouncer.org/) - Connection pooler
- [pg_activity](https://github.com/dalibo/pg_activity) - Monitoring CLI

---

## 🔐 Sécurité

### Recommandations

1. **Credentials**
   - Utiliser des variables d'environnement
   - Rotation régulière des mots de passe
   - Principe du moindre privilège

2. **Réseau**
   - Limiter l'accès par IP (pg_hba.conf)
   - Utiliser SSL/TLS pour connexions
   - VPC/private subnet en production

3. **Backup**
   - Chiffrement des backups
   - Contrôle d'accès strict
   - Audit logs des restaurations

4. **Audit**
   - Activer l'audit log PostgreSQL
   - Logger toutes les opérations admin
   - Réviser régulièrement les permissions

---

## 📞 Support

Pour toute question ou problème:
1. Consulter cette documentation
2. Vérifier les logs: `/var/log/ofm-backup.log`
3. Analyser les métriques: `GET /admin/database/health`
4. Contacter l'équipe DevOps

---

**Dernière mise à jour**: 2025-11-05
**Mainteneur**: OFM DevOps Team
