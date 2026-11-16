import { createPool } from "../../apps/api/src/db.js";
import { migrate } from "../../apps/api/src/migrate.js";
import { initialSettings } from "../../apps/api/src/accounts/preferences.js";
import { WorkflowQueue } from "../../apps/api/src/workflows/queue.js";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !/^\/hub_restore_premium_source_[a-z0-9_]+$/.test(new URL(url).pathname)
)
  throw new Error("Requires new isolated fixture restore source");
const pool = createPool(url);
try {
  await migrate(pool);
  const user = crypto.randomUUID(),
    digest = crypto.randomUUID();
  await pool.query(
    "INSERT INTO hub_users(id,email,name,password_hash) VALUES($1,'restore@fixture.invalid','Restore fixture','not-a-real-password')",
    [user],
  );
  await pool.query(
    "INSERT INTO user_settings(user_id,config,next_run_at) VALUES($1,$2::jsonb,now()+interval '1 day')",
    [user, JSON.stringify(initialSettings("https://ntfy.fixture.invalid/"))],
  );
  await pool.query(
    "INSERT INTO digests(id,idempotency_key,settings_snapshot,status,sources,user_id,completed_at) SELECT $1,$1,config,'success','{}',$2,now() FROM user_settings WHERE user_id=$2",
    [digest, user],
  );
  await pool.query(
    "UPDATE news_entitlements SET plan_id='premium',expires_at=now()+interval '30 days' WHERE user_id=$1",
    [user],
  );
  await pool.query(
    "INSERT INTO news_audit(actor_id,subject_id,action,details) VALUES($1,$1,'restore.fixture','{}')",
    [user],
  );
  const source = crypto.randomUUID(),
    watch = crypto.randomUUID(),
    article = crypto.randomUUID();
  await pool.query(
    "INSERT INTO news_sources(id,name,url,status) VALUES($1,'Restore RSS','https://fixture.invalid/rss','approved')",
    [source],
  );
  await pool.query(
    "INSERT INTO news_watches(id,user_id,name,description,conditions,source_ids,interval_minutes,enabled) VALUES($1,$2,'Restore watch','Private fixture','{}',$3,360,true)",
    [watch, user, [source]],
  );
  await pool.query("INSERT INTO news_watch_sources VALUES($1,$2)", [
    watch,
    source,
  ]);
  await pool.query(
    "INSERT INTO news_articles(id,url,content_hash,title,description,published_at) VALUES($1,'https://fixture.invalid/item','fixture-hash','Restore news','Short excerpt',now())",
    [article],
  );
  await pool.query("INSERT INTO news_source_articles VALUES($1,$2)", [
    source,
    article,
  ]);
  await pool.query(
    "INSERT INTO news_matches(watch_id,user_id,article_id,source_id,condition_version,reason,saved) VALUES($1,$2,$3,$4,1,'Fixture evidence',true)",
    [watch, user, article, source],
  );
  await pool.query(
    "INSERT INTO news_digest_items(user_id,article_id,digest_id) VALUES($1,$2,$3)",
    [user, article, digest],
  );
  await pool.query("INSERT INTO news_preferences(user_id) VALUES($1)", [user]);
  const queue = new WorkflowQueue(pool),
    run = await queue.transaction((c) =>
      queue.enqueueTask(c, crypto.randomUUID(), user, "interpret", {
        description: "Private fixture",
      }),
    );
  await pool.query(
    "INSERT INTO news_usage(id,run_id,user_id,kind,provider,model,pricing_version,pricing,status,reserved_micros,reserved_tokens) VALUES($1,$2,$3,'interpret','fake','fixture','fixture','{}','unknown',1000,18000)",
    [crypto.randomUUID(), run, user],
  );
  await pool.query(
    "INSERT INTO news_enrichment(content_hash,processing_version,result) VALUES('fixture-hash','fixture.v1','{}')",
  );
  await pool.query(
    "INSERT INTO news_discovery_cache(cache_key,result) VALUES('restore-fixture','{\"candidates\":[]}'::jsonb)",
  );
  await pool.query(
    "INSERT INTO news_plan_requests(user_id,status,note) VALUES($1,'approved','Restore signup fixture')",
    [user],
  );
  console.log(
    "Isolated restore fixture seeded; no worker/scheduler/provider/notification started.",
  );
} finally {
  await pool.end();
}
