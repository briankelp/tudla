import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Envelope = {
  version: number;
  iv: string;
  tag: string;
  ciphertext: string;
};
export function seal(
  key: string,
  secret: string,
  context: string,
  version = 1,
): Envelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return {
    version,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}
export function unseal(
  key: string | Record<string, string>,
  envelope: Envelope,
  context: string,
): string {
  const selected =
    typeof key === "string"
      ? envelope.version === 1
        ? key
        : undefined
      : key[String(envelope.version)];
  if (!selected)
    throw new AppError(503, "This connection needs to be replaced.");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(selected, "base64"),
    Buffer.from(envelope.iv, "base64"),
  );
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return Buffer.concat([
    cipher.update(Buffer.from(envelope.ciphertext, "base64")),
    cipher.final(),
  ]).toString("utf8");
}
export const tokenHash = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const maskKey = (s: string) => `••••${s.slice(-4)}`;
