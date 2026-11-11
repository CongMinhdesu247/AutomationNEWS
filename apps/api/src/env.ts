import { config } from "dotenv";
import { fileURLToPath } from "node:url";
config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});
export function databaseUrl(): string {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL chưa được cấu hình.");
  return process.env.DATABASE_URL;
}
