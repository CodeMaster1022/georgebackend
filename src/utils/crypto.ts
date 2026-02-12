import crypto from "crypto";
import { env } from "../config/env";

function keyObject() {
  const raw = env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not set. Refusing to store OAuth tokens without encryption.");
  }
  // Derive a stable 32-byte key (AES-256) from the provided string.
  const keyBytes = crypto.createHash("sha256").update(raw).digest();
  return crypto.createSecretKey(keyBytes);
}

export function encryptString(plaintext: string) {
  const key = keyObject();
  const iv = crypto.randomBytes(12); // GCM standard
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // store as base64(iv).base64(tag).base64(ciphertext)
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ciphertext.toString("base64")}`;
}

export function decryptString(payload: string) {
  const [ivB64, tagB64, ctB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Invalid encrypted payload format");
  const key = keyObject();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plaintext.toString("utf8");
}


export function sha1Hex(input: string): string {
  return crypto.createHash('sha1').update(input, 'utf8').digest('hex');
}

export function hmacSha256Base64Url(key: string, data: string): string {
  const b64 = crypto.createHmac('sha256', key).update(data, 'utf8').digest('base64');
  // base64url
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
