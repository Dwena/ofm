import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DatabaseMonitorService } from './database-monitor.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Database Monitoring')
@Controller('admin/database')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class DatabaseMonitorController {
  constructor(private readonly monitorService: DatabaseMonitorService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Get comprehensive database metrics' })
  @ApiResponse({ status: 200, description: 'Database metrics retrieved successfully' })
  async getMetrics() {
    return this.monitorService.getMetrics();
  }

  @Get('metrics/tables')
  @ApiOperation({ summary: 'Get table statistics' })
  @ApiResponse({ status: 200, description: 'Table statistics retrieved successfully' })
  async getTableStats() {
    return this.monitorService.getTableStats();
  }

  @Get('metrics/connections')
  @ApiOperation({ summary: 'Get connection statistics' })
  @ApiResponse({ status: 200, description: 'Connection statistics retrieved successfully' })
  async getConnectionStats() {
    return this.monitorService.getConnectionStats();
  }

  @Get('metrics/slow-queries')
  @ApiOperation({ summary: 'Get slow queries' })
  @ApiResponse({ status: 200, description: 'Slow queries retrieved successfully' })
  async getSlowQueries() {
    return this.monitorService.getSlowQueries();
  }

  @Get('metrics/size')
  @ApiOperation({ summary: 'Get database size' })
  @ApiResponse({ status: 200, description: 'Database size retrieved successfully' })
  async getDatabaseSize() {
    return this.monitorService.getDatabaseSize();
  }

  @Get('metrics/indexes')
  @ApiOperation({ summary: 'Get index usage statistics' })
  @ApiResponse({ status: 200, description: 'Index usage statistics retrieved successfully' })
  async getIndexUsage() {
    return this.monitorService.getIndexUsage();
  }

  @Get('metrics/cache-hit-rate')
  @ApiOperation({ summary: 'Get cache hit rate' })
  @ApiResponse({ status: 200, description: 'Cache hit rate retrieved successfully' })
  async getCacheHitRate() {
    const rate = await this.monitorService.getCacheHitRate();
    return {
      cacheHitRate: rate,
      status: rate > 95 ? 'good' : rate > 90 ? 'warning' : 'critical',
    };
  }

  @Get('metrics/unused-indexes')
  @ApiOperation({ summary: 'Get unused indexes' })
  @ApiResponse({ status: 200, description: 'Unused indexes retrieved successfully' })
  async getUnusedIndexes() {
    return this.monitorService.getUnusedIndexes();
  }

  @Get('metrics/table-bloat')
  @ApiOperation({ summary: 'Get table bloat information' })
  @ApiResponse({ status: 200, description: 'Table bloat information retrieved successfully' })
  async getTableBloat() {
    return this.monitorService.getTableBloat();
  }

  @Get('metrics/blocking-queries')
  @ApiOperation({ summary: 'Get blocking queries' })
  @ApiResponse({ status: 200, description: 'Blocking queries retrieved successfully' })
  async getBlockingQueries() {
    return this.monitorService.getBlockingQueries();
  }

  @Post('maintenance/analyze')
  @ApiOperation({ summary: 'Run ANALYZE on all tables' })
  @ApiResponse({ status: 200, description: 'ANALYZE completed successfully' })
  async analyze() {
    await this.monitorService.analyze();
    return { message: 'ANALYZE completed successfully' };
  }

  @Post('maintenance/vacuum')
  @ApiOperation({ summary: 'Run VACUUM on all tables' })
  @ApiResponse({ status: 200, description: 'VACUUM completed successfully' })
  async vacuum() {
    await this.monitorService.vacuum();
    return { message: 'VACUUM completed successfully' };
  }

  @Get('health')
  @ApiOperation({ summary: 'Get database health status' })
  @ApiResponse({ status: 200, description: 'Database health status retrieved successfully' })
  async getHealthStatus() {
    const metrics = await this.monitorService.getMetrics();
    const bloatedTables = await this.monitorService.getTableBloat();
    const unusedIndexes = await this.monitorService.getUnusedIndexes();
    const blockingQueries = await this.monitorService.getBlockingQueries();

    const connectionUsage =
      (metrics.connectionStats.total / metrics.connectionStats.maxConnections) * 100;

    const issues = [];
    const warnings = [];

    // Check for issues
    if (metrics.cacheHitRate < 90) {
      issues.push({
        severity: 'critical',
        message: `Low cache hit rate: ${metrics.cacheHitRate}%`,
        recommendation: 'Consider increasing shared_buffers in PostgreSQL configuration',
      });
    } else if (metrics.cacheHitRate < 95) {
      warnings.push({
        severity: 'warning',
        message: `Cache hit rate below optimal: ${metrics.cacheHitRate}%`,
        recommendation: 'Monitor query patterns and consider optimizing frequently accessed data',
      });
    }

    if (connectionUsage > 90) {
      issues.push({
        severity: 'critical',
        message: `Very high connection usage: ${connectionUsage.toFixed(1)}%`,
        recommendation: 'Increase max_connections or implement connection pooling',
      });
    } else if (connectionUsage > 80) {
      warnings.push({
        severity: 'warning',
        message: `High connection usage: ${connectionUsage.toFixed(1)}%`,
        recommendation: 'Monitor connection patterns and consider connection pooling',
      });
    }

    if (bloatedTables.length > 5) {
      warnings.push({
        severity: 'warning',
        message: `${bloatedTables.length} tables with significant bloat`,
        recommendation: 'Run VACUUM ANALYZE on affected tables',
      });
    }

    if (unusedIndexes.length > 10) {
      warnings.push({
        severity: 'warning',
        message: `${unusedIndexes.length} unused indexes found`,
        recommendation: 'Consider removing unused indexes to improve write performance',
      });
    }

    if (blockingQueries.length > 0) {
      issues.push({
        severity: 'critical',
        message: `${blockingQueries.length} blocking queries detected`,
        recommendation: 'Investigate and resolve blocking queries immediately',
      });
    }

    const status =
      issues.length > 0 ? 'unhealthy' : warnings.length > 0 ? 'degraded' : 'healthy';

    return {
      status,
      timestamp: new Date(),
      metrics: {
        databaseSize: metrics.databaseSize.size,
        cacheHitRate: metrics.cacheHitRate,
        connections: {
          active: metrics.connectionStats.active,
          total: metrics.connectionStats.total,
          max: metrics.connectionStats.maxConnections,
          usagePercent: connectionUsage.toFixed(1),
        },
        tables: metrics.tableStats.length,
      },
      issues,
      warnings,
      recommendations: [
        ...issues.map((i) => i.recommendation),
        ...warnings.map((w) => w.recommendation),
      ],
    };
  }
}
