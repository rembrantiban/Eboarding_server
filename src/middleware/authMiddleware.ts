import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export const verifyAdmin = (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;

    if (decoded.user_type !== "Admin") {
      return res.status(403).json({ message: "Admin access only" });
    }

    (req as any).user = decoded;
    next();

  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
    }
    };