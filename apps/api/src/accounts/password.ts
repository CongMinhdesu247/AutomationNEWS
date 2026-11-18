import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { RequestError } from "../digests/service.js";

const parameters = { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const MAX_CONCURRENT_SCRYPT = 3;
const MAX_SCRYPT_QUEUE = 40;
let activeDerivations = 0;
const waitQueue: (() => void)[] = [];

async function withScryptSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeDerivations >= MAX_CONCURRENT_SCRYPT) {
    if (waitQueue.length >= MAX_SCRYPT_QUEUE) {
      throw new RequestError(
        429,
        "AUTH_BUSY",
        "Hệ thống xác thực đang bận. Vui lòng thử lại sau ít giây.",
      );
    }
    await new Promise<void>((resolve) => waitQueue.push(resolve));
  }
  activeDerivations++;
  try {
    return await work();
  } finally {
    activeDerivations--;
    const next = waitQueue.shift();
    if (next) next();
  }
}

const derive = (password: string, salt: string) =>
  withScryptSlot(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        scrypt(password, salt, 64, parameters, (error, key) =>
          error ? reject(error) : resolve(key),
        );
      }),
  );

export const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return `scrypt-v1:${salt}:${key.toString("hex")}`;
}

const fallbackSalt = randomBytes(16).toString("hex");

export async function verifyPassword(password: string, encoded: string) {
  const [kind, salt, expected] = encoded.split(":");
  const validFormat =
    kind === "scrypt-v1" &&
    Boolean(salt) &&
    Boolean(expected) &&
    /^[a-f0-9]{128}$/.test(expected ?? "");
  // Always run KDF even on malformed/legacy hash strings to prevent timing side-channels.
  const key = await derive(password, validFormat && salt ? salt : fallbackSalt);
  if (!validFormat || !expected) return false;
  return timingSafeEqual(key, Buffer.from(expected, "hex"));
}
