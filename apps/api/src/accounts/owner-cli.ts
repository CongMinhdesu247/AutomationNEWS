import "../env.js";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createPool } from "../db.js";
import { databaseUrl } from "../env.js";
import { hashPassword } from "./password.js";
import { initialSettings } from "./preferences.js";
// Read a one-time password file inside the container; never print its contents.
const email = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .parse(process.env.OWNER_EMAIL);
const password = z
  .string()
  .min(12)
  .max(128)
  .parse(
    (
      await readFile(
        process.env.OWNER_PASSWORD_FILE ?? "/run/secrets/owner_password",
        "utf8",
      )
    ).trimEnd(),
  );
const hash = await hashPassword(password);
const action = z
  .enum(["create-owner", "reset-password"])
  .parse(process.env.ACCOUNT_ACTION ?? "create-owner");
const pool = createPool(databaseUrl());
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(73142002)");
  const owner =
    action === "create-owner"
      ? (
          await client.query(
            "INSERT INTO hub_users(id,email,name,password_hash,role) VALUES($1,$2,'Quản trị viên',$3,'admin') ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,role='admin',disabled=false RETURNING id",
            [crypto.randomUUID(), email, hash],
          )
        ).rows[0]
      : (
          await client.query(
            "UPDATE hub_users SET password_hash=$2 WHERE email=$1 RETURNING id",
            [email, hash],
          )
        ).rows[0];
  if (!owner) throw new Error("Account not found");
  const config = initialSettings(
    process.env.ACCOUNT_NTFY_URL ?? "https://ntfy.sh/",
  );
  // Keep the personal dashboard intact; copy its settings once to the owner's account.
  const legacy = (await client.query("SELECT config FROM settings WHERE id=1"))
    .rows[0]?.config;
  await client.query(
    "INSERT INTO user_settings(user_id,config) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO NOTHING",
    [
      owner.id,
      JSON.stringify(
        legacy
          ? {
              ...legacy,
              newsletter: { ...legacy.newsletter, enabled: false },
              notifications: legacy.notifications?.topic
                ? legacy.notifications
                : config.notifications,
            }
          : config,
      ),
    ],
  );
  await client.query("DELETE FROM user_sessions WHERE user_id=$1", [owner.id]);
  if (action === "create-owner" && process.env.CLAIM_LEGACY_DATA === "true") {
    await client.query(
      "UPDATE workflow_runs SET user_id=$1 WHERE user_id IS NULL",
      [owner.id],
    );
    await client.query("UPDATE digests SET user_id=$1 WHERE user_id IS NULL", [
      owner.id,
    ]);
  }
  await client.query("COMMIT");
  console.log("Đã cập nhật tài khoản và thu hồi các phiên đăng nhập cũ.");
} catch {
  await client.query("ROLLBACK");
  console.error("Không thể tạo quản trị viên. Kiểm tra cấu hình và migration.");
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
