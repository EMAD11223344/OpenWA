/**
 * Auth-state storage contract (migration plan §5.2):
 * Brain/Prisma stores only object key + ETag + keyVersion + epoch.
 * The engine writes/reads encrypted blobs via this interface.
 */
export interface AuthSnapshotStore {
  /** Deterministic private key for the account+epoch. */
  objectKey(accountId: string, epoch: number): string;
  save(accountId: string, epoch: number, encrypted: Buffer): Promise<void>;
  load(accountId: string, epoch: number): Promise<Buffer | null>;
  delete(accountId: string, epoch: number): Promise<void>;
}

/** Local filesystem adapter — for tests/mock only, NOT for production auth state (plan §5.1). */
export class LocalAuthStore implements AuthSnapshotStore {
  constructor(private dir: string) {
    require('fs').mkdirSync(dir, { recursive: true });
  }
  private path(accountId: string, epoch: number): string {
    return `${this.dir}/auth_${safeName(accountId)}_e${epoch}.bin`;
  }
  objectKey(accountId: string, epoch: number): string {
    return `auth/v1/${safeName(accountId)}/${epoch}.bin`;
  }
  async save(accountId: string, epoch: number, data: Buffer): Promise<void> {
    require('fs').writeFileSync(this.path(accountId, epoch), data);
  }
  async load(accountId: string, epoch: number): Promise<Buffer | null> {
    try {
      return require('fs').readFileSync(this.path(accountId, epoch));
    } catch {
      return null;
    }
  }
  async delete(accountId: string, epoch: number): Promise<void> {
    try {
      require('fs').unlinkSync(this.path(accountId, epoch));
    } catch {
      /* already gone */
    }
  }
}

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}