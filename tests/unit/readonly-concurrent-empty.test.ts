/** Calibra 2.0 Phase 1: concurrent GET/page burst against a empty throwaway DB (see _readonly-concurrent.ts). */
import { runConcurrentSuite } from "./_readonly-concurrent";

runConcurrentSuite("empty");
