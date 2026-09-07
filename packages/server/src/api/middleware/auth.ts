import type { NextFunction, Request, Response } from "express";
import { getSessionUser } from "../../storage/repositories/sessionsRepo.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "watchlist_session";
export { COOKIE_NAME };

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: "not_authenticated" });
    return;
  }
  const user = await getSessionUser(token);
  if (!user) {
    res.status(401).json({ error: "not_authenticated" });
    return;
  }
  req.userId = user.id;
  next();
}
