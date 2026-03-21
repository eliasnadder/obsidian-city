/**
 * Config Validator - Validates environment variables on startup
 */

const fs = require("fs");
const path = require("path");

const REQUIRED_ENV_VARS = [
  { key: "VAULT_PATH", type: "string", canBeEmpty: false }
];

const OPTIONAL_ENV_VARS = [
  { key: "OBSIDIAN_CITY_PORT", type: "number", default: 3333 },
  { key: "CACHE_TTL", type: "number", default: 300 }, // 5 minutes
  { key: "RATE_LIMIT_WINDOW", type: "number", default: 15 * 60 * 1000 }, // 15 minutes
  { key: "RATE_LIMIT_MAX", type: "number", default: 100 }
];

function validateConfig() {
  const errors = [];
  const config = {};

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

    config[key] = value;
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
        config[key] = num;
      } else {
        config[key] = value;
      }
    } else {
      config[key] = defaultValue;
    }
  }

  // Set derived config
  config.VAULT_PATH = config.VAULT_PATH || path.join(process.env.HOME, "obsidian-vault");
  config.CACHE_ENABLED = true;
  config.LOG_LEVEL = process.env.LOG_LEVEL || "info";

  return { config, errors };
}

function initConfig() {
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

  return config;
}

module.exports = { validateConfig, initConfig };
