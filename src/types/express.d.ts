import "express";

declare module "express-serve-static-core" {
  interface Request {
    user?: {
      id: number;
      user_type: string;
    };

    file?: Express.Multer.File;
    files?: Express.Multer.File[];
  }
}