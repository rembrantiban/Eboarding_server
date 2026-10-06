import { Request, Response, NextFunction } from "express";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const verifyTurnstile = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.body?.turnstileToken;

  if (!token) {
    return res.status(400).json({ message: "Please complete the security check" });
  }

  try {
    const body = new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY || "",
      response: token,
    });
    if (req.ip) body.append("remoteip", req.ip);

    const response = await fetch(VERIFY_URL, { method: "POST", body });
    const data = (await response.json()) as { success: boolean; "error-codes"?: string[] };

    if (!data.success) {
      console.error("Turnstile verification failed:", data["error-codes"]);
      return res.status(403).json({ message: "Security check failed. Please try again." });
    }

    next();
  } catch (error) {
    console.error("Turnstile verification error:", error);
    return res.status(500).json({ message: "Unable to verify security check" });
  }
};
