import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
const parameters = { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, parameters, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
export const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return `scrypt-v1:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [kind, salt, expected] = encoded.split(":");
  if (
    kind !== "scrypt-v1" ||
    !salt ||
    !expected ||
    !/^[a-f0-9]{128}$/.test(expected)
  )
    return false;
  const key = await derive(password, salt);
  return timingSafeEqual(key, Buffer.from(expected, "hex"));
}
