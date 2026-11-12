import { familyConfigSchema, type FamilyConfig } from "@hub/contracts";
const iterations = 250000;
const encode = (v: Uint8Array) =>
  btoa(Array.from(v, (c) => String.fromCharCode(c)).join(""));
const decode = (v: string) => Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
async function key(password: string, salt: Uint8Array) {
  if (password.length < 10 || password.length > 200)
    throw Error("Mật khẩu cần từ 10 đến 200 ký tự.");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
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
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(
    JSON.stringify(familyConfigSchema.parse(config)),
  );
  if (data.length > 64000) throw Error("Cấu hình vượt giới hạn sao lưu.");
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(password, salt),
    data,
  );
  return JSON.stringify(
    {
      format: "hub-family-backup",
      version: 1,
      iterations,
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
  if (text.length > 128000) throw Error("Tệp sao lưu quá lớn.");
  try {
    const value = JSON.parse(text);
    if (
      value.format !== "hub-family-backup" ||
      value.version !== 1 ||
      value.iterations !== iterations ||
      typeof value.salt !== "string" ||
      typeof value.iv !== "string" ||
      typeof value.ciphertext !== "string"
    )
      throw Error();
    const salt = decode(value.salt),
      iv = decode(value.iv);
    if (salt.length !== 16 || iv.length !== 12) throw Error();
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await key(password, salt),
      decode(value.ciphertext),
    );
    return familyConfigSchema.parse(
      JSON.parse(new TextDecoder().decode(plain)),
    );
  } catch {
    throw Error(
      "Không mở được sao lưu. Kiểm tra mật khẩu và đúng tệp của ứng dụng.",
    );
  }
}
