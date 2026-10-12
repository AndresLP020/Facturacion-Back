export type Environment = 'SANDBOX';
export interface CompanyDTO { id: string; name: string; environment: Environment }
export interface CustomerDTO { id: string; legalName: string; rfc: string; personType: 'MORAL'|'PHYSICAL'; taxRegime: string; cfdiUse: string; postalCode: string }
export interface DraftItemDTO { satKey: string; description: string; unit: string; quantity: string; unitPrice: string; amount: string; discount: string; taxRate: string; withholdingRate: string }
export interface InvoiceDTO { id: string; status: 'DRAFT'; total: string; items: DraftItemDTO[] }
export interface ApiErrorDTO { statusCode: number; message: string; correlationId: string }
