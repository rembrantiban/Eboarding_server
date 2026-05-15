import { Request } from "express";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    user_type: string;
  };
}