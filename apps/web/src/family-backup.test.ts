import { expect, it } from "vitest";
import { encryptFamilyBackup, decryptFamilyBackup } from "./family-backup";
import type { FamilyConfig } from "@hub/contracts";
const config: FamilyConfig = {
  version: 1,
  profiles: [
    {
      id: "personal",
      name: "Tên riêng",
      topic: "secret_topic",
      enabled: true,
      city: "hanoi",
      sendTime: "07:00",
      days: [1],
      newsTopics: [],
      weather: true,
      airQuality: false,
      fuel: false,
      github: false,
    },
  ],
};
it("round-trips encrypted configuration and rejects wrong passwords/tampering before import", async () => {
  const password = "mat-khau-sao-luu";
  const text = await encryptFamilyBackup(config, password);
  expect(text).not.toContain("secret_topic");
  expect(text).not.toContain("Tên riêng");
  expect(await decryptFamilyBackup(text, password)).toEqual(config);
  await expect(
    decryptFamilyBackup(text, "mat-khau-khong-dung"),
  ).rejects.toThrow("Không mở được");
  const tampered = JSON.parse(text);
  tampered.ciphertext = "A" + tampered.ciphertext.slice(1);
  await expect(
    decryptFamilyBackup(JSON.stringify(tampered), password),
  ).rejects.toThrow();
  await expect(encryptFamilyBackup(config, "short")).rejects.toThrow("10");
  await expect(
    decryptFamilyBackup("x".repeat(128001), password),
  ).rejects.toThrow("quá lớn");
});
