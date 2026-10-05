/** Shared across CoinGecko adapters so a 429 stops further CoinGecko calls in this process. */
let blocked = false;

export function coingeckoBlocked() {
  return blocked;
}

export function blockCoingecko() {
  blocked = true;
}
