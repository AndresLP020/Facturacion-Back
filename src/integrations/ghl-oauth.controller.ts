import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Request, Response } from "express";
import { PrismaService } from "../prisma.service";

const STATE_COOKIE = "ghl_oauth_state";
const AUTHORIZE_URL = "https://marketplace.gohighlevel.com/oauth/chooselocation";
const TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

function oauthRedirectUri(): string {
  return (
    process.env.GHL_OAUTH_REDIRECT_URI ||
    "https://facturacion-back-2n9i.onrender.com/api/v1/integrations/oauth/callback"
  ).replace(/\/+$/, "");
}

function oauthScopes(): string {
  return (process.env.GHL_OAUTH_SCOPES || "users.readonly").trim();
}

function hashState(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function htmlPage(title: string, body: string): string {
  const safeTitle = escapeHtml(title);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>body{font-family:Arial,sans-serif;background:#111827;color:#e5e7eb;display:grid;place-items:center;min-height:100vh;margin:0}
.card{background:#1f2937;border:1px solid #374151;border-radius:12px;padding:28px;max-width:440px;line-height:1.5}</style>
</head><body><div class="card">${body}</div></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

@Controller("api/v1/integrations/oauth")
export class GhlOAuthController {
  constructor(private prisma: PrismaService) {}

  @Get("start")
  start(@Res() res: Response) {
    const clientId = process.env.GHL_CLIENT_ID?.trim();
    if (!clientId) {
      res
        .status(503)
        .type("html")
        .send(
          htmlPage(
            "OAuth GHL",
            "<p>Falta GHL_CLIENT_ID en el servidor. Este no es el endpoint de contexto cifrado.</p>",
          ),
        );
      return;
    }
    const state = randomBytes(24).toString("base64url");
    const secure = process.env.NODE_ENV === "production";
    res.cookie(STATE_COOKIE, hashState(state), {
      httpOnly: true,
      secure,
      sameSite: "lax",
      maxAge: 10 * 60_000,
      path: "/api/v1/integrations/oauth",
    });
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", oauthRedirectUri());
    url.searchParams.set("scope", oauthScopes());
    url.searchParams.set("state", state);
    res.redirect(url.toString());
  }

  @Get("callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Query("locationId") locationIdQuery: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const correlationId =
      (req as { correlationId?: string }).correlationId || "oauth";
    if (error) {
      await this.audit("ghl.oauth.denied", "failure", correlationId);
      res
        .status(401)
        .type("html")
        .send(
          htmlPage(
            "OAuth GHL",
            "<p>La autorización fue cancelada o rechazada. Puedes cerrar esta ventana.</p>",
          ),
        );
      return;
    }
    const stored = req.cookies?.[STATE_COOKIE];
    if (stored) {
      if (!state || typeof state !== "string") {
        throw new UnauthorizedException("State OAuth requerido");
      }
      const actual = Buffer.from(hashState(state));
      const expected = Buffer.from(String(stored));
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      ) {
        throw new UnauthorizedException("State OAuth inválido");
      }
    }
    res.clearCookie(STATE_COOKIE, { path: "/api/v1/integrations/oauth" });
    if (!code || typeof code !== "string" || code.length > 2048) {
      await this.audit("ghl.oauth.missing_code", "failure", correlationId);
      res
        .status(400)
        .type("html")
        .send(
          htmlPage(
            "OAuth GHL",
            "<p>No llegó un código de autorización. Revisa la Redirect URL en Marketplace.</p>",
          ),
        );
      return;
    }
    const clientId = process.env.GHL_CLIENT_ID?.trim();
    const clientSecret = process.env.GHL_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      await this.audit("ghl.oauth.callback_no_secret", "success", correlationId);
      res.type("html").send(
        htmlPage(
          "OAuth GHL",
          `<p>Marketplace redirigió correctamente al callback. Falta intercambiar el code: configura GHL_CLIENT_ID y GHL_CLIENT_SECRET en Render y vuelve a instalar.</p>
           <p>Esto no es el contexto cifrado del iframe (${escapeHtml("/api/v1/integrations/ghl/context")}).</p>`,
        ),
      );
      return;
    }
    try {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        user_type: "Location",
        redirect_uri: oauthRedirectUri(),
      });
      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!tokenRes.ok) {
        await this.audit("ghl.oauth.token_failure", "failure", correlationId);
        res
          .status(401)
          .type("html")
          .send(
            htmlPage(
              "OAuth GHL",
              "<p>No se pudo completar el intercambio OAuth. Revisa Client ID, Client Secret y que la Redirect URL coincida carácter por carácter.</p>",
            ),
          );
        return;
      }
      const payload = (await tokenRes.json()) as {
        locationId?: string;
        companyId?: string;
        userType?: string;
      };
      const locationId = payload.locationId || locationIdQuery || "";
      await this.prisma.integrationRequest.create({
        data: {
          provider: "ghl-oauth",
          operation: "authorization-code",
          statusCode: 200,
          durationMs: 0,
          correlationId,
          outcome: "success",
        },
      });
      await this.audit("ghl.oauth.success", "success", correlationId);
      const loc = locationId
        ? `<p>Subcuenta reconocida (no se guardó el token).</p>`
        : "";
      res.type("html").send(
        htmlPage(
          "OAuth GHL",
          `<p>Instalación OAuth recibida. Los tokens no se almacenan ni se muestran. La Custom Page sigue usando el contexto cifrado, no este callback.</p>${loc}
           <p>Ya puedes cerrar esta pestaña y abrir la Custom Page en HighLevel.</p>`,
        ),
      );
    } catch {
      await this.audit("ghl.oauth.exception", "failure", correlationId);
      res
        .status(502)
        .type("html")
        .send(
          htmlPage(
            "OAuth GHL",
            "<p>Error al contactar el token endpoint de HighLevel.</p>",
          ),
        );
    }
  }

  private async audit(action: string, outcome: string, correlationId: string) {
    await this.prisma.auditLog
      .create({ data: { action, outcome, correlationId } })
      .catch(() => undefined);
  }
}
