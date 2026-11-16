import type { Pool, PoolClient } from "pg";
import { RequestError } from "../digests/service.js";
import type { WatchConditions } from "@hub/contracts";
export type Db = Pool | PoolClient;
export const fail = (status: number, code: string, message: string): never => {
  throw new RequestError(status, code, message);
};
export async function entitlement(db: Db, userId: string) {
  const result = await db.query(
    `SELECT p.*,e.plan_id AS granted_plan,e.starts_at,e.expires_at,e.status,
    (e.plan_id='premium' AND e.status='active' AND e.starts_at<=now() AND e.expires_at>now()) AS premium
    FROM hub_users u LEFT JOIN news_entitlements e ON e.user_id=u.id
    JOIN news_plans p ON p.id=CASE WHEN e.plan_id='premium' AND e.status='active' AND e.starts_at<=now() AND e.expires_at>now() THEN 'premium' ELSE 'free' END
    WHERE u.id=$1 AND NOT u.disabled`,
    [userId],
  );
  return (
    result.rows[0] ??
    fail(403, "ACCOUNT_DISABLED", "Tài khoản không hoạt động.")
  );
}
export async function requirePremium(db: Db, userId: string) {
  const plan = await entitlement(db, userId);
  if (!plan.premium)
    fail(
      403,
      "PREMIUM_REQUIRED",
      "Cần Premium thử nghiệm còn hạn. Nhu cầu và kết quả đã lưu vẫn được giữ lại.",
    );
  return plan;
}
export async function audit(
  db: Db,
  actor: string,
  subject: string | null,
  action: string,
  details: unknown,
) {
  await db.query(
    "INSERT INTO news_audit(actor_id,subject_id,action,details) VALUES($1,$2,$3,$4::jsonb)",
    [actor, subject, action, JSON.stringify(details)],
  );
}
const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
// Every include term is required. Region/type groups use OR within each group.
// Deadline must be explicit ISO evidence; unknown dates never satisfy a date constraint.
export function matchConditions(
  c: WatchConditions,
  text: string,
): string | null {
  const normalized = fold(text);
  const has = (s: string) => normalized.includes(fold(s));
  if (c.exclude.some(has) || !c.include.every(has)) return null;
  if (
    [c.regions, c.opportunityTypes].some(
      (group) => group.length && !group.some(has),
    )
  )
    return null;
  if (c.deadlineAfter) {
    const dates = [
      ...text.matchAll(
        /(?:deadline|closing date|hạn chót|hạn đăng ký|hạn nộp)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})/gi,
      ),
    ].map((m) => m[1]!);
    if (!dates.some((date) => date >= c.deadlineAfter!)) return null;
  }
  return (
    [
      ...c.include,
      ...c.regions.filter(has),
      ...c.opportunityTypes.filter(has),
      ...(c.deadlineAfter
        ? ["Có ngày ISO từ " + c.deadlineAfter + "; cần xác minh hạn tại nguồn"]
        : []),
    ].join(" · ") || "Khớp phạm vi nguồn đã chọn"
  );
}

export async function attachCustomDigest(
  client: PoolClient,
  digestId: string,
  userId: string | null,
) {
  if (!userId) return;
  const plan = await entitlement(client, userId).catch(() => null);
  if (!plan?.premium) return;
  const pref = (
    await client.query(
      "SELECT include_digest FROM news_preferences WHERE user_id=$1",
      [userId],
    )
  ).rows[0];
  if (pref?.include_digest === false) return;
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "custom-digest:" + userId,
  ]);
  const rows = (
    await client.query(
      `SELECT a.id,a.title,a.url,a.description,a.published_at,max(s.name) AS source,
    string_agg(DISTINCT m.reason,'; ') AS reason FROM news_matches m
    JOIN news_watches w ON w.id=m.watch_id JOIN news_articles a ON a.id=m.article_id JOIN news_sources s ON s.id=m.source_id
    WHERE m.user_id=$1 AND NOT m.hidden AND w.deleted_at IS NULL AND w.enabled
    AND a.published_at>now()-interval '7 days' AND NOT EXISTS(SELECT 1 FROM news_digest_items d WHERE d.user_id=$1 AND d.article_id=a.id)
    GROUP BY a.id ORDER BY a.published_at DESC,a.id LIMIT 10`,
      [userId],
    )
  ).rows;
  if (!rows.length) return;
  for (const row of rows)
    await client.query(
      "INSERT INTO news_digest_items(user_id,article_id,digest_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [userId, row.id, digestId],
    );
  const source = {
    status: "success",
    fetchedAt: new Date().toISOString(),
    errors: [],
    data: {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        url: r.url,
        description: r.description,
        source: r.source,
        publishedAt: new Date(r.published_at).toISOString(),
        reason: r.reason,
      })),
    },
  };
  await client.query(
    "UPDATE digests SET sources=jsonb_set(sources,'{custom}',$2::jsonb) WHERE id=$1",
    [digestId, JSON.stringify(source)],
  );
}
