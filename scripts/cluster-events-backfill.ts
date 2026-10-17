/**
 * One-off / repeatable backfill for event_cluster_v1 over all stored live events.
 * Additive only: writes link rows (event_clusters) and audit rows (event_cluster_history); never deletes events.
 * Idempotent: a second run reports 0 new links. Take a verified backup first (scripts/backup-db.py).
 *   node_modules/.bin/tsx scripts/cluster-events-backfill.ts [--days N]
 */
import { runEventClustering, getClusterMetrics } from "../src/lib/ingestion/cluster";

const i = process.argv.indexOf("--days");
const days = i > 0 ? Number(process.argv[i + 1]) : 3650;
const before = getClusterMetrics();
const r = runEventClustering({ sinceDays: days });
const after = getClusterMetrics();
console.log(JSON.stringify({ sinceDays: days, before, run: r, after }, null, 2));
