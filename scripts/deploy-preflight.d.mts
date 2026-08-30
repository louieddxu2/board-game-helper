export interface CloudflareSecretMetadata {
  name: string;
  type?: string;
}

export declare const REQUIRED_PRODUCTION_SECRETS: readonly string[];
export declare const missingRequiredSecrets: (
  secrets: ReadonlyArray<string | CloudflareSecretMetadata>,
  required?: readonly string[],
) => string[];
export declare const parseSecretList: (output: string) => CloudflareSecretMetadata[];
