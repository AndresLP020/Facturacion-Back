import "dotenv/config";
import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import cookieParser = require("cookie-parser");
import { randomUUID } from "node:crypto";
import { AppModule } from "./app.module";
import { allowedFrontendOrigins } from "./origins";

async function bootstrap() {
  const provider = process.env.INVOGO_PROVIDER || "mock";
  if (provider !== "mock") {
    throw new Error(
      "INVOGO_PROVIDER must remain 'mock' until the official INVOGO contract and provider implementation are supplied.",
    );
  }
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const ancestors = (
    process.env.ALLOWED_FRAME_ANCESTORS ||
    "https://app.gohighlevel.com,https://app.leadconnectorhq.com"
  )
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", ...allowedFrontendOrigins()],
          frameAncestors: ["'self'", ...ancestors],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cookieParser());
  app.use((req: any, res: any, next: () => void) => {
    req.correlationId = req.header("x-correlation-id") || randomUUID();
    res.setHeader("x-correlation-id", req.correlationId);
    next();
  });
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set("trust proxy", 1);
  app.enableCors({
    origin: allowedFrontendOrigins(),
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "X-CSRF-Token",
      "Idempotency-Key",
      "X-Correlation-Id",
    ],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"],
  });
  app.setGlobalPrefix("");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }),
  );
  const config = new DocumentBuilder()
    .setTitle("Beta AIDA x INVOGO Sandbox API")
    .setDescription(
      "API propia del simulador; no representa endpoints oficiales de INVOGO.",
    )
    .setVersion("0.1.0")
    .build();
  SwaggerModule.setup(
    "api/docs",
    app,
    SwaggerModule.createDocument(app, config),
  );
  await app.listen(process.env.PORT || 4000, "0.0.0.0");
}
bootstrap();
