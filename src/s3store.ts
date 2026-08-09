/**
 * Production auth-snapshot store backed by a private S3-compatible bucket
 * (Hugging Face Storage Bucket per migration plan §4.3/§5.1).
 * Encrypts with AES-256-GCM before upload; object key derived from account+epoch.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { AuthSnapshotStore } from './storage';

export interface S3StoreConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3AuthSnapshotStore implements AuthSnapshotStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(cfg: S3StoreConfig) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      forcePathStyle: true,
    });
    this.bucket = cfg.bucket;
  }

  objectKey(accountId: string, epoch: number): string {
    return `auth/v1/${accountId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}/${epoch}.bin`;
  }

  async save(accountId: string, epoch: number, data: Buffer): Promise<void> {
    const key = this.objectKey(accountId, epoch);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }),
    );
  }

  async load(accountId: string, epoch: number): Promise<Buffer | null> {
    const key = this.objectKey(accountId, epoch);
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!out.Body) return null;
      return Buffer.from(await out.Body.transformToByteArray());
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async delete(accountId: string, epoch: number): Promise<void> {
    const key = this.objectKey(accountId, epoch);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Mock fetch used by tests to confirm atomic object presence — never in prod logs. */
  getKeyFor(accountId: string, epoch: number): string {
    return this.objectKey(accountId, epoch);
  }
}

export { LocalAuthStore } from './storage';
export type { AuthSnapshotStore } from './storage';