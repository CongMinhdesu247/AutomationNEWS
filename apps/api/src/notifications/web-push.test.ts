import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  randomBytes,
  verify,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createVapidAuthHeader,
  decodeBase64Flexible,
  encryptWebPushPayload,
  generateVapidKeyPair,
  isAllowedPushEndpoint,
} from "./web-push.js";

describe("Web Push Security & RFC 8291/8292 Cryptography", () => {
  it("enforces strict browser push provider allowlist and blocks SSRF", () => {
    expect(
      isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"),
    ).toBe(true);
    expect(
      isAllowedPushEndpoint(
        "https://updates.push.services.mozilla.com/wpush/v2/abc",
      ),
    ).toBe(true);
    expect(
      isAllowedPushEndpoint(
        "https://wns2-sg2p.notify.windows.com/w/?token=abc",
      ),
    ).toBe(true);
    expect(
      isAllowedPushEndpoint("https://web.push.apple.com/Qabc"),
    ).toBe(true);

    // Reject SSRF / arbitrary webhooks / non-standard ports / HTTP
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(
      false,
    );
    expect(
      isAllowedPushEndpoint("https://fcm.googleapis.com:8443/fcm/send/abc"),
    ).toBe(false);
    expect(isAllowedPushEndpoint("https://127.0.0.1/push")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isAllowedPushEndpoint("https://attacker.example.com/webhook")).toBe(
      false,
    );
  });

  it("signs valid RFC 8292 ES256 VAPID Authorization JWTs", () => {
    const vapid = generateVapidKeyPair();
    const rawPub = decodeBase64Flexible(vapid.publicKey);
    expect(rawPub.length).toBe(65);
    expect(rawPub[0]).toBe(0x04);

    const header = createVapidAuthHeader(
      "https://fcm.googleapis.com",
      "mailto:notify@automationnews.vn",
      vapid.publicKey,
      vapid.privateKey,
      1_700_000_000_000,
    );
    expect(header.startsWith("vapid t=")).toBe(true);
    const match = header.match(/^vapid t=([^,]+), k=(.+)$/);
    expect(match).not.toBeNull();
    const [, jwt, keyParam] = match!;
    expect(keyParam).toBe(vapid.publicKey);

    const [hB64, pB64, sigB64] = jwt!.split(".");
    const payload = JSON.parse(
      Buffer.from(pB64!, "base64url").toString("utf8"),
    ) as { aud: string; sub: string; exp: number };
    expect(payload.aud).toBe("https://fcm.googleapis.com");
    expect(payload.sub).toBe("mailto:notify@automationnews.vn");
    expect(payload.exp).toBe(1_700_000_000 + 12 * 3600);

    // Reconstruct public KeyObject from JWK coordinates and verify ES256 IEEE-P1363 signature
    const publicKeyObj = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: rawPub.subarray(1, 33).toString("base64url"),
        y: rawPub.subarray(33, 65).toString("base64url"),
      },
      format: "jwk",
    });
    const isValid = verify(
      "sha256",
      Buffer.from(`${hB64}.${pB64}`, "utf8"),
      { key: publicKeyObj, dsaEncoding: "ieee-p1363" },
      Buffer.from(sigB64!, "base64url"),
    );
    expect(isValid).toBe(true);
  });

  it("encrypts and decrypts RFC 8291 aes128gcm Vietnamese payloads end-to-end", () => {
    const subscriberEcdh = createECDH("prime256v1");
    const uaPublic = subscriberEcdh.generateKeys();
    const authSecret = randomBytes(16);

    const originalMessage = JSON.stringify({
      title: "Bản tin sáng · 18/11",
      body: "Hà Nội 21–26°C · SJC 8,92tr/chỉ (Chạm đáy 30 ngày)",
      url: "/#/digests/1234",
      tag: "digest-1234",
    });

    const wireBody = encryptWebPushPayload(
      originalMessage,
      uaPublic.toString("base64url"),
      authSecret.toString("base64url"),
    );

    // Parse RFC 8188 86-byte header: salt(16) || rs(4) || idlen(1) || keyid(65)
    expect(wireBody.length).toBeGreaterThan(86 + 16);
    const salt = wireBody.subarray(0, 16);
    const rs = wireBody.readUInt32BE(16);
    const idLen = wireBody[20]!;
    expect(rs).toBe(4096);
    expect(idLen).toBe(65);
    const asPublic = wireBody.subarray(21, 21 + idLen);
    const encryptedRecord = wireBody.subarray(21 + idLen);

    // Receiver derives shared secret and HKDF keys per RFC 8291
    const sharedSecret = subscriberEcdh.computeSecret(asPublic);
    const keyInfo = Buffer.concat([
      Buffer.from("WebPush: info\0", "utf8"),
      uaPublic,
      asPublic,
    ]);
    const ikm = Buffer.from(
      hkdfSync("sha256", sharedSecret, authSecret, keyInfo, 32),
    );
    const cek = Buffer.from(
      hkdfSync(
        "sha256",
        ikm,
        salt,
        Buffer.from("Content-Encoding: aes128gcm\0", "utf8"),
        16,
      ),
    );
    const nonce = Buffer.from(
      hkdfSync(
        "sha256",
        ikm,
        salt,
        Buffer.from("Content-Encoding: nonce\0", "utf8"),
        12,
      ),
    );

    const authTag = encryptedRecord.subarray(encryptedRecord.length - 16);
    const ciphertext = encryptedRecord.subarray(0, encryptedRecord.length - 16);
    const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
    decipher.setAuthTag(authTag);
    const paddedPlain = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    // Verify RFC 8188 final record delimiter 0x02
    expect(paddedPlain[paddedPlain.length - 1]).toBe(0x02);
    const recoveredJson = paddedPlain
      .subarray(0, paddedPlain.length - 1)
      .toString("utf8");
    expect(recoveredJson).toBe(originalMessage);
  });
});
