import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Request, Response } from "express";
import * as argon2 from "argon2";
import { PrismaService } from "./prisma.service";
import { LoginDto } from "./dto";
import { isAllowedFrontendOrigin, sessionCookieOptions } from "./origins";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const cookieName = () => process.env.SESSION_COOKIE_NAME || "aida_session";

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}
  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    const valid =
      user?.active &&
      (await argon2.verify(user.passwordHash, password).catch(() => false));
    if (!valid || !user)
      throw new UnauthorizedException("Credenciales inválidas");
    const token = randomBytes(32).toString("base64url");
    const csrf = randomBytes(32).toString("base64url");
    const hours = Number(process.env.SESSION_TTL_HOURS || 8);
    await this.prisma.session.create({
      data: {
        tokenHash: hash(token),
        csrfHash: hash(csrf),
        userId: user.id,
        expiresAt: new Date(Date.now() + hours * 3600_000),
      },
    });
    return {
      token,
      csrf,
      user: { id: user.id, email: user.email, displayName: user.displayName },
    };
  }
  async authenticate(req: Request) {
    const token = req.cookies?.[cookieName()];
    if (!token || typeof token !== "string")
      throw new UnauthorizedException("Autenticación requerida");
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hash(token) },
      include: {
        user: { include: { memberships: { include: { company: true } } } },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.user.active ||
      session.user.memberships.length === 0
    )
      throw new UnauthorizedException("Sesión inválida o expirada");
    (req as any).identity = {
      userId: session.userId,
      companyId: session.user.memberships[0].companyId,
      company: session.user.memberships[0].company,
      role: session.user.memberships[0].role,
      displayName: session.user.displayName,
      email: session.user.email,
      sessionId: session.id,
    };
    return session;
  }
  async assertCanWrite(req: any) {
    if (!["OWNER", "ADMIN"].includes(req.identity?.role))
      throw new ForbiddenException("Permiso insuficiente");
  }
  async logout(req: Request) {
    const token = req.cookies?.[cookieName()];
    if (token)
      await this.prisma.session.updateMany({
        where: { tokenHash: hash(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
  }
  async checkCsrf(req: Request) {
    const token = req.cookies?.aida_csrf;
    const header = req.header("x-csrf-token");
    if (!token || !header || token !== header)
      throw new UnauthorizedException("Validación CSRF requerida");
    const session = await this.authenticate(req);
    const actual = Buffer.from(hash(token));
    const expected = Buffer.from(session.csrfHash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new UnauthorizedException("Token CSRF inválido");
  }
}

@Injectable()
export class SessionGuard {
  constructor(private auth: AuthService) {}
  async canActivate(context: any) {
    await this.auth.authenticate(context.switchToHttp().getRequest());
    return true;
  }
}

@Controller("api/v1/auth")
export class AuthController {
  constructor(
    private auth: AuthService,
    private prisma: PrismaService,
  ) {}
  @Post("login") async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!isAllowedFrontendOrigin(req.header("origin")))
      throw new UnauthorizedException("Origen inválido");
    let result: Awaited<ReturnType<AuthService["login"]>>;
    try {
      result = await this.auth.login(body.email, body.password);
    } catch (error) {
      await this.prisma.auditLog
        .create({
          data: {
            action: "auth.login.failure",
            outcome: "failure",
            correlationId: req.header("x-correlation-id") || "unavailable",
          },
        })
        .catch(() => undefined);
      throw error;
    }
    const common = sessionCookieOptions();
    res.cookie(cookieName(), result.token, common);
    res.cookie("aida_csrf", result.csrf, { ...common, httpOnly: false });
    await this.prisma.auditLog.create({
      data: {
        userId: result.user.id,
        action: "auth.login.success",
        outcome: "success",
        correlationId: req.header("x-correlation-id") || "unavailable",
      },
    });
    const { token: _token, csrf: _csrf, ...safe } = result;
    return safe;
  }
  @Get("me") @UseGuards(SessionGuard) me(@Req() req: any) {
    const { userId, companyId, company, displayName, email } = req.identity;
    return {
      user: { id: userId, email, displayName },
      company: { id: companyId, name: company.name },
    };
  }
  @Post("logout") async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.checkCsrf(req);
    await this.auth.logout(req);
    const identity = (req as any).identity;
    await this.prisma.auditLog.create({
      data: {
        companyId: identity.companyId,
        userId: identity.userId,
        action: "auth.logout",
        outcome: "success",
        correlationId: req.header("x-correlation-id") || "unavailable",
      },
    });
    const clear = sessionCookieOptions();
    res.clearCookie(cookieName(), clear);
    res.clearCookie("aida_csrf", { ...clear, httpOnly: false });
    return { ok: true };
  }
}
