import { pool } from "@workspace/db";

// Called exclusively by verify-deployment, with a fresh disposable DATABASE_URL.
try {
  const { rows: [name] } = await pool.query("SELECT current_database() AS name");
  if (!/^deployment_check_[a-f0-9]{32}$/.test(name.name))
    throw new Error("This check only runs in a disposable deployment database.");
  if (process.argv[2] !== "check") {
    await pool.query(`UPDATE pricing_configs
      SET config=jsonb_set(config, '{monthlyPlacementRate}', '0.012345'::jsonb)
      WHERE id='default'`);
    await pool.query(`INSERT INTO pricing_config_history
      (id, config_id, before_config, after_config, reason)
      SELECT 'deployment-seed-verification', 'default',
        jsonb_build_object('config', config, 'updated_at', updated_at),
        config, 'Disposable test snapshot only'
      FROM pricing_configs WHERE id='default'`);
  } else {
    const { rows: [result] } = await pool.query(`SELECT
      p.config = s.before_config->'config'
        AND p.updated_at = (s.before_config->>'updated_at')::timestamptz AS preserved
      FROM pricing_configs p CROSS JOIN pricing_config_history s
      WHERE p.id='default' AND s.id='deployment-seed-verification'`);
    if (!result?.preserved) throw new Error("Repeated migration/seed changed the operator's existing configuration.");
  }
} finally { await pool.end(); }
