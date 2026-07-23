/**
 * EngineWatchdog — circuit breaker proof
 *
 * Simulates 4 rapid recovery attempts on the same stuck session within
 * the 10-minute window. Verifies the 4th attempt is SKIPPED (circuit open).
 */

import { EngineWatchdogService } from './engine-watchdog.service';
import { SessionService } from '../modules/session/session.service';
import { EngineStatus } from '../engine/interfaces/whatsapp-engine.interface';
import { ConfigService } from '@nestjs/config';

function makeSnapshotEntry(id: string, status: EngineStatus, sinceMs: number) {
  return { id, status, sinceMs };
}

describe('EngineWatchdogService — circuit breaker', () => {
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
          case 'WATCHDOG_STUCK_THRESHOLD_MS':
            return '90000';
          case 'WATCHDOG_MEMORY_LIMIT_MB':
            return '16384';
          case 'WATCHDOG_MAX_ATTEMPTS':
            return '3';
          case 'WATCHDOG_ATTEMPT_WINDOW_MS':
            return '600000';
          default:
            return undefined;
        }
      }),
    };

    watchdog = new EngineWatchdogService(mockConfig as ConfigService, mockSessionService as SessionService);

    // Fake RSS below memory limit so memory cull doesn't interfere
    const origMemUsage = process.memoryUsage;
    process.memoryUsage = jest.fn().mockReturnValue({ rss: 100 * 1024 * 1024 } as any);
  });

  it('skips the 4th recovery attempt when 3 have already failed within the window', async () => {
    // Session stuck for 5 minutes (well above 90s threshold)
    const stuckSession = makeSnapshotEntry('sess-stuck', EngineStatus.INITIALIZING, 300_000);
    mockSessionService.getActiveEngineSnapshot!.mockReturnValue([stuckSession]);

    // Simulate: restartEngine fails (returns rejected promise)
    mockSessionService.restartEngine!.mockRejectedValue(new Error('engine crash'));

    // Run tick 3 times — each should attempt recovery (and fail)
    await watchdog.tick();
    await watchdog.tick();
    await watchdog.tick();

    // 3 attempts recorded, all failed
    expect(mockSessionService.restartEngine).toHaveBeenCalledTimes(3);

    // 4th tick — circuit should be open, restartEngine NOT called
    await watchdog.tick();
    expect(mockSessionService.restartEngine).toHaveBeenCalledTimes(3); // still 3, not 4
  });

  it('resets attempt counter after the window expires', async () => {
    const stuckSession = makeSnapshotEntry('sess-stuck', EngineStatus.INITIALIZING, 300_000);
    mockSessionService.getActiveEngineSnapshot!.mockReturnValue([stuckSession]);
    mockSessionService.restartEngine!.mockRejectedValue(new Error('engine crash'));

    // Run 3 ticks (fills the circuit)
    await watchdog.tick();
    await watchdog.tick();
    await watchdog.tick();
    expect(mockSessionService.restartEngine).toHaveBeenCalledTimes(3);

    // Force the attempt window to expire by manipulating internal state
    // Access private attempts map and backdate firstAt
    const attemptsMap = (watchdog as any).attempts as Map<string, any>;
    const entry = attemptsMap.get('sess-stuck');
    if (entry) {
      entry.firstAt = Date.now() - 700_000; // 700s ago (> 600s window)
    }

    // 4th tick — should now retry because window expired
    await watchdog.tick();
    expect(mockSessionService.restartEngine).toHaveBeenCalledTimes(4);
  });

  it('clears attempts when session becomes READY', async () => {
    // First: session is stuck, watchdog tries and fails
    const stuckSession = makeSnapshotEntry('sess-recovery', EngineStatus.DISCONNECTED, 300_000);
    mockSessionService.getActiveEngineSnapshot!.mockReturnValue([stuckSession]);
    mockSessionService.restartEngine!.mockRejectedValueOnce(new Error('fail'));

    await watchdog.tick();
    expect(mockSessionService.restartEngine).toHaveBeenCalledTimes(1);

    // Next tick: session is now READY (someone fixed it externally)
    const readySession = makeSnapshotEntry('sess-recovery', EngineStatus.READY, 10_000);
    mockSessionService.getActiveEngineSnapshot!.mockReturnValue([readySession]);
    mockSessionService.restartEngine!.mockReset();

    await watchdog.tick();

    // Attempts should be cleared (ready session with sinceMs > 0 clears it)
    const attemptsMap = (watchdog as any).attempts as Map<string, any>;
    expect(attemptsMap.has('sess-recovery')).toBe(false);
  });
});
