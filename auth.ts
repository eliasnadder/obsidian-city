/**
 * JWT Authentication Middleware
 * Optional JWT authentication for protected routes
 */

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// JWT configuration interface
export interface JwtConfig {
  secret: string;
  expiresIn: string | number;
  algorithm: jwt.Algorithm;
  issuer: string;
  audience: string;
}

// Default JWT config
const DEFAULT_JWT_CONFIG: JwtConfig = {
  secret: "change-this-secret-in-production",
  expiresIn: "24h",
  algorithm: "HS256",
  issuer: "obsidian-city",
  audience: "obsidian-city-api"
};

let jwtConfig: JwtConfig = DEFAULT_JWT_CONFIG;

/**
 * Initialize JWT configuration
 */
export function initJwt(config?: Partial<JwtConfig>): void {
  jwtConfig = {
    ...DEFAULT_JWT_CONFIG,
    ...config
  };
}

/**
 * Get current JWT config
 */
export function getJwtConfig(): JwtConfig {
  return jwtConfig;
}

/**
 * Check if JWT auth is enabled
 */
export function isJwtEnabled(): boolean {
  return !!process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32;
}

/**
 * JWT Authentication middleware
 * - If JWT_SECRET is not set, auth is bypassed (optional auth mode)
 * - If JWT_SECRET is set, token is required for protected routes
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // If JWT is not enabled, skip authentication
  if (!isJwtEnabled()) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Missing or invalid authorization header",
      hint: "Set JWT_SECRET in .env to enable authentication"
    });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, jwtConfig.secret, {
      algorithms: [jwtConfig.algorithm],
      issuer: jwtConfig.issuer,
      audience: jwtConfig.audience
    });

    (req as Request & { user: jwt.JwtPayload }).user = decoded as jwt.JwtPayload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Token expired"
      });
    } else if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Invalid token"
      });
    } else {
      res.status(401).json({
        error: "Unauthorized",
        message: "Authentication failed"
      });
    }
  }
}

/**
 * Generate a JWT token
 */
export function generateToken(payload: object): string {
  return jwt.sign(payload, jwtConfig.secret, {
    expiresIn: jwtConfig.expiresIn as jwt.SignOptions["expiresIn"],
    issuer: jwtConfig.issuer,
    audience: jwtConfig.audience
  });
}

/**
 * Verify a JWT token
 */
export function verifyToken(token: string): jwt.JwtPayload | null {
  try {
    return jwt.verify(token, jwtConfig.secret, {
      algorithms: [jwtConfig.algorithm],
      issuer: jwtConfig.issuer,
      audience: jwtConfig.audience
    }) as jwt.JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Optional auth middleware - attaches user if token present, continues otherwise
 */
export function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // If JWT is not enabled, skip
  if (!isJwtEnabled()) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, jwtConfig.secret, {
      algorithms: [jwtConfig.algorithm],
      issuer: jwtConfig.issuer,
      audience: jwtConfig.audience
    });

    (req as Request & { user: jwt.JwtPayload }).user = decoded as jwt.JwtPayload;
  } catch {
    // Token invalid but optional - continue without user
  }

  next();
}
