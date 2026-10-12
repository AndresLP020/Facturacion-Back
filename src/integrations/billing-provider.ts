import {
  CustomerDTO,
  CompanyDTO,
  InvoiceDTO,
} from "../contracts";

export interface ProviderContext {
  companyId: string;
  actorId: string;
  correlationId: string;
}
export interface CustomerPage {
  items: CustomerDTO[];
  nextCursor?: string;
}
export interface CreateDraftDTO {
  customerId: string;
  items: Array<{
    satKey: string;
    description: string;
    unit: string;
    quantity: string;
    unitPrice: string;
  }>;
}
export interface BillingProvider {
  getCompany(context: ProviderContext): Promise<CompanyDTO>;
  listCustomers(
    context: ProviderContext,
    cursor?: string,
  ): Promise<CustomerPage>;
  getCustomer(context: ProviderContext, id: string): Promise<CustomerDTO>;
  createDraft(
    context: ProviderContext,
    input: CreateDraftDTO,
    idempotencyKey: string,
  ): Promise<InvoiceDTO>;
  getDraft(context: ProviderContext, id: string): Promise<InvoiceDTO>;
}

/** Explicit mock adapter: delegates to the local PostgreSQL simulator. */
export class MockInvogoProvider implements BillingProvider {
  constructor(private readonly unavailable: never = undefined as never) {
    void this.unavailable;
  }
  async getCompany(): Promise<CompanyDTO> {
    throw new Error("Use BusinessService for mock provider operations");
  }
  async listCustomers(): Promise<CustomerPage> {
    throw new Error("Use BusinessService for mock provider operations");
  }
  async getCustomer(): Promise<CustomerDTO> {
    throw new Error("Use BusinessService for mock provider operations");
  }
  async createDraft(): Promise<InvoiceDTO> {
    throw new Error("Use BusinessService for mock provider operations");
  }
  async getDraft(): Promise<InvoiceDTO> {
    throw new Error("Use BusinessService for mock provider operations");
  }
}

/** Intentionally unavailable until INVOGO supplies its official contract and credentials. */
export class RealInvogoProvider implements BillingProvider {
  constructor() {
    if (!process.env.INVOGO_API_BASE_URL || !process.env.INVOGO_API_KEY)
      throw new Error(
        "Real INVOGO provider is disabled: official API contract and credentials are required",
      );
  }
  private unavailable(): never {
    throw new Error(
      "Official INVOGO API contract has not been supplied; operation unavailable",
    );
  }
  async getCompany(): Promise<CompanyDTO> {
    return this.unavailable();
  }
  async listCustomers(): Promise<CustomerPage> {
    return this.unavailable();
  }
  async getCustomer(): Promise<CustomerDTO> {
    return this.unavailable();
  }
  async createDraft(): Promise<InvoiceDTO> {
    return this.unavailable();
  }
  async getDraft(): Promise<InvoiceDTO> {
    return this.unavailable();
  }
}
