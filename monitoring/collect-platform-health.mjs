import { readFile } from 'node:fs/promises';
import { parsePlatformMetrics } from './platform-metrics.mjs';

const token = process.env.SUPABASE_ACCESS_TOKEN_KRYINEPHOR;
if (!token) throw new Error('Set SUPABASE_ACCESS_TOKEN_KRYINEPHOR in this process environment. Credentials are never written to the app.');
const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const ref = config.match(/^project_id\s*=\s*"([a-z0-9]+)"/m)?.[1];
if (!ref) throw new Error('No project ID found in Supabase config.');
let previous;
const base = `https://api.supabase.com/v1/projects/${ref}`;
const headers = { Authorization: `Bearer ${token}` };

async function collect() {
    const measuredAt = new Date().toISOString();
    const response = await fetch(`${base}/analytics/endpoints/metrics`, { headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Monitoring endpoint returned HTTP ${response.status}`);
    const { counters, snapshot } = parsePlatformMetrics(await response.text(), previous);
    previous = counters;
    const health = await fetch(`${base}/health?services=auth,db,realtime,rest,storage`, { headers, signal: AbortSignal.timeout(20_000) });
    if (health.ok) {
        const services = await health.json();
        if (Array.isArray(services)) snapshot.services = services.map(s => ({ name: s.name, status: s.status }));
    }
    // Only numeric summaries and coarse service statuses are persisted, never raw metrics.
    const payload = JSON.stringify(snapshot).replaceAll("'", "''");
    const query = `INSERT INTO public.platform_infrastructure_snapshot(id,measured_at,payload) VALUES(true,'${measuredAt}'::timestamptz,'${payload}'::jsonb)
      ON CONFLICT(id) DO UPDATE SET measured_at=excluded.measured_at,payload=excluded.payload;`;
    const saved = await fetch(`${base}/database/query`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ query }), signal: AbortSignal.timeout(20_000) });
    if (!saved.ok) throw new Error(`Snapshot storage returned HTTP ${saved.status}`);
    console.log(`${new Date().toISOString()} health snapshot saved`);
}

do {
    try { await collect(); } catch (error) { console.error(`${new Date().toISOString()} ${error.message}`); if (process.argv.includes('--once')) process.exitCode = 1; }
    if (process.argv.includes('--once')) break;
    await new Promise(resolve => setTimeout(resolve, 60_000));
} while (true);
