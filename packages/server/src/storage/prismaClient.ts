import { PrismaClient } from "@prisma/client";

// Single shared client. This file is the only place `@prisma/client` is
// imported outside of the repositories — domain/api code depends on the
// repository interfaces, never on Prisma directly (module boundaries, see README).
export const prisma = new PrismaClient();
