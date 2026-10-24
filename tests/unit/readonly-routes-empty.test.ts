/** B2 get-fix: every GET route handler and server page/layout is read-only against a empty throwaway DB. */
import { runReadonlySuite } from "./_readonly-run";

runReadonlySuite("empty");
