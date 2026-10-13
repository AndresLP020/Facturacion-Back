import CryptoJS = require("crypto-js");

const MAX_CIPHER_CHARS = 32_000;

export type GhlUserContext = {
  userId: string;
  activeLocation?: string;
  email?: string;
  userName?: string;
  type?: string;
};

export class GhlIntegration {
  static enabled(): boolean {
    return (
      process.env.GHL_INTEGRATION_ENABLED === "true" &&
      Boolean(
        process.env.GHL_CLIENT_ID &&
        process.env.GHL_CLIENT_SECRET &&
        process.env.GHL_SHARED_SECRET,
      )
    );
  }

  static sharedSecretConfigured(): boolean {
    return Boolean(process.env.GHL_SHARED_SECRET?.trim());
  }

  static assertEnabled(): void {
    if (!this.enabled())
      throw new Error(
        "HighLevel integration is disabled or not fully configured",
      );
  }

  static decryptUserData(encryptedUserData: string): GhlUserContext {
    const secret = process.env.GHL_SHARED_SECRET?.trim();
    if (!secret) throw new Error("missing-secret");
    const cipher = encryptedUserData.trim();
    if (!cipher || cipher.length > MAX_CIPHER_CHARS)
      throw new Error("invalid-cipher");
    let parsed: unknown;
    try {
      const decrypted = CryptoJS.AES.decrypt(cipher, secret).toString(
        CryptoJS.enc.Utf8,
      );
      if (!decrypted) throw new Error("empty");
      parsed = JSON.parse(decrypted);
    } catch {
      throw new Error("decrypt-failed");
    }
    if (!parsed || typeof parsed !== "object") throw new Error("invalid-shape");
    const row = parsed as Record<string, unknown>;
    const userId = typeof row.userId === "string" ? row.userId.trim() : "";
    if (!userId) throw new Error("invalid-shape");
    const activeLocation =
      typeof row.activeLocation === "string"
        ? row.activeLocation.trim()
        : undefined;
    const email = typeof row.email === "string" ? row.email.trim() : undefined;
    const userName =
      typeof row.userName === "string" ? row.userName.trim() : undefined;
    const type = typeof row.type === "string" ? row.type.trim() : undefined;
    return { userId, activeLocation, email, userName, type };
  }
}
