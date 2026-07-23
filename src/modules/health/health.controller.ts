import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../auth/decorators/auth.decorators';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

interface HealthCheckResult {
  status: 'ok' | 'error';
  info?: Record<string, unknown>;
  error?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  constructor(
    @InjectDataSource('data')
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Basic health check' })
  @ApiResponse({ status: 200, description: 'Application is healthy' })
  check(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe for Kubernetes' })
  @ApiResponse({ status: 200, description: 'Application is alive' })
  liveness(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Readiness probe — verifies the data database is reachable' })
  @ApiResponse({ status: 200, description: 'Application is ready to accept traffic' })
  @ApiResponse({ status: 503, description: 'Application is not ready (database unreachable)' })
  async readiness(): Promise<HealthCheckResult> {
    try {
      if (!this.dataSource || !this.dataSource.isInitialized) {
        throw new Error('data database not initialized');
      }
      // Run a trivial query to confirm the connection is live (SQLite/Postgres safe).
      await this.dataSource.query('SELECT 1');
      return {
        status: 'ok',
        details: {
          database: { status: 'up' },
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        details: {
          database: { status: 'down', error: message },
        },
      };
    }
  }
}
