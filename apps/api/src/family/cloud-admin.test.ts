import { expect, it } from "vitest";
import sodium from "libsodium-wrappers";
import { githubFamilyAdmin } from "./cloud-admin.js";
import type { FamilyConfig } from "@hub/contracts";
it("encrypts family configuration for GitHub and targets only one profile in a manual test", async () => {
  await sodium.ready;
  const keys = sodium.crypto_box_keypair();
  const calls: { url: string; body: any }[] = [];
  const http: typeof fetch = async (url, options) => {
    calls.push({
      url: String(url),
      body: options?.body ? JSON.parse(String(options.body)) : null,
    });
    return options?.method === "PUT" || options?.method === "POST"
      ? new Response(null, { status: 204 })
      : new Response(
          JSON.stringify({
            key: sodium.to_base64(
              keys.publicKey,
              sodium.base64_variants.ORIGINAL,
            ),
            key_id: "key-id",
          }),
        );
  };
  const config: FamilyConfig = {
    version: 1,
    profiles: [
      {
        id: "personal",
        name: "Private name",
        enabled: true,
        city: "hanoi",
        newsTopics: [],
        sendTime: "07:00",
        days: [1],
        weather: true,
        airQuality: false,
        fuel: false,
        github: false,
        topic: "secret_topic",
      },
    ],
  };
  const admin = githubFamilyAdmin("owner/repo", "sensitive-token", http);
  await admin.sync(config);
  expect(JSON.stringify(calls)).not.toContain("secret_topic");
  expect(JSON.stringify(calls)).not.toContain("Private name");
  const cipher = sodium.from_base64(
    calls[1]!.body.encrypted_value,
    sodium.base64_variants.ORIGINAL,
  );
  expect(
    JSON.parse(
      sodium.to_string(
        sodium.crypto_box_seal_open(cipher, keys.publicKey, keys.privateKey),
      ),
    ),
  ).toEqual(config);
  await admin.test("personal");
  expect(calls[2]!.body.inputs).toEqual({
    dry_run: "false",
    force_send: "true",
    profile_id: "personal",
  });
});
