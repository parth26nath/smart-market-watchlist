import { prisma } from "../prismaClient.js";
import { hashPassword } from "../../util/password.js";

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
}

export async function createUser(email: string, password: string) {
  return prisma.user.create({
    data: { email: email.toLowerCase(), passwordHash: hashPassword(password) },
  });
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}
