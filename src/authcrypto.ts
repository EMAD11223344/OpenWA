import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Application-level encryption for Baileys auth snapshots (migration plan §5.2).
 * Frame: [OPENWA_AUTH_V1][iv 12][tag 16][encrypted payload]
 */
const IV_LEN = 12;
const TAG_LEN = 16;

export function encryptAuthSnapshot(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('OPENWA_AUTH_V1', 'utf8'), iv, tag, body]);
}

export function decryptAuthSnapshot(ciphertext: Buffer, key: Buffer): Buffer {
  const magic = Buffer.from('OPENWA_AUTH_V1', 'utf8');
  if (!ciphertext.subarray(0, magic.length).equals(magic)) {
    throw new Error('auth snapshot: bad magic (wrong key version or corrupt frame)');
  }
  const iv = ciphertext.subarray(magic.length, magic.length + IV_LEN);
  const tag = ciphertext.subarray(magic.length + IV_LEN, magic.length + IV_LEN + TAG_LEN);
  const body = ciphertext.subarray(magic.length + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/** SHA-256 of the key material — stored by Brain as "key version" fingerprint, never the key. */
export function keyFingerprint(key: Buffer): string {
  const { createHash } = require('crypto');
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}