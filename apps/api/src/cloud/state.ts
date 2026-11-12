import { z } from "zod";
import type { BaselineLoader } from "../connectors/github.js";
import type { TranslationCache } from "../connectors/vietnamese.js";

const snapshotSchema = z
  .object({
    id: z.number().int().positive(),
    stars: z.number().int().nonnegative(),
    fetchedAt: z.iso.datetime(),
  })
  .strict();
export const cloudStateSchema = z
  .object({
    version: z.literal(1),
    fuelBaseline: z.object({ at: z.iso.datetime(), prices: z.record(z.string().max(64), z.number().int().min(1000).max(100000)) }).strict().optional(),
    snapshots: z.array(snapshotSchema).max(5000),
    deliveries: z.record(
      z.string().regex(/^\d{4}-\d{2}-\d{2}(?::[a-f0-9]{16})?$/),
      z
        .object({
          status: z.enum(["reserved", "sent", "failed", "unknown"]),
          at: z.iso.datetime(),
        })
        .strict(),
    ),
    translations: z
      .record(
        z.string().regex(/^[a-f0-9]{64}$/),
        z
          .object({
            text: z.string().min(1).max(600),
            createdAt: z.iso.datetime(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type CloudState = z.infer<typeof cloudStateSchema>;
export const initialState = (): CloudState => ({
  version: 1,
  snapshots: [],
  deliveries: {},
});
export type StateRevision = { state: CloudState; sha?: string };
const shaResponse = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) });
const fileResponse = shaResponse.extend({
  size: z.number().max(900000),
  encoding: z.literal("base64"),
  content: z.string().max(1300000),
});
export interface CloudStateStore {
  load(): Promise<StateRevision>;
  save(state: CloudState, previousSha?: string): Promise<string>;
}

export function baselineLoader(state: CloudState): BaselineLoader {
  return async (ids, at) => {
    const wanted = new Set(ids);
    const selected = new Map<number, { stars: number; fetchedAt: string }>();
    for (const snapshot of state.snapshots) {
      const hours = (at.getTime() - Date.parse(snapshot.fetchedAt)) / 3600000;
      if (!wanted.has(snapshot.id) || hours < 20 || hours > 28) continue;
      const old = selected.get(snapshot.id);
      const distance = Math.abs(hours - 24);
      if (
        !old ||
        distance <
          Math.abs((at.getTime() - Date.parse(old.fetchedAt)) / 3600000 - 24)
      )
        selected.set(snapshot.id, {
          stars: snapshot.stars,
          fetchedAt: snapshot.fetchedAt,
        });
    }
    return selected;
  };
}

export function pruneState(state: CloudState, at: Date): CloudState {
  const cutoff = at.getTime() - 3 * 86400000;
  return {
    version: 1,
    ...(state.fuelBaseline && Date.parse(state.fuelBaseline.at) <= +at && +at - Date.parse(state.fuelBaseline.at) <= 14 * 86400000 ? { fuelBaseline: state.fuelBaseline } : {}),
    ...(state.translations
      ? {
          translations: Object.fromEntries(
            Object.entries(state.translations)
              .filter(
                ([, value]) =>
                  at.getTime() - Date.parse(value.createdAt) < 30 * 86400000,
              )
              .sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt))
              .slice(0, 150),
          ) as TranslationCache,
        }
      : {}),
    snapshots: state.snapshots
      .filter(
        (value) =>
          Date.parse(value.fetchedAt) >= cutoff &&
          Date.parse(value.fetchedAt) <= at.getTime(),
      )
      .slice(-4000),
    deliveries: Object.fromEntries(
      Object.entries(state.deliveries).filter(
        ([, value]) => Date.parse(value.at) >= at.getTime() - 14 * 86400000,
      ),
    ),
  };
}

// Only public repo IDs/star counts, translated public descriptions, fuel-price baseline and delivery state live here.
// No settings, coordinates, topic, article content or credentials are persisted.
export class GithubStateStore implements CloudStateStore {
  private base: string;
  constructor(
    private repository: string,
    private token: string,
    private http: typeof fetch = fetch,
  ) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !token)
      throw new Error("Cloud GitHub credentials/configuration missing.");
    this.base = "https://api.github.com/repos/" + repository;
  }
  private async api(
    path: string,
    method = "GET",
    body?: unknown,
    allowMissing = false,
  ) {
    const response = await this.http(this.base + path, {
      method,
      signal: AbortSignal.timeout(20000),
      redirect: "error",
      headers: {
        Authorization: "Bearer " + this.token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        "Cloud state API failed (HTTP " +
          response.status +
          "). No automatic send.",
      );
    return response.json();
  }
  async load(): Promise<StateRevision> {
    const branch = await this.api(
      "/git/ref/heads/hub-cloud-state",
      "GET",
      undefined,
      true,
    );
    if (!branch) return { state: initialState() };
    const file = fileResponse.parse(
      await this.api("/contents/state.json?ref=hub-cloud-state"),
    );
    return {
      state: cloudStateSchema.parse(
        JSON.parse(Buffer.from(file.content, "base64").toString("utf8")),
      ),
      sha: file.sha,
    };
  }
  async save(state: CloudState, previousSha?: string): Promise<string> {
    const content = JSON.stringify(cloudStateSchema.parse(state));
    if (Buffer.byteLength(content) > 900000)
      throw new Error("Cloud state size limit.");
    if (!previousSha) {
      // Orphan data branch: no source/configuration is copied into it.
      const tree = shaResponse.parse(
        await this.api("/git/trees", "POST", {
          tree: [{ path: "state.json", mode: "100644", type: "blob", content }],
        }),
      );
      const commit = shaResponse.parse(
        await this.api("/git/commits", "POST", {
          message: "Initialize cloud digest state",
          tree: tree.sha,
          parents: [],
        }),
      );
      await this.api("/git/refs", "POST", {
        ref: "refs/heads/hub-cloud-state",
        sha: commit.sha,
      });
      const saved = shaResponse.parse(
        await this.api("/contents/state.json?ref=hub-cloud-state"),
      );
      return saved.sha;
    }
    const saved = z.object({ content: shaResponse }).parse(
      await this.api("/contents/state.json", "PUT", {
        message: "Update cloud digest state",
        branch: "hub-cloud-state",
        sha: previousSha,
        content: Buffer.from(content).toString("base64"),
      }),
    );
    return saved.content.sha;
  }
}
