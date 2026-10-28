export type Config = {
  port: number;
  origin: string;
  databaseUrl: string;
  queueUrl: string;
  supabaseUrl: string;
  publishableKey: string;
  encryptionKey: string;
  encryptionKeys: Record<string, string>;
  encryptionVersion: number;
  groqModel: string;
  compatibleUrl: string;
  dailyLimit: number;
  maxActiveJobs: number;
  poolSize: number;
  embeddedWorker: boolean;
  demoOnly: boolean;
  production: boolean;
};
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const demoOnly = env.DEMO_ONLY !== "false";
  // A retired/sample deployment must not use leftover hosted credentials.
  const liveEnv = demoOnly ? {} : env;
  const positive = (key: string, fallback: number) => {
    const n = Number(env[key] || fallback);
    if (!Number.isInteger(n) || n < 1) throw Error(`Invalid ${key}`);
    return n;
  };
  let keyring: Record<string, string> = {};
  try {
    keyring = liveEnv.ENCRYPTION_KEYS
      ? JSON.parse(liveEnv.ENCRYPTION_KEYS)
      : liveEnv.ENCRYPTION_KEY
        ? { "1": liveEnv.ENCRYPTION_KEY }
        : {};
  } catch {
    throw Error("ENCRYPTION_KEYS must be a valid key-version map.");
  }
  if (
    !keyring ||
    typeof keyring !== "object" ||
    Array.isArray(keyring) ||
    Object.entries(keyring).some(
      ([v, k]) =>
        !/^\d+$/.test(v) ||
        typeof k !== "string" ||
        Buffer.from(k, "base64").length !== 32,
    )
  )
    throw Error("Each encryption key must contain 32 base64-encoded bytes.");
  const encryptionVersion = demoOnly
    ? 1
    : positive("ENCRYPTION_KEY_VERSION", 1);
  if (Object.keys(keyring).length && !keyring[String(encryptionVersion)])
    throw Error("ENCRYPTION_KEY_VERSION is missing from ENCRYPTION_KEYS.");
  const c: Config = {
    port: positive("PORT", 3100),
    origin: (env.APP_ORIGIN?.trim() || "http://localhost:5173").replace(
      /\/$/,
      "",
    ),
    databaseUrl: liveEnv.DATABASE_URL || "",
    queueUrl: liveEnv.QUEUE_DATABASE_URL || "",
    supabaseUrl: (liveEnv.SUPABASE_URL || "").replace(/\/$/, ""),
    publishableKey: liveEnv.SUPABASE_PUBLISHABLE_KEY || "",
    encryptionKey: keyring[String(encryptionVersion)] || "",
    encryptionKeys: keyring,
    encryptionVersion,
    groqModel: env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b",
    compatibleUrl:
      liveEnv.LLM_COMPATIBLE_BASE_URL?.trim().replace(/\/$/, "") || "",
    dailyLimit: positive("WORKSPACE_DAILY_CALL_LIMIT", 100),
    maxActiveJobs: positive("MAX_ACTIVE_JOBS", 3),
    poolSize: positive("DATABASE_POOL_SIZE", 4),
    embeddedWorker: !demoOnly && env.EMBEDDED_WORKER === "true",
    demoOnly,
    production: env.NODE_ENV === "production",
  };
  if (c.poolSize < 2)
    throw Error("DATABASE_POOL_SIZE must be at least 2 for background jobs.");
  if (c.compatibleUrl) {
    const target = new URL(c.compatibleUrl);
    if (
      !["https:", "http:"].includes(target.protocol) ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    )
      throw Error(
        "LLM_COMPATIBLE_BASE_URL must be an HTTP(S) base URL without credentials or query parameters.",
      );
    if (
      target.protocol !== "https:" &&
      env.LLM_ALLOW_LOCAL !== "true" &&
      env.NODE_ENV !== "test"
    )
      throw Error(
        "Use HTTPS for the compatible API, or explicitly allow a trusted local service with LLM_ALLOW_LOCAL=true.",
      );
  }
  if (
    c.supabaseUrl &&
    !c.supabaseUrl.startsWith("https://") &&
    env.NODE_ENV !== "test"
  )
    throw Error("SUPABASE_URL must use HTTPS.");
  if (c.encryptionKey && Buffer.from(c.encryptionKey, "base64").length !== 32)
    throw Error("ENCRYPTION_KEY must contain 32 base64-encoded bytes.");
  if (
    c.production &&
    !c.demoOnly &&
    (!c.databaseUrl ||
      !c.queueUrl ||
      !c.supabaseUrl ||
      !c.publishableKey ||
      !c.encryptionKey)
  )
    throw Error(
      "Live production requires database, queue, encryption, and Supabase configuration. Set DEMO_ONLY=true for a sample-only deployment.",
    );
  return c;
}
export const liveReady = (c: Config) =>
  Boolean(
    !c.demoOnly &&
    c.databaseUrl &&
    c.queueUrl &&
    c.supabaseUrl &&
    c.publishableKey &&
    c.encryptionKey,
  );
