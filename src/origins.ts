export function allowedFrontendOrigins(): string[] {
  return (process.env.FRONTEND_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function isAllowedFrontendOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  return allowedFrontendOrigins().includes(origin.replace(/\/+$/, ""));
}

export function sessionCookieOptions() {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: (secure ? "none" : "lax") as "none" | "lax",
    maxAge: Number(process.env.SESSION_TTL_HOURS || 8) * 3600_000,
    path: "/",
  };
}
