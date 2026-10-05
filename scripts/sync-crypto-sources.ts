/**
 * One-shot source sync for crypto intelligence.
 * Calls no-key providers through the adapter registry and recomputes canonical fields.
 * Does not delete gfi.db. Does not commit.
 */
import { runCryptoSourceSync } from "../src/lib/sources/sync";

async function main() {
  const report = await runCryptoSourceSync();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
