import { createCipheriv, randomBytes } from "node:crypto";
import type { Digest } from "@hub/contracts";
import { formatDigestNotification } from "../notifications/format.js";
export type SealedReport = { at: string; iv: string; ciphertext: string };
export function sealReport(digest: Digest, base: string) {
  const url = new URL(base);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("Invalid report URL");
  const key = randomBytes(32),
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const text = formatDigestNotification(digest, false, false, true);
  const encrypted = Buffer.concat([
    cipher.update(
      JSON.stringify({ createdAt: digest.createdAt, text }),
      "utf8",
    ),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  if (encrypted.length > 24000) throw Error("Report exceeds size limit");
  url.hash = digest.id + "." + key.toString("base64url");
  return {
    url: url.toString(),
    report: {
      at: digest.createdAt,
      iv: iv.toString("base64url"),
      ciphertext: encrypted.toString("base64url"),
    },
  };
}
