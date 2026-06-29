// Overlap predicate for two contract windows on the same project, mirroring the
// orchestrator's assertNoOverlap (orchestrator/db/repositories/projectRates.ts):
// a null end_date is open-ended (+infinity), represented by the sentinel.
const SENTINEL_END = '9999-12-31';

export function contractsOverlap(
  aFrom: string,
  aEnd: string | null,
  bFrom: string,
  bEnd: string | null,
): boolean {
  return aFrom <= (bEnd ?? SENTINEL_END) && (aEnd ?? SENTINEL_END) >= bFrom;
}
