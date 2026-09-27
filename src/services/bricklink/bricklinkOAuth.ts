import crypto from "node:crypto";

export interface BrickLinkCredentials {
  consumerKey: string;
  consumerSecret: string;
  tokenValue: string;
  tokenSecret: string;
}

export interface OAuthSignOptions {
  method: string;
  url: string;
  queryParams?: Record<string, string | number | boolean | undefined | null>;
  timestamp?: number;
  nonce?: string;
}

export interface OAuthSignedResult {
  authorizationHeader: string;
  signature: string;
  signatureBaseString: string;
  signingKey: string;
  timestamp: string;
  nonce: string;
}

/**
 * Strict RFC 3986 percent-encoding.
 * JavaScript's encodeURIComponent does not encode !'()* which RFC 3986 mandates.
 */
export function rfc3986Encode(value: string | number | boolean): string {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => {
    return `%${c.charCodeAt(0).toString(16).toUpperCase()}`;
  });
}

/**
 * Normalizes query string and OAuth parameters into RFC 5849 sorted string.
 */
export function normalizeParameters(
  params: Record<string, string | number | boolean>
): string {
  const encodedPairs: { key: string; val: string }[] = [];

  for (const [k, v] of Object.entries(params)) {
    encodedPairs.push({
      key: rfc3986Encode(k),
      val: rfc3986Encode(v),
    });
  }

  // Sort lexicographically by key, then value
  encodedPairs.sort((a, b) => {
    if (a.key === b.key) {
      return a.val.localeCompare(b.val);
    }
    return a.key.localeCompare(b.key);
  });

  return encodedPairs.map((p) => `${p.key}=${p.val}`).join("&");
}

/**
 * Generates an OAuth 1.0 HMAC-SHA1 signature and Authorization header for BrickLink API.
 */
export function signBrickLinkRequest(
  credentials: BrickLinkCredentials,
  options: OAuthSignOptions
): OAuthSignedResult {
  const method = options.method.toUpperCase();

  // Normalize base URL (strip query string and hash)
  const urlObj = new URL(options.url);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;

  const timestamp = options.timestamp
    ? String(options.timestamp)
    : String(Math.floor(Date.now() / 1000));

  const nonce = options.nonce || crypto.randomBytes(16).toString("hex");

  // Collect all parameters: URL search params + explicit queryParams + OAuth protocol params
  const paramMap: Record<string, string | number | boolean> = {};

  // 1. URL search params (if present on url)
  urlObj.searchParams.forEach((val, key) => {
    paramMap[key] = val;
  });

  // 2. Explicit query params
  if (options.queryParams) {
    for (const [k, v] of Object.entries(options.queryParams)) {
      if (v !== undefined && v !== null) {
        paramMap[k] = v;
      }
    }
  }

  // 3. OAuth protocol parameters
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_token: credentials.tokenValue,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_nonce: nonce,
    oauth_version: "1.0",
  };

  // Combine for base string signing (excluding oauth_signature)
  const allParamsForSigning: Record<string, string | number | boolean> = {
    ...paramMap,
    ...oauthParams,
  };

  const normalizedParams = normalizeParameters(allParamsForSigning);

  // Construct signature base string
  const signatureBaseString = `${method}&${rfc3986Encode(baseUrl)}&${rfc3986Encode(normalizedParams)}`;

  // Construct signing key
  const signingKey = `${rfc3986Encode(credentials.consumerSecret)}&${rfc3986Encode(credentials.tokenSecret)}`;

  // Calculate HMAC-SHA1 digest
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(signatureBaseString)
    .digest("base64");

  // Construct standard Authorization header with realm=""
  const headerParams: Record<string, string> = {
    realm: "",
    ...oauthParams,
    oauth_signature: signature,
  };

  const authHeaderComponents = Object.entries(headerParams).map(
    ([k, v]) => `${rfc3986Encode(k)}="${rfc3986Encode(v)}"`
  );

  const authorizationHeader = `OAuth ${authHeaderComponents.join(",")}`;

  return {
    authorizationHeader,
    signature,
    signatureBaseString,
    signingKey,
    timestamp,
    nonce,
  };
}
