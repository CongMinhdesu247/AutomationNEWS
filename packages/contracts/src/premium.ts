import { z } from "zod";
const words = z.array(z.string().trim().min(1).max(100)).max(20);
export const watchConditionsSchema = z
  .object({
    include: words.default([]),
    exclude: words.default([]),
    regions: words.default([]),
    opportunityTypes: words.default([]),
    deadlineAfter: z.iso.date().nullable().default(null),
  })
  .strict();
export type WatchConditions = z.infer<typeof watchConditionsSchema>;
export const watchSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(2000).default(""),
    conditions: watchConditionsSchema,
    sourceIds: z.array(z.uuid()).min(1).max(8),
    intervalMinutes: z.number().int().min(60).max(43200),
    enabled: z.boolean(),
    lookbackDays: z.number().int().min(1).max(30).default(1),
    confirmed: z.literal(true),
  })
  .strict();
export type WatchInput = z.infer<typeof watchSchema>;
export const aiControlSchema = z
  .object({
    enabled: z.boolean(),
    searchEnabled: z.boolean(),
    searchProvider: z.enum(["disabled", "brave"]).default("disabled"),
    searchStorageAllowed: z.boolean().default(false),
    searchUnitMicros: z.number().int().min(0).max(1000000).default(0),
    searchPricingVersion: z.string().max(100).default(""),
    dailySearchUnits: z.number().int().min(0).max(10000).default(0),
    monthlySearchUnits: z.number().int().min(0).max(100000).default(0),
    dailyMicros: z.number().int().min(0).max(1e9),
    monthlyMicros: z.number().int().min(0).max(1e10),
    dailyCalls: z.number().int().min(0).max(10000),
    monthlyTokens: z.number().int().min(0).max(1e8),
    concurrency: z.number().int().min(1).max(3),
    maxPendingPerUser: z.number().int().min(1).max(10).default(3),
    provider: z.enum(["disabled", "gemini"]),
    model: z
      .string()
      .max(100)
      .regex(/^[a-zA-Z0-9._-]*$/),
    pricingVersion: z.string().max(100),
    inputMicrosPerMillion: z.number().int().min(0).max(1e9),
    outputMicrosPerMillion: z.number().int().min(0).max(1e9),
    timeoutMs: z.number().int().min(1000).max(30000),
  })
  .strict()
  .refine(
    (c) =>
      !c.searchEnabled ||
      (c.searchProvider !== "disabled" &&
        c.searchStorageAllowed &&
        c.searchUnitMicros > 0 &&
        !!c.searchPricingVersion),
    "Cần nhà cung cấp và giá tìm kiếm đã xác minh.",
  )
  .refine(
    (c) =>
      !c.enabled ||
      (c.provider !== "disabled" &&
        !!c.model &&
        !!c.pricingVersion &&
        c.inputMicrosPerMillion > 0 &&
        c.outputMicrosPerMillion > 0),
    "Cần provider, model và bảng giá đã xác minh.",
  );
export type AiControl = z.infer<typeof aiControlSchema>;
export const enrichmentSchema = z
  .object({
    summary: z.string().max(600),
    regions: words,
    opportunityTypes: words,
    deadline: z.iso.date().nullable(),
    evidence: z.array(z.string().min(1).max(300)).max(8),
  })
  .strict();
export const topicSummarySchema = z
  .object({ summary: z.string().trim().min(1).max(2000) })
  .strict();
