import { prisma } from "../prismaClient.js";

/** Every source/retry disagreement is logged, never silently overwritten (DECISIONS.md §4). */
export async function logConflict(params: {
  symbol: string;
  asOf: Date;
  sourceA: string;
  valueA: number;
  sourceB: string;
  valueB: number;
  resolution: string;
}): Promise<void> {
  await prisma.ingestionConflict.create({ data: { ...params } });
}
