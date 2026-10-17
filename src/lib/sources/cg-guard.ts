/**
 * Shared across CoinGecko adapters so a 429 pauses further CoinGecko calls in this process.
 * Time-bounded (15 min) so the long-running server's scheduled crypto job can resume later
 * (previously the block lasted for the whole process lifetime).
 */
const BLOCK_MS = 15 * 60_000;
let blockedUntil = 0;

export function coingeckoBlocked(now = Date.now()) {
  return now < blockedUntil;
}

export function blockCoingecko(now = Date.now()) {
  blockedUntil = now + BLOCK_MS;
}

export function resetCoingeckoBlock() {
  blockedUntil = 0;
}
