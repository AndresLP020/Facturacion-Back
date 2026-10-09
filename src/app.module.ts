import {
  Module,
  Controller,
  Get,
  Req,
  UseGuards,
  Post,
  Body,
  Patch,
  Param,
  Query,
  NotFoundException,
  ConflictException,
  ParseUUIDPipe,
  ForbiddenException,
  BadRequestException,
  Injectable,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Prisma } from "@prisma/client";
import { AuthController, AuthService, SessionGuard } from "./auth";
import { PrismaService } from "./prisma.service";
import { CustomerDto, DraftDto, UpdateCustomerDto } from "./dto";

@Injectable()
class BusinessService {
  constructor(
    private db: PrismaService,
    private auth: AuthService,
  ) {}
  private presentCustomer<T extends { companyId?: string; externalRef?: string | null }>(row: T) {
    const { companyId: _companyId, externalRef: _externalRef, ...safe } = row;
    return safe;
  }
  private presentInvoice<T extends { companyId?: string; idempotencyKey?: string; customer?: any }>(row: T) {
    const { companyId: _companyId, idempotencyKey: _key, customer, ...safe } = row;
    return { ...safe, ...(customer ? { customer: this.presentCustomer(customer) } : {}) };
  }
  async company(req: any) {
    return {
      id: req.identity.company.id,
      name: req.identity.company.name,
      environment: "SANDBOX",
    };
  }
  async customers(req: any, q = "") {
    const companyId = req.identity.companyId;
    const rows = await this.db.customer.findMany({
      where: {
        companyId,
        ...(q
          ? {
              OR: [
                { legalName: { contains: q, mode: "insensitive" as const } },
                { rfc: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { legalName: "asc" },
      take: 100,
    });
    return rows.map((row) => this.presentCustomer(row));
  }
  async customer(req: any, id: string) {
    const row = await this.db.customer.findFirst({
      where: { id, companyId: req.identity.companyId },
    });
    if (!row) throw new NotFoundException("Cliente no encontrado");
    return this.presentCustomer(row);
  }
  async createCustomer(req: any, data: any) {
    if (
      !data?.legalName ||
      !data?.rfc ||
      !["MORAL", "PHYSICAL"].includes(data?.personType) ||
      !data?.taxRegime ||
      !data?.cfdiUse ||
      !data?.postalCode ||
      !data?.state ||
      !data?.municipality
    )
      throw new BadRequestException("Datos de cliente incompletos");
    if (
      !/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/i.test(data.rfc) ||
      !/^\d{5}$/.test(data.postalCode)
    )
      throw new BadRequestException(
        "Formato de RFC o código postal inválido para el simulador",
      );
    try {
      const customer = await this.db.customer.create({
        data: {
          ...data,
          rfc: data.rfc.toUpperCase(),
          companyId: req.identity.companyId,
        },
      });
      await this.db.auditLog.create({
        data: {
          companyId: req.identity.companyId,
          userId: req.identity.userId,
          action: "customer.create",
          resourceType: "Customer",
          resourceId: customer.id,
          outcome: "success",
          correlationId: req.correlationId || "unavailable",
        },
      });
      return this.presentCustomer(customer);
    } catch (e: any) {
      if (e.code === "P2002")
        throw new BadRequestException("RFC de cliente ya registrado");
      throw e;
    }
  }
  async updateCustomer(req: any, id: string, data: any) {
    const existing = await this.db.customer.findFirst({
      where: { id, companyId: req.identity.companyId },
    });
    if (!existing) throw new NotFoundException("Cliente no encontrado");
    const merged = { ...existing, ...data };
    if (
      typeof merged.legalName !== "string" ||
      !merged.legalName.trim() ||
      !/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/i.test(String(merged.rfc)) ||
      !["MORAL", "PHYSICAL"].includes(merged.personType) ||
      !/^\d{5}$/.test(String(merged.postalCode)) ||
      !merged.taxRegime || !merged.cfdiUse || !merged.state || !merged.municipality
    ) throw new BadRequestException("Datos de cliente inválidos");
    try {
      const customer = await this.db.customer.update({
        where: { id },
        data: {
          legalName: merged.legalName.trim().slice(0, 200),
          rfc: String(merged.rfc).toUpperCase(),
          personType: merged.personType,
          taxRegime: String(merged.taxRegime).slice(0, 20),
          cfdiUse: String(merged.cfdiUse).slice(0, 20),
          postalCode: String(merged.postalCode),
          country: String(merged.country || "México").slice(0, 60),
          state: String(merged.state).slice(0, 100),
          municipality: String(merged.municipality).slice(0, 100),
          locality: merged.locality ? String(merged.locality).slice(0, 100) : null,
          street: merged.street ? String(merged.street).slice(0, 200) : null,
        },
      });
      await this.db.auditLog.create({
        data: {
          companyId: req.identity.companyId,
          userId: req.identity.userId,
          action: "customer.update",
          resourceType: "Customer",
          resourceId: customer.id,
          outcome: "success",
          correlationId: req.correlationId || "unavailable",
        },
      });
      return this.presentCustomer(customer);
    } catch (error: any) {
      if (error.code === "P2002") throw new BadRequestException("RFC de cliente ya registrado");
      throw error;
    }
  }
  async createDraft(req: any, data: any, key: string, targetId?: string) {
    if (!targetId && (!key || key.length > 128))
      throw new BadRequestException("Idempotency-Key requerido");
    const companyId = req.identity.companyId;
    const prior = targetId
      ? await this.db.invoice.findFirst({
          where: { id: targetId, companyId, status: "DRAFT" },
          include: { items: true },
        })
      : await this.db.invoice.findFirst({
          where: { companyId, idempotencyKey: key },
          include: { items: true },
        });
    if (targetId && !prior)
      throw new NotFoundException("Borrador no encontrado");
    if (!targetId && prior) return this.presentInvoice(prior);
    if (
      !data?.customerId ||
      !Array.isArray(data.items) ||
      data.items.length === 0 ||
      data.items.length > 100
    )
      throw new BadRequestException(
        "Cliente y al menos una partida son requeridos",
      );
    const customer = await this.db.customer.findFirst({
      where: { id: data.customerId, companyId },
    });
    if (!customer) throw new NotFoundException("Cliente no encontrado");
    const D = Prisma.Decimal;
    const normalized = data.items.map((i: any) => {
      let q: Prisma.Decimal,
        p: Prisma.Decimal,
        discount: Prisma.Decimal,
        rate: Prisma.Decimal,
        withholding: Prisma.Decimal;
      try {
        for (const value of [i.quantity, i.unitPrice, i.discount ?? 0, i.taxRate ?? 0, i.withholdingRate ?? 0]) {
          if (!(typeof value === "string" || typeof value === "number") || String(value).length > 32 || !/^(\d{1,14})(\.\d{1,6})?$/.test(String(value))) throw new Error("invalid decimal");
        }
        q = new D(i.quantity);
        p = new D(i.unitPrice);
        discount = new D(i.discount || 0);
        rate = new D(i.taxRate || 0);
        withholding = new D(i.withholdingRate || 0);
      } catch {
        throw new BadRequestException("Partida inválida");
      }
      if (
        ![q, p, discount, rate, withholding].every((v) => v.isFinite()) ||
        !q.greaterThan(0) ||
        p.isNegative() ||
        discount.isNegative() ||
        rate.isNegative() ||
        rate.greaterThan(1) ||
        withholding.isNegative() ||
        withholding.greaterThan(1) ||
        !i.description ||
        !i.satKey ||
        !i.unit ||
        discount.greaterThan(q.mul(p).toDecimalPlaces(2, D.ROUND_HALF_UP))
      )
        throw new BadRequestException("Partida inválida");
      const amount = q.mul(p).toDecimalPlaces(2, D.ROUND_HALF_UP);
      const taxable = amount.minus(discount);
      const tax = taxable.mul(rate).toDecimalPlaces(2, D.ROUND_HALF_UP);
      const held = taxable.mul(withholding).toDecimalPlaces(2, D.ROUND_HALF_UP);
      return {
        sku: i.sku,
        satKey: String(i.satKey).slice(0, 32),
        description: String(i.description).slice(0, 500),
        unit: String(i.unit).slice(0, 30),
        quantity: q,
        unitPrice: p,
        amount,
        discount,
        taxRate: rate,
        withholdingRate: withholding,
        tax,
        withholding: held,
      };
    });
    const subtotal = normalized
        .reduce((a: Prisma.Decimal, i: any) => a.plus(i.amount), new D(0))
        .toDecimalPlaces(2),
      discount = normalized
        .reduce((a: Prisma.Decimal, i: any) => a.plus(i.discount), new D(0))
        .toDecimalPlaces(2),
      taxes = normalized
        .reduce(
          (a: Prisma.Decimal, i: any) => a.plus(i.tax).minus(i.withholding),
          new D(0),
        )
        .toDecimalPlaces(2),
      total = subtotal.minus(discount).plus(taxes).toDecimalPlaces(2);
    let invoice: any;
    try {
      invoice = await this.db.$transaction(async (tx) => {
      const itemRecords = normalized.map(
        ({ tax, withholding, ...item }: any) => item,
      );
      const relationRecords = (
        Array.isArray(data.relations) ? data.relations : []
      )
        .slice(0, 20)
        .map((r: any) => ({
          relationType: String(r.relationType).slice(0, 10),
          reference: String(r.reference).slice(0, 100),
        }));
      const issuedAt = data.issuedAt ? new Date(data.issuedAt) : new Date();
      if (!Number.isFinite(issuedAt.getTime())) throw new BadRequestException("Fecha de emisión inválida");
      const fields: any = {
        customerId: customer.id,
        issuedAt,
        paymentForm: String(data.paymentForm || "99").slice(0, 10),
        paymentMethod: String(data.paymentMethod || "PUE").slice(0, 10),
        documentType: String(data.documentType || "I").slice(0, 10),
        placeOfIssue: String(data.placeOfIssue || customer.postalCode).slice(
          0,
          10,
        ),
        currency: String(data.currency || "MXN").slice(0, 3),
        series: data.series,
        folio: data.folio,
        notes: data.notes ? String(data.notes).slice(0, 2000) : null,
        subtotal,
        discount,
        taxes,
        total,
      };
      const dataForWrite = prior
        ? {
            ...fields,
            items: { deleteMany: {}, create: itemRecords },
            relations: { deleteMany: {}, create: relationRecords },
          }
        : {
            ...fields,
            companyId,
            idempotencyKey: key,
            items: { create: itemRecords },
            relations: { create: relationRecords },
          };
      const invoice = prior
        ? await tx.invoice.update({
            where: { id: prior.id },
            data: dataForWrite,
            include: { items: true, relations: true, customer: true },
          })
        : await tx.invoice.create({
            data: dataForWrite,
            include: { items: true, relations: true, customer: true },
          });
      await tx.auditLog.create({
        data: {
          companyId,
          userId: req.identity.userId,
          action: prior ? "invoice.draft.update" : "invoice.draft.create",
          resourceType: "Invoice",
          resourceId: invoice.id,
          outcome: "success",
          correlationId: req.correlationId || "unavailable",
        },
      });
      return invoice;
      });
    } catch (error) {
      if (!targetId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const duplicate = await this.db.invoice.findFirst({
          where: { companyId, idempotencyKey: key },
          include: { items: true, relations: true, customer: true },
        });
        if (duplicate) return this.presentInvoice(duplicate);
      }
      throw error;
    }
    return this.presentInvoice(invoice);
  }
  async invoices(req: any) {
    const rows = await this.db.invoice.findMany({
      where: { companyId: req.identity.companyId },
      include: { customer: { select: { legalName: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map((row) => this.presentInvoice(row));
  }
  async invoice(req: any, id: string) {
    const row = await this.db.invoice.findFirst({
      where: { id, companyId: req.identity.companyId },
      include: { items: true, relations: true, customer: true },
    });
    if (!row) throw new NotFoundException("Borrador no encontrado");
    return this.presentInvoice(row);
  }
  async simulateStamp(req: any, id: string) {
    const companyId = req.identity.companyId;
    const stampId = randomUUID();
    const stampedAt = new Date();
    const result = await this.db.$transaction(async (tx) => {
      const existing = await tx.invoice.findFirst({
        where: { id, companyId },
      });
      if (!existing) throw new NotFoundException("Borrador no encontrado");
      if (existing.status === "STAMPED_SIMULATED") return existing;
      if (existing.status !== "DRAFT")
        throw new ConflictException("El documento ya no se puede simular");

      const changed = await tx.invoice.updateMany({
        where: { id, companyId, status: "DRAFT" },
        data: {
          status: "STAMPED_SIMULATED",
          simulatedStampId: stampId,
          simulatedStampedAt: stampedAt,
        },
      });
      if (changed.count !== 1) {
        const current = await tx.invoice.findFirst({ where: { id, companyId } });
        if (current?.status === "STAMPED_SIMULATED") return current;
        throw new ConflictException("No se pudo cambiar el estado del documento");
      }
      await tx.auditLog.create({
        data: {
          companyId,
          userId: req.identity.userId,
          action: "invoice.stamp.simulate",
          resourceType: "Invoice",
          resourceId: id,
          outcome: "simulated",
          correlationId: req.correlationId || "unavailable",
        },
      });
      return tx.invoice.findFirstOrThrow({ where: { id, companyId } });
    });
    return {
      ...this.presentInvoice(result),
      stampSimulation: {
        provider: "local-mock",
        result: "success",
        fiscalValidity: "none",
        message: "Timbrado simulado. No se generó CFDI, XML, UUID fiscal ni conexión con SAT/PAC/INVOGO.",
      },
    };
  }
}

@Controller("api/v1")
class ApiController {
  constructor(
    private service: BusinessService,
    private auth: AuthService,
    private db: PrismaService,
  ) {}
  @Get("health") async health() {
    try {
      await this.db.$queryRaw`SELECT 1`;
      return {
        status: "ok",
        backend: "ok",
        database: "ok",
        environment: "SANDBOX",
      };
    } catch {
      return {
        status: "degraded",
        backend: "ok",
        database: "unavailable",
        environment: "SANDBOX",
      };
    }
  }
  @Get("companies/current") @UseGuards(SessionGuard) company(@Req() req: any) {
    return this.service.company(req);
  }
  @Get("customers") @UseGuards(SessionGuard) customers(
    @Req() req: any,
    @Query("q") q?: string,
  ) {
    return this.service.customers(req, (q || "").slice(0, 100));
  }
  @Get("customers/:id") @UseGuards(SessionGuard) customer(
    @Req() req: any,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.customer(req, id);
  }
  @Post("customers") @UseGuards(SessionGuard) async createCustomer(
    @Req() req: any,
    @Body() body: CustomerDto,
  ) {
    await this.auth.checkCsrf(req);
    await this.auth.assertCanWrite(req);
    return this.service.createCustomer(req, body);
  }
  @Patch("customers/:id") @UseGuards(SessionGuard) async updateCustomer(
    @Req() req: any,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateCustomerDto,
  ) {
    await this.auth.checkCsrf(req);
    await this.auth.assertCanWrite(req);
    return this.service.updateCustomer(req, id, body);
  }
  @Get("invoices") @UseGuards(SessionGuard) invoices(@Req() req: any) {
    return this.service.invoices(req);
  }
  @Post("invoices/drafts") @UseGuards(SessionGuard) async createDraft(
    @Req() req: any,
    @Body() body: DraftDto,
  ) {
    await this.auth.checkCsrf(req);
    await this.auth.assertCanWrite(req);
    return this.service.createDraft(
      req,
      body,
      req.header("idempotency-key") || "",
    );
  }
  @Get("invoices/drafts/:id") @UseGuards(SessionGuard) draft(
    @Req() req: any,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.invoice(req, id);
  }
  @Patch("invoices/drafts/:id") @UseGuards(SessionGuard) async updateDraft(
    @Req() req: any,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: DraftDto,
  ) {
    await this.auth.checkCsrf(req);
    await this.auth.assertCanWrite(req);
    const old = await this.service.invoice(req, id);
    if (old.status !== "DRAFT") throw new ForbiddenException();
    return this.service.createDraft(req, body, "", id);
  }
  @Post("invoices/drafts/:id/simulate-stamp") @UseGuards(SessionGuard) async simulateStamp(
    @Req() req: any,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.auth.checkCsrf(req);
    await this.auth.assertCanWrite(req);
    return this.service.simulateStamp(req, id);
  }
  @Post("integrations/ghl/simulate-connectivity") @UseGuards(SessionGuard) async simulateGhlConnectivity(
    @Req() req: any,
  ) {
    await this.auth.checkCsrf(req);
    await this.auth.assertCanWrite(req);
    if (
      process.env.NODE_ENV === "production" ||
      process.env.ENABLE_GHL_CONNECTIVITY_SIMULATOR === "false"
    ) {
      throw new NotFoundException("Prueba simulada no disponible");
    }
    const startedAt = Date.now();
    const correlationId = req.correlationId || randomUUID();
    const durationMs = Date.now() - startedAt;
    const record = await this.db.integrationRequest.create({
      data: {
        companyId: req.identity.companyId,
        provider: "ghl-local-mock",
        operation: "simulate-custom-page-connectivity",
        statusCode: 200,
        durationMs,
        correlationId,
        outcome: "simulated",
      },
      select: { id: true, provider: true, operation: true, createdAt: true },
    });
    return {
      result: "simulated",
      externalRequestSent: false,
      identityValidated: true,
      companyScopeApplied: true,
      correlationId,
      durationMs,
      record,
      message:
        "Se comprobó la ruta navegador → API autenticada → PostgreSQL. No se contactó GoHighLevel y este resultado no autentica un contexto GHL.",
    };
  }
  @Get("integrations/status") @UseGuards(SessionGuard) async integrations(
    @Req() req: any,
  ) {
    const last = await this.db.integrationRequest.findFirst({
      where: { companyId: req.identity.companyId },
      orderBy: { createdAt: "desc" },
    });
    return {
      environment: "SANDBOX",
      invogo: {
        provider: process.env.INVOGO_PROVIDER || "mock",
        connected: true,
        contract: "local-simulator",
      },
      ghl: {
        implemented: false,
        enabled: false,
        localConnectivitySimulatorEnabled:
          process.env.NODE_ENV !== "production" &&
          process.env.ENABLE_GHL_CONNECTIVITY_SIMULATOR !== "false",
        configurationPresent: Boolean(
          process.env.GHL_CLIENT_ID &&
          process.env.GHL_CLIENT_SECRET &&
          process.env.GHL_SHARED_SECRET,
        ),
      },
      lastOperation: last,
    };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  controllers: [AuthController, ApiController],
  providers: [
    PrismaService,
    AuthService,
    SessionGuard,
    BusinessService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
