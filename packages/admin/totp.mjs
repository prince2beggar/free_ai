import { createHmac } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input) {
  const clean = String(input)
    .toUpperCase()
    .replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) throw new Error('Invalid base32 character in TOTP secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function base32Encode(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function generateTotp(secret, timeMs = Date.now(), stepSeconds = 30) {
  const key = /^[A-Z2-7]+=*$/i.test(secret) ? base32Decode(secret) : Buffer.from(secret, 'utf8');
  const counter = Math.floor(timeMs / (stepSeconds * 1000));
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = binary % 1000000;
  return String(code).padStart(6, '0');
}

export function verifyTotp(secret, code, timeMs = Date.now(), stepSeconds = 30, window = 1) {
  const cleanCode = String(code).trim();
  if (!/^\d{6}$/.test(cleanCode)) return false;
  for (let error = -window; error <= window; error++) {
    const t = timeMs + error * stepSeconds * 1000;
    if (generateTotp(secret, t, stepSeconds) === cleanCode) {
      return true;
    }
  }
  return false;
}
