import { z } from "zod";
import { defaultSettings, settingsSchema, type Settings } from "@hub/contracts";
import { randomBytes } from "node:crypto";
export const accountPreferencesSchema = z
  .object({
    settings: settingsSchema,
    days: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((v) => new Set(v).size === v.length),
    theme: z.enum(["light", "dark"]),
    revision: z.number().int().positive(),
  })
  .strict();
export function initialSettings(serverUrl: string): Settings {
  const value = structuredClone(defaultSettings);
  value.newsletter.enabled = false;
  value.notifications = {
    enabled: false,
    serverUrl,
    topic: "hub_" + randomBytes(24).toString("hex"),
  };
  return value;
}
