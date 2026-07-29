export const PAYMENT_PROVIDERS = ["mercado_pago", "asaas"] as const;
export const PIX_COLLECTION_MODES = ["tenant_key", "provider_dynamic"] as const;

export type PaymentProviderCode = (typeof PAYMENT_PROVIDERS)[number];
export type PixCollectionMode = (typeof PIX_COLLECTION_MODES)[number];
export type ProviderConnectionMode = "oauth" | "api_key" | "subaccount";
export type ProviderConnectionStatus =
  | "pending"
  | "connected"
  | "needs_reauthorization"
  | "disabled"
  | "error";
export type ProviderPaymentMethod = "pix" | "credit_card";
export type ProviderChargeStatus =
  | "created"
  | "pending"
  | "paid"
  | "failed"
  | "expired"
  | "cancelled"
  | "refunded"
  | "chargeback";

export type ProviderCapabilities = {
  oauth: boolean;
  apiKey: boolean;
  dynamicPix: boolean;
  hostedCardCheckout: boolean;
  recurringCard: boolean;
  pixAutomatic: boolean;
};

export type ProviderConnectionCredentials = {
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  tokenType?: string;
};

export type ConnectedProviderAccount = {
  provider: PaymentProviderCode;
  connectionMode: ProviderConnectionMode;
  providerAccountId: string;
  providerAccountName?: string;
  credentials: ProviderConnectionCredentials;
  grantedScopes: string[];
  tokenExpiresAt?: string;
  capabilities: ProviderCapabilities;
};

export type CreateProviderChargeInput = {
  tenantId: string;
  connectionId: string;
  billingCycleId: string;
  customerId: string;
  externalReference: string;
  paymentMethod: ProviderPaymentMethod;
  amountCents: number;
  dueDate: string;
  description: string;
  payer: {
    name: string;
    email?: string;
    cpf?: string;
    whatsappE164?: string;
  };
};

export type NormalizedProviderCharge = {
  provider: PaymentProviderCode;
  providerChargeId: string;
  externalReference: string;
  paymentMethod: ProviderPaymentMethod;
  status: ProviderChargeStatus;
  amountCents: number;
  feeCents?: number;
  netAmountCents?: number;
  checkoutUrl?: string;
  pixCopyPaste?: string;
  pixExpiresAt?: string;
  paidAt?: string;
  providerPayload: Record<string, unknown>;
};

export type NormalizedProviderEvent = {
  provider: PaymentProviderCode;
  providerEventId: string;
  eventType: string;
  providerAccountId?: string;
  resourceType?: string;
  providerResourceId?: string;
  providerChargeId?: string;
  chargeStatus?: ProviderChargeStatus;
  occurredAt?: string;
  payload: Record<string, unknown>;
};

export interface TenantPaymentProviderAdapter {
  readonly provider: PaymentProviderCode;
  readonly capabilities: ProviderCapabilities;

  createCharge(
    credentials: ProviderConnectionCredentials,
    input: CreateProviderChargeInput
  ): Promise<NormalizedProviderCharge>;

  getCharge(
    credentials: ProviderConnectionCredentials,
    providerChargeId: string
  ): Promise<NormalizedProviderCharge>;

  cancelCharge(
    credentials: ProviderConnectionCredentials,
    providerChargeId: string
  ): Promise<NormalizedProviderCharge>;

  normalizeWebhook(request: Request): Promise<NormalizedProviderEvent>;
}

export function isPaymentProvider(value: unknown): value is PaymentProviderCode {
  return PAYMENT_PROVIDERS.includes(value as PaymentProviderCode);
}

export function isPixCollectionMode(value: unknown): value is PixCollectionMode {
  return PIX_COLLECTION_MODES.includes(value as PixCollectionMode);
}
