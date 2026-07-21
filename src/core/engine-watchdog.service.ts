import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SessionService } from '../modules/session/session.service';
import { EngineStatus } from '../engine/interfaces/whatsapp-engine.interface';

interface EngineAttempt {
  count: number;
  firstAt: number;
  disabledAt?: number;
}

/**
 * EngineWatchdog — memory-aware soft cap + per-session stuck-engine recovery.
 *
 * - Every minute, walks the active engine map.
 * - Sessions stuck in INITIALIZING/QR_READY/AUTHENTICATING/DISCONNECTED for more
 *   than `stuckThresholdMs` (default 90s) get destroy() + reinit()'d.
 * - Per-session circuit-breaker: at most 3 attempts in 10 minutes. After 3 the
 *   session is marked disabled (mark in DB if helpers added later) and the
 *   watchdog stops touching it until restartEngine() is called explicitly.
 * - Memory-aware soft cap: if process RSS > memoryLimitMB, the oldest non-READY
 *   session is culled (destroy() without reinit) to relieve pressure.
 * - All log lines prefix with `WATCHDOG:` so they're easy to grep.
 */
@Injectable()
export class EngineWatchdogService {
  private readonly logger = new Logger('EngineWatchdogService');

  private readonly stuckThresholdMs: number;
  private readonly memoryLimitMB: number;
  private readonly maxAttemptsPerWindow: number;
  private readonly attemptWindowMs: number;

  private readonly attempts = new Map<string, EngineAttempt>();

  constructor(
    private readonly configService: ConfigService,
    private readonly sessionService: SessionService,
  ) {
    const cfg = (key: string, defaultValue: number): number => {
      const raw = this.configService.get<string>(key);
      if (raw === undefined || raw === null || raw === '') return defaultValue;
      const parsed = parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
    };

    // ENV-overridable:
    //   WATCHDOG_STUCK_THRESHOLD_MS  — default 90_000
    //   WATCHDOG_MEMORY_LIMIT_MB     — default: half the host's total memory
    //   WATCHDOG_MAX_ATTEMPTS        — default 3
    //   WATCHDOG_ATTEMPT_WINDOW_MS   — default 600_000 (10 min)
    this.stuckThresholdMs = cfg('WATCHDOG_STUCK_THRESHOLD_MS', 90_000);
    this.maxAttemptsPerWindow = cfg('WATCHDOG_MAX_ATTEMPTS', 3);
    this.attemptWindowMs = cfg('WATCHDOG_ATTEMPT_WINDOW_MS', 600_000);

    // Half of the container's total memory by default. Hosts on free HF have
    // ~16 GB shared; if we want a much softer cap, ops sets
    //   WATCHDOG_MEMORY_LIMIT_MB=8192
    const halfDefault = Math.max(512, Math.floor(osTotalMemMB() / 2));
    this.memoryLimitMB = cfg('WATCHDOG_MEMORY_LIMIT_MB', halfDefault);

    this.logger.log(
      `EngineWatchdog enabled: stuckThresholdMs=${this.stuckThresholdMs} ` +
        `memoryLimitMB=${this.memoryLimitMB} ` +
        `maxAttemptsPerWindow=${this.maxAttemptsPerWindow} ` +
        `attemptWindowMs=${this.attemptWindowMs}`,
    );
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    try {
      const snapshot = this.sessionService.getActiveEngineSnapshot();
      if (snapshot.length === 0) return;

      const rssMB = Math.round(process.memoryUsage().rss / 1024 / 1024);

      // 1. Memory-aware soft cull
      if (rssMB > this.memoryLimitMB) {
        this.logger.warn(
          `WATCHDOG: memory pressure (rss=${rssMB}MB > ${this.memoryLimitMB}MB); will cull the oldest non-READY session`,
        );
        const cullTarget = snapshot
          .filter(s => s.status !== EngineStatus.READY)
          .sort((a, b) => b.sinceMs - a.sinceMs)[0];
        if (cullTarget) {
          try {
            await this.sessionService.restartEngine(cullTarget.id);
            this.logger.log(
              `WATCHDOG: culled session ${cullTarget.id} (status=${cullTarget.status}, sinceMs=${cullTarget.sinceMs})`,
            );
            this.recordAttempt(cullTarget.id);
          } catch (err) {
            this.logger.error(
              `WATCHDOG: cull of session ${cullTarget.id} failed: ${String(err)}`,
            );
          }
        }
      }

      // 2. Per-session stuck recovery
      for (const engine of snapshot) {
        if (engine.status === EngineStatus.READY) {
          // Healthy — clear any prior failed-recovery attempts once we've
          // seen it READY for at least one watchdog tick. Doing this lazily
          // gives operators a chance to see warning history before reset.
          if (this.getAttemptCount(engine.id) > 0 && engine.sinceMs > 0) {
            this.attempts.delete(engine.id);
          }
          continue;
        }
        if (engine.sinceMs < this.stuckThresholdMs) continue;
        if (this.isCircuitOpen(engine.id)) {
          this.logger.warn(
            `WATCHDOG: session ${engine.id} is stuck (status=${engine.status}, sinceMs=${engine.sinceMs}) but circuit is open; skipping recovery`,
          );
          continue;
        }

        try {
          await this.sessionService.restartEngine(engine.id);
          this.recordAttempt(engine.id);
          this.logger.log(
            `WATCHDOG: recovered session ${engine.id} (status=${engine.status}, sinceMs=${engine.sinceMs})`,
          );
        } catch (err) {
          this.recordAttempt(engine.id);
          const attempts = this.getAttemptCount(engine.id);
          if (attempts >= this.maxAttemptsPerWindow) {
            this.logger.error(
              `WATCHDOG: session ${engine.id} reached ${attempts} recovery attempts in ${Math.round(this.attemptWindowMs / 1000)}s — circuit-open until manual start()`,
            );
          } else {
            this.logger.error(
              `WATCHDOG: recovery of session ${engine.id} failed (attempt ${attempts}/${this.maxAttemptsPerWindow}): ${String(err)}`,
            );
          }
        }
      }
    } catch (err) {
      // Never let the watchdog crash itself.
      this.logger.error(`WATCHDOG: tick failed: ${String(err)}`);
    }
  }

  /** Test helper: directly force a recovery attempt. */
  public async forceRecover(sessionId: string): Promise<void> {
    this.attempts.delete(sessionId);
    await this.sessionService.restartEngine(sessionId);
    this.recordAttempt(sessionId);
  }

  /** Test helper. */
  public resetAll(): void {
    this.attempts.clear();
  }

  private recordAttempt(id: string): void {
    const now = Date.now();
    const existing = this.attempts.get(id);
    if (!existing || now - existing.firstAt > this.attemptWindowMs) {
      this.attempts.set(id, { count: 1, firstAt: now });
      return;
    }
    existing.count += 1;
    if (existing.count >= this.maxAttemptsPerWindow && !existing.disabledAt) {
      existing.disabledAt = now;
    }
  }

  private getAttemptCount(id: string): number {
    const e = this.attempts.get(id);
    if (!e) return 0;
    if (Date.now() - e.firstAt > this.attemptWindowMs) return 0;
    return e.count;
  }

  private isCircuitOpen(id: string): boolean {
    const e = this.attempts.get(id);
    if (!e) return false;
    if (Date.now() - e.firstAt > this.attemptWindowMs) return false;
    return e.count >= this.maxAttemptsPerWindow;
  }
}

function osTotalMemMB(): number {
  try {
    // Lazy require so this file still imports cleanly in pure-node test envs
    // where the global `os` is shadowed by anything.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('node:os');
    return Math.floor(os.totalmem() / 1024 / 1024);
  } catch {
    return 4096;
  }
}
