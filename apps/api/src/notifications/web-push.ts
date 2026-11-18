import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  webcrypto,
  type KeyObject,
} from "node:crypto";

type JsonWebKey = webcrypto.JsonWebKey;
import type { Pool } from "pg";
import {
  goldBarItems,
  goldPricePerChi,
  type Digest,
  type WebPushDevice,
  type WebPushSubscriptionInput,
} from "@hub/contracts";
import { lowestMarketLabels } from "../connectors/market-history.js";
import { safeHttp, type HttpClient } from "../connectors/http.js";
import { notificationTitle } from "./format.js";
import { RequestError } from "../digests/service.js";

export type WebPushMessagePayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
  urgent?: boolean;
};

type CachedVapid = {
  publicKey: string;
  privateKey: KeyObject;
};

const vapidCache = new WeakMap<Pool, CachedVapid>();

const ALLOWED_PUSH_EXACT_HOSTS = new Set([
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
]);

const ALLOWED_PUSH_HOST_SUFFIXES = [
  ".fcm.googleapis.com",
  ".push.googleapis.com",
  ".push.services.mozilla.com",
  ".notify.windows.com",
  ".push.apple.com",
];

export function decodeBase64Flexible(value: string): Buffer {
  const normalized = value
    .trim()
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return Buffer.from(normalized, "base64url");
}

export function isAllowedPushEndpoint(
  rawUrl: string,
  allowLoopback = false,
): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    allowLoopback &&
    url.protocol === "http:" &&
    (host === "127.0.0.1" || host === "localhost")
  ) {
    return true;
  }
  if (url.protocol !== "https:") return false;
  if (url.port !== "" && url.port !== "443") return false;
  if (ALLOWED_PUSH_EXACT_HOSTS.has(host)) return true;
  return ALLOWED_PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function generateVapidKeyPair(): {
  publicKey: string;
  privateKey: KeyObject;
  privateJwk: JsonWebKey;
} {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const privateJwk = privateKey.export({ format: "jwk" });
  if (!privateJwk.x || !privateJwk.y) {
    throw new Error("Failed to export P-256 JWK coordinates.");
  }
  const x = decodeBase64Flexible(privateJwk.x);
  const y = decodeBase64Flexible(privateJwk.y);
  const uncompressedPublic = Buffer.concat([Buffer.from([0x04]), x, y]);
  return {
    publicKey: uncompressedPublic.toString("base64url"),
    privateKey,
    privateJwk,
  };
}

export async function ensureVapidConfig(pool: Pool): Promise<CachedVapid> {
  const cached = vapidCache.get(pool);
  if (cached) return cached;

  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPrivRaw = process.env.VAPID_PRIVATE_JWK?.trim();
  if (envPub && envPrivRaw) {
    const jwk = JSON.parse(envPrivRaw) as JsonWebKey;
    const privateKey = createPrivateKey({ key: jwk, format: "jwk" });
    const entry = { publicKey: envPub, privateKey };
    vapidCache.set(pool, entry);
    return entry;
  }

  let row = (
    await pool.query<{ public_key: string; private_jwk: JsonWebKey }>(
      "SELECT public_key, private_jwk FROM web_push_config WHERE id = 1",
    )
  ).rows[0];

  if (!row) {
    const generated = generateVapidKeyPair();
    await pool.query(
      `INSERT INTO web_push_config (id, public_key, private_jwk)
       VALUES (1, $1, $2::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [generated.publicKey, JSON.stringify(generated.privateJwk)],
    );
    row = (
      await pool.query<{ public_key: string; private_jwk: JsonWebKey }>(
        "SELECT public_key, private_jwk FROM web_push_config WHERE id = 1",
      )
    ).rows[0];
  }

  if (!row) {
    throw new Error("Không thể khởi tạo khóa VAPID cho Web Push.");
  }

  const entry: CachedVapid = {
    publicKey: row.public_key,
    privateKey: createPrivateKey({ key: row.private_jwk, format: "jwk" }),
  };
  vapidCache.set(pool, entry);
  return entry;
}

export function resolveVapidSubject(): string {
  const raw = process.env.VAPID_SUBJECT?.trim();
  if (raw && (raw.startsWith("mailto:") || raw.startsWith("https://"))) {
    return raw;
  }
  const appOrigin = process.env.APP_ORIGIN?.trim();
  if (appOrigin && appOrigin.startsWith("https://")) {
    return appOrigin;
  }
  return "mailto:notify@automationnews.vn";
}

export function createVapidAuthHeader(
  endpointOrigin: string,
  subject: string,
  publicKeyB64Url: string,
  privateKey: KeyObject,
  nowMs = Date.now(),
): string {
  const headerB64 = Buffer.from(
    JSON.stringify({ typ: "JWT", alg: "ES256" }),
    "utf8",
  ).toString("base64url");
  const payloadB64 = Buffer.from(
    JSON.stringify({
      aud: endpointOrigin,
      exp: Math.floor(nowMs / 1000) + 12 * 3600,
      sub: subject,
    }),
    "utf8",
  ).toString("base64url");
  const signingInput = `${headerB64}.${payloadB64}`;
  const signatureB64 = sign("sha256", Buffer.from(signingInput, "utf8"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `vapid t=${signingInput}.${signatureB64}, k=${publicKeyB64Url}`;
}

export function validateSubscriberKeys(
  p256dhB64: string,
  authB64: string,
): { uaPublic: Buffer; authSecret: Buffer } {
  const uaPublic = decodeBase64Flexible(p256dhB64);
  const authSecret = decodeBase64Flexible(authB64);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new RequestError(
      400,
      "INVALID_PUSH_KEY",
      "Khóa công khai trình duyệt (p256dh) không đúng chuẩn P-256.",
    );
  }
  if (authSecret.length !== 16) {
    throw new RequestError(
      400,
      "INVALID_PUSH_AUTH",
      "Khóa xác thực Web Push (auth) phải dài 16 byte.",
    );
  }
  // Verify point lies on prime256v1 curve by performing an ephemeral ECDH check.
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    ecdh.computeSecret(uaPublic);
  } catch {
    throw new RequestError(
      400,
      "INVALID_PUSH_KEY",
      "Khóa công khai trình duyệt không hợp lệ trên đường cong P-256.",
    );
  }
  return { uaPublic, authSecret };
}

/**
 * RFC 8291 + RFC 8188 (aes128gcm) Web Push payload encryption.
 */
export function encryptWebPushPayload(
  payloadJson: string,
  p256dhB64: string,
  authB64: string,
  saltOverride?: Buffer,
): Buffer {
  const { uaPublic, authSecret } = validateSubscriberKeys(p256dhB64, authB64);
  const plaintext = Buffer.from(payloadJson, "utf8");
  if (plaintext.length > 3500) {
    throw new Error("Web Push payload exceeds safe 4 KiB frame budget.");
  }

  const salt = saltOverride ?? randomBytes(16);
  if (salt.length !== 16) {
    throw new Error("Web Push salt must be 16 bytes.");
  }

  const ecdh = createECDH("prime256v1");
  const asPublic = ecdh.generateKeys(); // 65-byte uncompressed P-256 point
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    uaPublic,
    asPublic,
  ]);
  const ikm = Buffer.from(
    hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32),
  );

  const cekInfo = Buffer.from("Content-Encoding: aes128gcm\0", "utf8");
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, cekInfo, 16));

  const nonceInfo = Buffer.from("Content-Encoding: nonce\0", "utf8");
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, nonceInfo, 12));

  // Final record delimiter 0x02 per RFC 8188 Section 2.
  const paddedPlaintext = Buffer.concat([plaintext, Buffer.from([0x02])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(paddedPlaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  // RFC 8188 Section 2.1 header: salt(16) || rs(4, uint32BE=4096) || idlen(1, 65) || keyid(65)
  const rsBuf = Buffer.alloc(4);
  rsBuf.writeUInt32BE(4096, 0);
  const idLenBuf = Buffer.from([asPublic.length]);

  return Buffer.concat([salt, rsBuf, idLenBuf, asPublic, ciphertext]);
}

function toDeviceDto(row: {
  id: string;
  endpoint: string;
  user_agent: string;
  created_at: Date;
  last_used_at: Date | null;
}): WebPushDevice {
  let endpointHost = "push-service";
  try {
    endpointHost = new URL(row.endpoint).hostname;
  } catch {
    // Keep fallback label
  }
  return {
    id: row.id,
    endpointHost,
    userAgent: row.user_agent,
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: row.last_used_at
      ? new Date(row.last_used_at).toISOString()
      : null,
  };
}

export async function countUserWebPushDevices(
  pool: Pool,
  userId: string,
): Promise<number> {
  try {
    const res = await pool.query<{ count: string }>(
      "SELECT count(*) FROM user_web_push_subscriptions WHERE user_id = $1",
      [userId],
    );
    return Number(res.rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

export async function listUserWebPushDevices(
  pool: Pool,
  userId: string,
): Promise<WebPushDevice[]> {
  const res = await pool.query<{
    id: string;
    endpoint: string;
    user_agent: string;
    created_at: Date;
    last_used_at: Date | null;
  }>(
    `SELECT id, endpoint, user_agent, created_at, last_used_at
       FROM user_web_push_subscriptions
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 10`,
    [userId],
  );
  return res.rows.map(toDeviceDto);
}

export async function upsertUserWebPushSubscription(
  pool: Pool,
  userId: string,
  input: WebPushSubscriptionInput,
  { allowLoopback = false }: { allowLoopback?: boolean } = {},
): Promise<WebPushDevice> {
  if (!isAllowedPushEndpoint(input.endpoint, allowLoopback)) {
    throw new RequestError(
      400,
      "UNSUPPORTED_PUSH_ENDPOINT",
      "Địa chỉ dịch vụ Web Push không nằm trong danh sách trình duyệt tiêu chuẩn (Chrome, Edge, Firefox, Safari).",
    );
  }
  validateSubscriberKeys(input.keys.p256dh, input.keys.auth);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["webpush:" + userId],
    );
    const upserted = (
      await client.query<{
        id: string;
        endpoint: string;
        user_agent: string;
        created_at: Date;
        last_used_at: Date | null;
      }>(
        `INSERT INTO user_web_push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, endpoint)
         DO UPDATE SET
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent,
           last_used_at = now()
         RETURNING id, endpoint, user_agent, created_at, last_used_at`,
        [
          crypto.randomUUID(),
          userId,
          input.endpoint,
          input.keys.p256dh,
          input.keys.auth,
          input.userAgent.slice(0, 240),
        ],
      )
    ).rows[0]!;

    // Keep at most 5 active browser subscriptions per account.
    await client.query(
      `DELETE FROM user_web_push_subscriptions
        WHERE user_id = $1
          AND id IN (
            SELECT id FROM user_web_push_subscriptions
             WHERE user_id = $1
             ORDER BY COALESCE(last_used_at, created_at) DESC, created_at DESC
             OFFSET 5
          )`,
      [userId],
    );
    await client.query("COMMIT");
    return toDeviceDto(upserted);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteUserWebPushByEndpoint(
  pool: Pool,
  userId: string,
  endpoint: string,
): Promise<boolean> {
  const res = await pool.query(
    "DELETE FROM user_web_push_subscriptions WHERE user_id = $1 AND endpoint = $2",
    [userId, endpoint],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function deleteUserWebPushDevice(
  pool: Pool,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const res = await pool.query(
    "DELETE FROM user_web_push_subscriptions WHERE user_id = $1 AND id = $2",
    [userId, deviceId],
  );
  return (res.rowCount ?? 0) > 0;
}

export function buildDigestPushPayload(digest: Digest): WebPushMessagePayload {
  const sources = digest.sources;
  const lows = sources ? lowestMarketLabels(sources) : [];
  const title = lows.length
    ? `Chạm đáy 30 ngày: ${lows.join(", ")}`
    : notificationTitle(digest);

  const parts: string[] = [];
  const weather = sources?.weather?.data;
  if (weather) {
    const temp =
      weather.minTemperature !== null && weather.maxTemperature !== null
        ? `${Math.round(weather.minTemperature)}–${Math.round(weather.maxTemperature)}°C`
        : "";
    const rain =
      weather.rainProbability !== null && weather.rainProbability >= 50
        ? ` · Mưa ${weather.rainProbability}%`
        : "";
    parts.push(`${weather.location}${temp ? " " + temp : ""}${rain}`);
  }
  const sjc = sources?.gold?.data
    ? goldBarItems(sources.gold.data)[0]
    : undefined;
  if (sjc && sources?.gold?.data) {
    const perChi = goldPricePerChi(sjc.sell, sources.gold.data.unit);
    if (perChi !== null) {
      parts.push(
        `SJC ${(perChi / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}tr/chỉ`,
      );
    }
  }
  if (sources?.usd?.data?.sell) {
    parts.push(`USD ${sources.usd.data.sell.toLocaleString("vi-VN")}đ`);
  }
  const topHeadline =
    sources?.custom?.data.items[0]?.title ??
    sources?.rss?.data.items[0]?.title ??
    null;

  const summaryLine = parts.join(" · ");
  const rawBody =
    summaryLine && topHeadline
      ? `${summaryLine}\n• ${topHeadline}`
      : summaryLine || topHeadline || "Ấn bản sáng của bạn đã sẵn sàng để đọc.";

  return {
    title,
    body: rawBody.slice(0, 260),
    url: `/#/digests/${digest.id}`,
    tag: `digest-${digest.id}`,
    urgent: lows.length > 0,
  };
}

export async function sendWebPushToUser(
  pool: Pool,
  userId: string,
  message: WebPushMessagePayload,
  {
    http = safeHttp,
    allowLoopback = false,
  }: {
    http?: HttpClient;
    allowLoopback?: boolean;
  } = {},
): Promise<{
  sent: number;
  failed: number;
  expired: number;
  total: number;
}> {
  const subs = (
    await pool.query<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>(
      `SELECT id, endpoint, p256dh, auth
         FROM user_web_push_subscriptions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 5`,
      [userId],
    )
  ).rows;

  if (!subs.length) {
    return { sent: 0, failed: 0, expired: 0, total: 0 };
  }

  const vapid = await ensureVapidConfig(pool);
  const subject = resolveVapidSubject();
  const payloadJson = JSON.stringify({
    title: message.title.slice(0, 120),
    body: message.body.slice(0, 320),
    url: message.url,
    tag: message.tag ?? "morning-digest",
  });

  let sent = 0;
  let failed = 0;
  let expired = 0;

  await Promise.all(
    subs.map(async (sub) => {
      if (!isAllowedPushEndpoint(sub.endpoint, allowLoopback)) {
        failed++;
        return;
      }
      try {
        const url = new URL(sub.endpoint);
        const body = encryptWebPushPayload(payloadJson, sub.p256dh, sub.auth);
        const authorization = createVapidAuthHeader(
          url.origin,
          subject,
          vapid.publicKey,
          vapid.privateKey,
        );
        const response = await http(sub.endpoint, {
          method: "POST",
          timeoutMs: 8000,
          maxRedirects: 0,
          maxBytes: 32768,
          ...(allowLoopback ? { allowedOrigins: [url.origin] } : {}),
          headers: {
            Authorization: authorization,
            "Content-Type": "application/octet-stream",
            "Content-Encoding": "aes128gcm",
            TTL: "86400",
            Urgency: message.urgent ? "high" : "normal",
          },
          rawBody: body,
        });

        if (response.status >= 200 && response.status < 300) {
          sent++;
          await pool
            .query(
              "UPDATE user_web_push_subscriptions SET last_used_at = now() WHERE id = $1",
              [sub.id],
            )
            .catch(() => {});
        } else if (response.status === 404 || response.status === 410) {
          expired++;
          await pool
            .query("DELETE FROM user_web_push_subscriptions WHERE id = $1", [
              sub.id,
            ])
            .catch(() => {});
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }),
  );

  return { sent, failed, expired, total: subs.length };
}
