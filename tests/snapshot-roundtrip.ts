/**
 * Phase 1 exit gate — encrypted auth-snapshot roundtrip (authcrypto + store contracts).
 * Runs WITHOUT WhatsApp: encrypt → persist (local fake store) → decrypt → fingerprint stable.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { encryptAuthSnapshot, decryptAuthSnapshot, keyFingerprint } from '../src/authcrypto';
import { LocalAuthStore } from '../src/storage';

async function main(): Promise<void> {
  const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
  const check = (name: string, cond: boolean, detail = '') => results.push({ name, ok: !!cond, detail });

  const key = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex'); // 32 bytes
  const badKey = Buffer.from('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openwa-snap-'));
  const store = new LocalAuthStore(path.join(tmp, 'auth'));

  // 1. roundtrip with plaintext creds-shaped payload
  const plaintext = Buffer.from(JSON.stringify({ creds: { me: { id: 'test@whatsapp.net' } }, keys: {} }));
  const enc = encryptAuthSnapshot(plaintext, key);
  check('frame marked V1', enc.subarray(0, 14).toString('utf8') === 'OPENWA_AUTH_V1', 'magic prefix');
  check('ciphertext not plaintext', !enc.toString('utf8').includes('test@whatsapp'), 'encrypted blob must not leak plaintext');

  const dec = decryptAuthSnapshot(enc, key);
  const roundtripOk = dec.toString('utf8') === plaintext.toString('utf8');
  check('roundtrip decrypt', roundtripOk, 'byte-identical after decrypt');

  // 2. wrong key must fail loudly
  let threw = false;
  try {
    decryptAuthSnapshot(enc, badKey);
  } catch {
    threw = true;
  }
  check('wrong key rejected', threw, 'GCM auth tag rejects wrong key');

  // 3. store contract: save→load→delete
  const epoch = 7;
  const key_ = store.objectKey('acct-1', epoch);
  check('objectKey deterministic', key_ === store.objectKey('acct-1', epoch), key_);
  check('objectKey v1 layout', key_.startsWith('auth/v1/'), key_);
  check('load missing → null', (await store.load('acct-1', 999)) === null, 'no file, no throw');

  await store.save('acct-1', epoch, enc);
  const loaded = await store.load('acct-1', epoch);
  check('store roundtrip', !!loaded && loaded.equals(enc), 'loaded blob identical');

  await store.delete('acct-1', epoch);
  check('delete removes blob', (await store.load('acct-1', epoch)) === null, 'deleted');

  // 4. fingerprint stability
  check('keyFingerprint stable', keyFingerprint(key) === keyFingerprint(key), keyFingerprint(key));
  check('fingerprint differs per key', keyFingerprint(key) !== keyFingerprint(badKey));

  let pass = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
    if (r.ok) pass++;
  }
  console.log(`\n${pass}/${results.length} assertions passed`);
  process.exit(pass === results.length ? 0 : 1);
}

void main().catch((e) => {
  console.error('snapshot test failure', e);
  process.exit(2);
});