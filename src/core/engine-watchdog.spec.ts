/**
 * EngineWatchdog — memory cull path proof
 *
 * Simulates 12 sessions (8 READY, 4 non-READY) with process RSS above the
 * memory limit. Verifies the watchdog culled the oldest non-READY session.
 */

import { EngineWatchdogService } from './engine-watchdog.service';
import { SessionService } from '../modules/session/session.service';
import { EngineStatus } from '../engine/interfaces/whatsapp-engine.interface';
import { ConfigService } from '@nestjs/config';

function makeSnapshotEntry(
  id: string,
  status: EngineStatus,
  sinceMs: number,
) {
  return { id, status, sinceMs };
}

describe('EngineWatchdogService — memory cull path', () => {
  let watchdog: EngineWatchdogService;
  let mockSessionService: jest.Mocked<Partial<SessionService>>;
  let mockConfig: jest.Mocked<Partial<ConfigService>>;

  beforeEach(() => {
    mockSessionService = {
      getActiveEngineSnapshot: jest.fn(),
      restartEngine: jest.fn().mockResolvedValue(undefined),
    };

    mockConfig = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'WATCHDOG_STUCK_THRESHOLD_MS': return '90000';
          case 'WATCHDOG_MEMORY_LIMIT_MB': return '1024';
          case 'WATCHDOG_MAX_ATTEMPTS': return '3';
          case 'WATCHDOG_ATTEMPT_WINDOW_MS': return '600000';
          default: return undefined;
        }
      }),
    };

    watchdog = new EngineWatchdogService(
      mockConfig as ConfigService,
      mockSessionService as SessionService,
    );
  });

  it('culled the oldest non-READY session when RSS exceeds memory limit', async () => {
    // 12 sessions: 8 READY, 4 non-READY with increasing sinceMs (oldest = lowest sinceMs)
    const snapshot = [
      makeSnapshotEntry('sess-1', EngineStatus.INITIALIZING, 300_000),  // oldest non-READY
      makeSnapshotEntry('sess-2', EngineStatus.DISCONNECTED, 200_000),
      makeSnapshotEntry('sess-3', EngineStatus.QR_READY, 100_000),
      makeSnapshotEntry('sess-4', EngineStatus.INITIALIZING, 50_000),   // newest non-READY
      makeSnapshotEntry('sess-5', EngineStatus.READY, 400_000),
      makeSnapshotEntry('sess-6', EngineStatus.READY, 400_000),
      makeSnapshotEntry('sess-7', EngineStatus.READY, 400_000),
      makeSnapshotEntry('sess-8', EngineStatus.READY, 400_000),
      makeSnapshotEntry('sess-9', EngineStatus.READY, 400_000),
      makeSnapshotEntry('sess-10', EngineStatus.READY, 400_000),
      makeSnapshotEntry('sess-11', EngineStatus.READY, 400_000),
      makeSnapshotEntry('sess-12', EngineStatus.READY, 400_000),
    ];
    mockSessionService.getActiveEngineSnapshot!.mockReturnValue(snapshot);

    // Fake process.memoryUsage().rss to exceed 1024 MB limit
    const origMemUsage = process.memoryUsage;
    process.memoryUsage = jest.fn().mockReturnValue({ rss: 2 * 1024 * 1024 * 1024 } as any);

    try {
      await watchdog.tick();

      // sess-1 has sinceMs=300_000 (highest among non-READY), so it's the oldest and should be culled
      expect(mockSessionService.restartEngine).toHaveBeenCalledWith('sess-1');
    } finally {
      process.memoryUsage = origMemUsage;
    }
  });

  it('does NOT cull when RSS is below memory limit', async () => {
    const snapshot = [
      makeSnapshotEntry('sess-1', EngineStatus.INITIALIZING, 30_000), // below 90s threshold
      makeSnapshotEntry('sess-2', EngineStatus.READY, 400_000),
    ];
    mockSessionService.getActiveEngineSnapshot!.mockReturnValue(snapshot);

    const origMemUsage = process.memoryUsage;
    process.memoryUsage = jest.fn().mockReturnValue({ rss: 500 * 1024 * 1024 } as any);

    try {
      await watchdog.tick();
      expect(mockSessionService.restartEngine).not.toHaveBeenCalled();
    } finally {
      process.memoryUsage = origMemUsage;
    }
  });

  it('does NOT cull READY sessions even under memory pressure', async () => {
    const snapshot = [
      makeSnapshotEntry('sess-1', EngineStatus.READY, 400_000),
      makeSnapshotEntry('sess-2', EngineStatus.READY, 400_000),
    ];
    mockSessionService.getActiveEngineSnapshot!.mockReturnValue(snapshot);

    const origMemUsage = process.memoryUsage;
    process.memoryUsage = jest.fn().mockReturnValue({ rss: 2 * 1024 * 1024 * 1024 } as any);

    try {
      await watchdog.tick();
      // All READY, no cull target
      expect(mockSessionService.restartEngine).not.toHaveBeenCalled();
    } finally {
      process.memoryUsage = origMemUsage;
    }
  });
});
