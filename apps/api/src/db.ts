import pg from "pg";
export function createPool(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
  });
  // Never log connection errors: drivers may include credentials or host details.
  pool.on("error", () => {
    console.error("Kết nối database nhàn rỗi bị gián đoạn.");
  });
  return pool;
}
