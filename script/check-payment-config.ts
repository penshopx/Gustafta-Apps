import { DEFAULT_PAYMENT_BASE_URL } from "../shared/payment-base-url";

/** Compare the URLs actually used by the server and the built client. */
export function checkPaymentBaseConfig(serverUrl: string | undefined, clientUrl: string | undefined): void {
  const effectiveServerUrl = serverUrl || DEFAULT_PAYMENT_BASE_URL;
  const effectiveClientUrl = clientUrl || DEFAULT_PAYMENT_BASE_URL;
  if (effectiveServerUrl !== effectiveClientUrl) {
    throw new Error(
      `Alamat pembayaran tidak konsisten: PAYMENT_BASE_URL=${JSON.stringify(effectiveServerUrl)} ` +
      `berbeda dari VITE_PAYMENT_BASE_URL=${JSON.stringify(effectiveClientUrl)}. ` +
      "Samakan keduanya sebelum build rilis.",
    );
  }
}
