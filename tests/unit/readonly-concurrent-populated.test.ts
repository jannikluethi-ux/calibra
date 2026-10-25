/** Calibra 2.0 Phase 1: concurrent GET/page burst against a populated throwaway DB (see _readonly-concurrent.ts). */
import { runConcurrentSuite } from "./_readonly-concurrent";

runConcurrentSuite("populated");
