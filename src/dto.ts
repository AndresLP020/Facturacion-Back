import {
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  registerDecorator,
  ValidationOptions,
} from "class-validator";
import { Type } from "class-transformer";

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}

export class CustomerDto {
  @IsString() @MinLength(2) @MaxLength(200)
  legalName!: string;

  @IsString() @Matches(/^(?:[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})$/i)
  rfc!: string;

  @IsEnum(["MORAL", "PHYSICAL"])
  personType!: "MORAL" | "PHYSICAL";

  @IsString() @MinLength(1) @MaxLength(20)
  taxRegime!: string;

  @IsString() @MinLength(1) @MaxLength(20)
  cfdiUse!: string;

  @IsString() @Matches(/^\d{5}$/)
  postalCode!: string;

  @IsOptional() @IsString() @MaxLength(60)
  country?: string;

  @IsString() @MinLength(2) @MaxLength(100)
  state!: string;

  @IsString() @MinLength(2) @MaxLength(100)
  municipality!: string;

  @IsOptional() @IsString() @MaxLength(100)
  locality?: string;

  @IsOptional() @IsString() @MaxLength(200)
  street?: string;
}

export class UpdateCustomerDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200)
  legalName?: string;
  @IsOptional() @IsString() @Matches(/^(?:[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})$/i)
  rfc?: string;
  @IsOptional() @IsEnum(["MORAL", "PHYSICAL"])
  personType?: "MORAL" | "PHYSICAL";
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20)
  taxRegime?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20)
  cfdiUse?: string;
  @IsOptional() @IsString() @Matches(/^\d{5}$/)
  postalCode?: string;
  @IsOptional() @IsString() @MaxLength(60)
  country?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100)
  state?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100)
  municipality?: string;
  @IsOptional() @IsString() @MaxLength(100)
  locality?: string;
  @IsOptional() @IsString() @MaxLength(200)
  street?: string;
}

function IsDecimalInput(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) => registerDecorator({
    name: "isDecimalInput",
    target: target.constructor,
    propertyName: String(propertyKey),
    options,
    validator: {
      validate(value: unknown) {
        return (typeof value === "string" || typeof value === "number") &&
          String(value).length <= 32 &&
          /^(\d{1,14})(\.\d{1,6})?$/.test(String(value));
      },
      defaultMessage: () => "Debe ser un decimal positivo con hasta seis decimales",
    },
  });
}

export class DraftItemDto {
  @IsOptional() @IsString() @MaxLength(100)
  sku?: string;
  @IsString() @MinLength(1) @MaxLength(32)
  satKey!: string;
  @IsString() @MinLength(1) @MaxLength(500)
  description!: string;
  @IsString() @MinLength(1) @MaxLength(30)
  unit!: string;
  @IsDecimalInput()
  quantity!: string | number;
  @IsDecimalInput()
  unitPrice!: string | number;
  @IsOptional() @IsDecimalInput()
  discount?: string | number;
  @IsOptional() @IsDecimalInput()
  taxRate?: string | number;
  @IsOptional() @IsDecimalInput()
  withholdingRate?: string | number;
}

export class InvoiceRelationDto {
  @IsString() @MinLength(1) @MaxLength(10)
  relationType!: string;
  @IsString() @MinLength(1) @MaxLength(100)
  reference!: string;
}

export class DraftDto {
  @IsString() @Matches(/^[0-9a-f-]{36}$/i)
  customerId!: string;
  @IsOptional() @IsString() @MaxLength(20)
  series?: string;
  @IsOptional() @IsString() @MaxLength(40)
  folio?: string;
  @IsOptional() @IsDateString()
  issuedAt?: string;
  @IsOptional() @IsString() @MaxLength(10)
  paymentForm?: string;
  @IsOptional() @IsString() @MaxLength(10)
  paymentMethod?: string;
  @IsOptional() @IsString() @MaxLength(10)
  documentType?: string;
  @IsOptional() @IsString() @Matches(/^\d{5}$/)
  placeOfIssue?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/)
  currency?: string;
  @IsOptional() @IsDecimalInput()
  exchangeRate?: string | number;
  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => DraftItemDto)
  items!: DraftItemDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => InvoiceRelationDto)
  relations?: InvoiceRelationDto[];
}

export class GhlContextDto {
  @IsString()
  @MinLength(16)
  @MaxLength(32000)
  encryptedData!: string;
}
