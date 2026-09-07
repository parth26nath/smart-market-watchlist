import { Router } from "express";
import { z } from "zod";
import { createUser, findUserByEmail } from "../../storage/repositories/usersRepo.js";
import { createSession, deleteSession } from "../../storage/repositories/sessionsRepo.js";
import { verifyPassword } from "../../util/password.js";
import { createWatchlist } from "../../storage/repositories/watchlistsRepo.js";
import { COOKIE_NAME, requireAuth } from "../middleware/auth.js";
import type { AuthResponseDTO } from "@watchlist/shared";

export const authRouter = Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

function setSessionCookie(res: import("express").Response, token: string, expiresAt: Date): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    expires: expiresAt,
    secure: process.env.NODE_ENV === "production",
  });
}

authRouter.post("/signup", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const { email, password } = parsed.data;
  if (await findUserByEmail(email)) {
    res.status(409).json({ error: "email_taken" });
    return;
  }
  const user = await createUser(email, password);
  await createWatchlist(user.id, "My Watchlist"); // table-stakes onboarding: one default list, ready to use
  const { token, expiresAt } = await createSession(user.id);
  setSessionCookie(res, token, expiresAt);
  const body: AuthResponseDTO = { user: { id: user.id, email: user.email } };
  res.status(201).json(body);
});

authRouter.post("/login", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const { email, password } = parsed.data;
  const user = await findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const { token, expiresAt } = await createSession(user.id);
  setSessionCookie(res, token, expiresAt);
  const body: AuthResponseDTO = { user: { id: user.id, email: user.email } };
  res.json(body);
});

authRouter.post("/logout", async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) await deleteSession(token);
  res.clearCookie(COOKIE_NAME);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json({ userId: req.userId });
});
