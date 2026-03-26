/**
 * Config Validator - Validates environment variables on startup
 */

import * as fs from "fs";
import * as path from "path";

interface EnvVar {
  key: string;
  type: "string" | "number";
  canBeEmpty?: boolean;
  default?: number | string;
}

const REQUIRED_ENV_VARS: EnvVar[] = [
  { key: "VAULT_PATH", type: "string", canBeEmpty: false }
];

const OPTIONAL_ENV_VARS: EnvVar[] = [
  { key: "OBSIDIAN_CITY_PORT", type: "number", default: 3333 },
  { key: "CACHE_TTL", type: "number", default: 300 },
  { key: "RATE_LIMIT_WINDOW", type: "number", default: 15 * 60 * 1000 },
  { key: "RATE_LIMIT_MAX", type: "number", default: 100 },
  { key: "AI_CACHE_TTL", type: "number", default: 900 },
  { key: "GEMINI_API_KEY", type: "string", canBeEmpty: true },
  { key: "GEMINI_MODEL", type: "string", default: "gemini-2.5-flash" },
  { key: "GEMINI_THINKING_BUDGET", type: "number", default: 0 },
  { key: "AI_FEATURES_ENABLED", type: "string", default: "true" },
  { key: "JWT_SECRET", type: "string", canBeEmpty: true },
  { key: "JWT_EXPIRES_IN", type: "string", default: "24h" },
  { key: "CORS_ORIGIN", type: "string", default: "*" }
];

export interface AppConfig {
  VAULT_PATH: string;
  OBSIDIAN_CITY_PORT: number;
  CACHE_TTL: number;
  RATE_LIMIT_WINDOW: number;
  RATE_LIMIT_MAX: number;
  AI_CACHE_TTL: number;
  CACHE_ENABLED: boolean;
  LOG_LEVEL: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL: string;
  GEMINI_THINKING_BUDGET: number;
  AI_FEATURES_ENABLED: boolean;
  JWT_SECRET?: string;
  JWT_EXPIRES_IN: string;
  CORS_ORIGIN: string;
}

interface ValidationResult {
  config: Partial<AppConfig>;
  errors: string[];
}

let cachedConfig: AppConfig | null = null;

function validateConfig(): ValidationResult {
  const errors: string[] = [];
  const config: Partial<AppConfig> = {};

  // Check required vars
  for (const { key, type, canBeEmpty } of REQUIRED_ENV_VARS) {
    const value = process.env[key];
    
    if (!value) {
      errors.push(`Required env var ${key} is not set`);
      continue;
    }
    
    if (!canBeEmpty && (!value || value.trim() === "")) {
      errors.push(`Required env var ${key} cannot be empty`);
      continue;
    }

    // Validate path exists for VAULT_PATH
    if (key === "VAULT_PATH" && !fs.existsSync(value)) {
      errors.push(`VAULT_PATH does not exist: ${value}`);
      continue;
    }

    (config as Record<string, unknown>)[key] = value;
  }

  // Set defaults and validate optional vars
  for (const { key, type, default: defaultValue } of OPTIONAL_ENV_VARS) {
    const value = process.env[key];
    
    if (value) {
      if (type === "number") {
        const num = parseInt(value, 10);
        if (isNaN(num)) {
          errors.push(`Optional env var ${key} must be a number, got: ${value}`);
          continue;
        }
        (config as Record<string, unknown>)[key] = num;
      } else {
        (config as Record<string, unknown>)[key] = value;
      }
    } else {
      (config as Record<string, unknown>)[key] = defaultValue;
    }
  }

  // Set derived config
  config.VAULT_PATH = config.VAULT_PATH || path.join(process.env.HOME || "", "obsidian-vault");
  config.CACHE_ENABLED = true;
  config.LOG_LEVEL = process.env.LOG_LEVEL || "info";
  config.AI_FEATURES_ENABLED =
    (process.env.AI_FEATURES_ENABLED || "true").toLowerCase() !== "false";
  config.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  config.GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  config.GEMINI_THINKING_BUDGET = parseInt(
    process.env.GEMINI_THINKING_BUDGET || "0",
    10,
  );
  config.JWT_SECRET = process.env.JWT_SECRET;
  config.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "24h";
  config.CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

  return { config, errors };
}

export function initConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const { config, errors } = validateConfig();

  if (errors.length > 0) {
    console.error("\n❌ Configuration Validation Failed:\n");
    errors.forEach(err => console.error(`  - ${err}`));
    console.error("\n💡 Fix your .env file and restart the server.\n");
    process.exit(1);
  }

  console.log("\n✅ Config validation passed");
  console.log(`   Vault: ${config.VAULT_PATH}`);
  console.log(`   Port: ${config.OBSIDIAN_CITY_PORT}`);
  console.log(`   Cache TTL: ${config.CACHE_TTL}s`);
  console.log(`   Log Level: ${config.LOG_LEVEL}\n`);
  console.log(
    `   AI: ${config.AI_FEATURES_ENABLED && config.GEMINI_API_KEY ? config.GEMINI_MODEL : "disabled"}\n`,
  );

  cachedConfig = config as AppConfig;
  return cachedConfig;
}

export function getConfig(): AppConfig {
  return cachedConfig || initConfig();
}

export { validateConfig };
