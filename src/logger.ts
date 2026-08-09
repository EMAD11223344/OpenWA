/** Minimal structured logger with secret-redaction. NEVER log QR, tokens, keys, IPs, bucket paths. */
export class Logger {
  constructor(private readonly scope: string) {}

  info(msg: string): void {
    console.log(`[info ] ${this.scope}: ${this.redact(msg)}`);
  }

  warn(payload: Record<string, unknown>, msg?: string): void {
    console.warn(`[warn ] ${this.scope}: ${this.redact(msg ?? JSON.stringify(payload))}`);
  }

  error(msg: string, err?: Error): void {
    console.error(`[error] ${this.scope}: ${this.redact(msg)} ${err ? this.redact(err.message) : ''}`);
  }

  /** Redact common secret shapes (bearers, tokens, QR payloads, private keys). */
  redact(s: string): string {
    return s
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, '$1***')
      .replace(/(token|secret|apikey|key)\s*[=:]\s*[^\s,;]+/gi, '$1=***')
      .replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/gi, '<qr-redacted>');
  }
}