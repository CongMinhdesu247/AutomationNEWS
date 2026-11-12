import sodium from "libsodium-wrappers";
import { z } from "zod";
import { familyConfigSchema, type FamilyConfig } from "@hub/contracts";
import { GithubStateStore, type CloudState } from "../cloud/state.js";

export type FamilyCloudAdmin = {
  configured: boolean;
  sync(config: FamilyConfig): Promise<void>;
  test(profileId: string): Promise<void>;
  state?(): Promise<CloudState>;
};
export function githubFamilyAdmin(
  repository?: string,
  token?: string,
  http: typeof fetch = fetch,
): FamilyCloudAdmin {
  const configured = Boolean(
    repository && /^[\w.-]+\/[\w.-]+$/.test(repository) && token,
  );
  const api = async (path: string, method = "GET", body?: unknown) => {
    if (!configured)
      throw new Error("Chưa cấu hình kết nối quản trị cloud trên máy này.");
    const response = await http(
      "https://api.github.com/repos/" + repository + path,
      {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    if (!response.ok)
      throw new Error(
        "Cloud chưa xác nhận yêu cầu (HTTP " + response.status + ").",
      );
    return response.status === 204 ? null : response.json();
  };
  return {
    configured,
    async state() {
      if (!configured) throw new Error("Cloud unavailable");
      return (await new GithubStateStore(repository!, token!, http).load())
        .state;
    },
    async sync(config) {
      const text = JSON.stringify(familyConfigSchema.parse(config));
      if (Buffer.byteLength(text) > 48000)
        throw new Error("Cấu hình gia đình vượt giới hạn.");
      const key = z
        .object({ key: z.string().max(100), key_id: z.string().max(100) })
        .parse(await api("/actions/secrets/public-key"));
      await sodium.ready;
      const sealed = sodium.crypto_box_seal(
        sodium.from_string(text),
        sodium.from_base64(key.key, sodium.base64_variants.ORIGINAL),
      );
      await api("/actions/secrets/HUB_FAMILY_JSON", "PUT", {
        key_id: key.key_id,
        encrypted_value: sodium.to_base64(
          sealed,
          sodium.base64_variants.ORIGINAL,
        ),
      });
    },
    async test(profileId) {
      await api("/actions/workflows/morning-digest.yml/dispatches", "POST", {
        ref: "main",
        inputs: { dry_run: "false", force_send: "true", profile_id: profileId },
      });
    },
  };
}
