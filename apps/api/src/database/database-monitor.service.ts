import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';

export interface DatabaseMetrics {
  tableStats: TableStats[];
  connectionStats: ConnectionStats;
  slowQueries: SlowQuery[];
  databaseSize: DatabaseSize;
  indexUsage: IndexUsage[];
  cacheHitRate: number;
  timestamp: Date;
}

export interface TableStats {
  schemaName: string;
  tableName: string;
  rowCount: bigint;
  totalSize: string;
  tableSize: string;
  indexSize: string;
  lastVacuum: Date | null;
  lastAnalyze: Date | null;
}

export interface ConnectionStats {
  total: number;
  active: number;
  idle: number;
  waiting: number;
  maxConnections: number;
}

export interface SlowQuery {
  query: string;
  meanTime: number;
  calls: bigint;
  totalTime: number;
}

export interface DatabaseSize {
  size: string;
  sizeBytes: bigint;
}

export interface IndexUsage {
  schemaName: string;
  tableName: string;
  indexName: string;
  indexScans: bigint;
  rowsRead: bigint;
  indexSize: string;
}

@Injectable()
export class DatabaseMonitorService {
  private readonly logger = new Logger(DatabaseMonitorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get comprehensive database metrics
   */
  async getMetrics(): Promise<DatabaseMetrics> {
    this.logger.log('Collecting database metrics...');

    try {
      const [
        tableStats,
        connectionStats,
        slowQueries,
        databaseSize,
        indexUsage,
        cacheHitRate,
      ] = await Promise.all([
        this.getTableStats(),
        this.getConnectionStats(),
        this.getSlowQueries(),
        this.getDatabaseSize(),
        this.getIndexUsage(),
        this.getCacheHitRate(),
      ]);

      return {
        tableStats,
        connectionStats,
        slowQueries,
        databaseSize,
        indexUsage,
        cacheHitRate,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error('Error collecting database metrics:', error);
      throw error;
    }
  }

  /**
   * Get statistics for all tables
   */
  async getTableStats(): Promise<TableStats[]> {
    const result = await this.prisma.$queryRaw<TableStats[]>`
      SELECT
        schemaname as "schemaName",
        tablename as "tableName",
        n_live_tup as "rowCount",
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as "totalSize",
        pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as "tableSize",
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as "indexSize",
        last_vacuum as "lastVacuum",
        last_analyze as "lastAnalyze"
      FROM pg_stat_user_tables
      ORDER BY n_live_tup DESC
    `;

    return result;
  }

  /**
   * Get connection statistics
   */
  async getConnectionStats(): Promise<ConnectionStats> {
    const [connectionData] = await this.prisma.$queryRaw<any[]>`
      SELECT
        (SELECT count(*) FROM pg_stat_activity) as total,
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active,
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle') as idle,
        (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type IS NOT NULL) as waiting,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as "maxConnections"
    `;

    return {
      total: Number(connectionData.total),
      active: Number(connectionData.active),
      idle: Number(connectionData.idle),
      waiting: Number(connectionData.waiting),
      maxConnections: Number(connectionData.maxConnections),
    };
  }

  /**
   * Get slow queries (requires pg_stat_statements extension)
   */
  async getSlowQueries(limit: number = 10): Promise<SlowQuery[]> {
    try {
      const result = await this.prisma.$queryRaw<SlowQuery[]>`
        SELECT
          query,
          mean_exec_time as "meanTime",
          calls,
          total_exec_time as "totalTime"
        FROM pg_stat_statements
        WHERE query NOT LIKE '%pg_stat_statements%'
        ORDER BY mean_exec_time DESC
        LIMIT ${limit}
      `;

      return result;
    } catch (error) {
      // pg_stat_statements might not be enabled
      this.logger.warn('pg_stat_statements extension not available');
      return [];
    }
  }

  /**
   * Get total database size
   */
  async getDatabaseSize(): Promise<DatabaseSize> {
    const [result] = await this.prisma.$queryRaw<any[]>`
      SELECT
        pg_size_pretty(pg_database_size(current_database())) as size,
        pg_database_size(current_database()) as "sizeBytes"
    `;

    return {
      size: result.size,
      sizeBytes: BigInt(result.sizeBytes),
    };
  }

  /**
   * Get index usage statistics
   */
  async getIndexUsage(): Promise<IndexUsage[]> {
    const result = await this.prisma.$queryRaw<IndexUsage[]>`
      SELECT
        schemaname as "schemaName",
        tablename as "tableName",
        indexname as "indexName",
        idx_scan as "indexScans",
        idx_tup_read as "rowsRead",
        pg_size_pretty(pg_relation_size(indexrelid)) as "indexSize"
      FROM pg_stat_user_indexes
      ORDER BY idx_scan DESC
      LIMIT 20
    `;

    return result;
  }

  /**
   * Get cache hit rate (should be > 95%)
   */
  async getCacheHitRate(): Promise<number> {
    const [result] = await this.prisma.$queryRaw<any[]>`
      SELECT
        round(
          100.0 * sum(blks_hit) / NULLIF(sum(blks_hit) + sum(blks_read), 0),
          2
        ) as cache_hit_rate
      FROM pg_stat_database
      WHERE datname = current_database()
    `;

    return result.cache_hit_rate ? parseFloat(result.cache_hit_rate) : 0;
  }

  /**
   * Get unused indexes (candidates for removal)
   */
  async getUnusedIndexes(): Promise<IndexUsage[]> {
    const result = await this.prisma.$queryRaw<IndexUsage[]>`
      SELECT
        schemaname as "schemaName",
        tablename as "tableName",
        indexname as "indexName",
        idx_scan as "indexScans",
        pg_size_pretty(pg_relation_size(indexrelid)) as "indexSize"
      FROM pg_stat_user_indexes
      WHERE idx_scan = 0
        AND indexrelname NOT LIKE 'pg_toast%'
      ORDER BY pg_relation_size(indexrelid) DESC
    `;

    return result;
  }

  /**
   * Get table bloat (tables that need VACUUM)
   */
  async getTableBloat(): Promise<any[]> {
    const result = await this.prisma.$queryRaw<any[]>`
      SELECT
        schemaname,
        tablename,
        n_dead_tup as dead_tuples,
        n_live_tup as live_tuples,
        round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) as bloat_ratio
      FROM pg_stat_user_tables
      WHERE n_dead_tup > 1000
      ORDER BY bloat_ratio DESC
      LIMIT 10
    `;

    return result;
  }

  /**
   * Monitor database health and log warnings
   * Runs every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async monitorHealth() {
    this.logger.log('Running database health check...');

    try {
      const metrics = await this.getMetrics();

      // Check cache hit rate
      if (metrics.cacheHitRate < 95) {
        this.logger.warn(
          `Low cache hit rate: ${metrics.cacheHitRate}% (should be > 95%)`,
        );
      }

      // Check connections
      const connectionUsage =
        (metrics.connectionStats.total / metrics.connectionStats.maxConnections) * 100;
      if (connectionUsage > 80) {
        this.logger.warn(
          `High connection usage: ${connectionUsage.toFixed(1)}% (${metrics.connectionStats.total}/${metrics.connectionStats.maxConnections})`,
        );
      }

      // Check for bloated tables
      const bloatedTables = await this.getTableBloat();
      if (bloatedTables.length > 0) {
        this.logger.warn(
          `Found ${bloatedTables.length} tables with significant bloat. Consider running VACUUM.`,
        );
      }

      // Check for unused indexes
      const unusedIndexes = await this.getUnusedIndexes();
      if (unusedIndexes.length > 0) {
        this.logger.warn(
          `Found ${unusedIndexes.length} unused indexes. Consider removing them to improve write performance.`,
        );
      }

      this.logger.log('Database health check completed');
      this.logger.log(`Database size: ${metrics.databaseSize.size}`);
      this.logger.log(`Cache hit rate: ${metrics.cacheHitRate}%`);
      this.logger.log(
        `Active connections: ${metrics.connectionStats.active}/${metrics.connectionStats.maxConnections}`,
      );
    } catch (error) {
      this.logger.error('Error during health check:', error);
    }
  }

  /**
   * Run ANALYZE on all tables to update statistics
   */
  async analyze() {
    this.logger.log('Running ANALYZE on all tables...');
    await this.prisma.$executeRaw`ANALYZE`;
    this.logger.log('ANALYZE completed');
  }

  /**
   * Run VACUUM on all tables to reclaim space
   */
  async vacuum() {
    this.logger.log('Running VACUUM on all tables...');
    // Note: VACUUM cannot run inside a transaction
    await this.prisma.$executeRawUnsafe('VACUUM');
    this.logger.log('VACUUM completed');
  }

  /**
   * Get blocking queries
   */
  async getBlockingQueries(): Promise<any[]> {
    const result = await this.prisma.$queryRaw<any[]>`
      SELECT
        blocked_locks.pid AS blocked_pid,
        blocked_activity.usename AS blocked_user,
        blocking_locks.pid AS blocking_pid,
        blocking_activity.usename AS blocking_user,
        blocked_activity.query AS blocked_statement,
        blocking_activity.query AS current_statement_in_blocking_process
      FROM pg_catalog.pg_locks blocked_locks
      JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
      JOIN pg_catalog.pg_locks blocking_locks
        ON blocking_locks.locktype = blocked_locks.locktype
        AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
        AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
        AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
        AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
        AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
        AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
        AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
        AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
        AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
        AND blocking_locks.pid != blocked_locks.pid
      JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
      WHERE NOT blocked_locks.granted
    `;

    return result;
  }
}
