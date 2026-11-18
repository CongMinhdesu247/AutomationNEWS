import { familyConfigSchema, type FamilyConfig } from "@hub/contracts";

const DEFAULT_ITERATIONS = 250000;
const MIN_ITERATIONS = 100000;
const MAX_ITERATIONS = 1000000;

const encode = (v: Uint8Array) =>
  btoa(Array.from(v, (c) => String.fromCharCode(c)).join(""));
const decode = (v: string) => Uint8Array.from(atob(v), (c) => c.charCodeAt(0));

function assertBackupPassword(password: string) {
  if (password.length < 10 || password.length > 200) {
    throw new Error("Mật khẩu cần từ 10 đến 200 ký tự.");
  }
}

async function deriveBackupKey(
  password: string,
  salt: Uint8Array,
  iterations = DEFAULT_ITERATIONS,
) {
  assertBackupPassword(password);
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptFamilyBackup(
  config: FamilyConfig,
  password: string,
) {
  assertBackupPassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(
    JSON.stringify(familyConfigSchema.parse(config)),
  );
  if (data.length > 64000) throw new Error("Cấu hình vượt giới hạn sao lưu.");
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await deriveBackupKey(password, salt, DEFAULT_ITERATIONS),
    data,
  );
  return JSON.stringify(
    {
      format: "hub-family-backup",
      version: 1,
      iterations: DEFAULT_ITERATIONS,
      salt: encode(salt),
      iv: encode(iv),
      ciphertext: encode(new Uint8Array(encrypted)),
    },
    null,
    2,
  );
}

export async function decryptFamilyBackup(
  text: string,
  password: string,
): Promise<FamilyConfig> {
  if (text.length > 128000) throw new Error("Tệp sao lưu quá lớn.");
  assertBackupPassword(password);
  try {
    const value = JSON.parse(text);
    const pbkdf2Iterations =
      typeof value.iterations === "number" && Number.isInteger(value.iterations)
        ? value.iterations
        : -1;
    if (
      value.format !== "hub-family-backup" ||
      value.version !== 1 ||
      pbkdf2Iterations < MIN_ITERATIONS ||
      pbkdf2Iterations > MAX_ITERATIONS ||
      typeof value.salt !== "string" ||
      typeof value.iv !== "string" ||
      typeof value.ciphertext !== "string"
    ) {
      throw new Error("Invalid backup envelope");
    }
    const salt = decode(value.salt);
    const iv = decode(value.iv);
    if (salt.length !== 16 || iv.length !== 12) {
      throw new Error("Invalid backup parameters");
    }
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await deriveBackupKey(password, salt, pbkdf2Iterations),
      decode(value.ciphertext),
    );
    return familyConfigSchema.parse(
      JSON.parse(new TextDecoder().decode(plain)),
    );
  } catch {
    throw new Error(
      "Không mở được sao lưu. Kiểm tra mật khẩu và đúng tệp của ứng dụng.",
    );
  }
}
