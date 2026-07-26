import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const verifyToken = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Access denied. No token provided.' });
      return;
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      res.status(401).json({ error: 'Access denied. Token missing.' });
      return;
    }

    const secretKey = process.env.JWT_SECRET || 'default-secret-key';
    const decoded = jwt.verify(token, secretKey);

    (req as any).user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

// Role-based authorization middleware — must be used AFTER verifyToken
export const verifyCreator = (req: Request, res: Response, next: NextFunction): void => {
  const role = (req as any).user?.role;
  if (role !== 'Creator') {
    res.status(403).json({ error: 'Access denied. Creator role required.' });
    return;
  }
  next();
};

export const verifySupporter = (req: Request, res: Response, next: NextFunction): void => {
  const role = (req as any).user?.role;
  if (role !== 'Supporter') {
    res.status(403).json({ error: 'Access denied. Supporter role required.' });
    return;
  }
  next();
};

export const verifyAdmin = (req: Request, res: Response, next: NextFunction): void => {
  const role = (req as any).user?.role;
  if (role !== 'Admin') {
    res.status(403).json({ error: 'Access denied. Admin role required.' });
    return;
  }
  next();
};
