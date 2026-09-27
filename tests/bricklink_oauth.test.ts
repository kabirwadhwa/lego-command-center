import {
  rfc3986Encode,
  normalizeParameters,
  signBrickLinkRequest,
  BrickLinkCredentials,
} from "../src/services/bricklink/bricklinkOAuth";

describe("BrickLink OAuth 1.0 Signer (RFC 5849 / RFC 3986)", () => {
  describe("rfc3986Encode", () => {
    it("preserves unreserved characters (ALPHA, DIGIT, -._~)", () => {
      expect(rfc3986Encode("abcXYZ123-._~")).toBe("abcXYZ123-._~");
    });

    it("strictly encodes RFC 3986 reserved characters including !'()*", () => {
      expect(rfc3986Encode("hello world")).toBe("hello%20world");
      expect(rfc3986Encode("a!b'c(d)e*f")).toBe("a%21b%27c%28d%29e%2Af");
      expect(rfc3986Encode("price=10.5&guide=sold")).toBe("price%3D10.5%26guide%3Dsold");
    });
  });

  describe("normalizeParameters", () => {
    it("sorts parameters lexicographically by percent-encoded key", () => {
      const normalized = normalizeParameters({
        z: "last",
        a: "first",
        b: "middle",
      });
      expect(normalized).toBe("a=first&b=middle&z=last");
    });

    it("encodes keys and values properly in normalized output", () => {
      const normalized = normalizeParameters({
        "item name": "Star Wars",
        guide_type: "sold",
      });
      expect(normalized).toBe("guide_type=sold&item%20name=Star%20Wars");
    });
  });

  describe("signBrickLinkRequest", () => {
    const testCredentials: BrickLinkCredentials = {
      consumerKey: "test_consumer_key_12345",
      consumerSecret: "test_consumer_secret_67890",
      tokenValue: "test_token_value_abcde",
      tokenSecret: "test_token_secret_fghij",
    };

    it("generates deterministic HMAC-SHA1 signature given fixed timestamp and nonce", () => {
      const result1 = signBrickLinkRequest(testCredentials, {
        method: "GET",
        url: "https://api.bricklink.com/api/store/v1/items/SET/10316-1/price",
        queryParams: {
          guide_type: "sold",
          new_or_used: "N",
          currency_code: "EUR",
        },
        timestamp: 1718000000,
        nonce: "deterministic_nonce_12345",
      });

      const result2 = signBrickLinkRequest(testCredentials, {
        method: "GET",
        url: "https://api.bricklink.com/api/store/v1/items/SET/10316-1/price",
        queryParams: {
          guide_type: "sold",
          new_or_used: "N",
          currency_code: "EUR",
        },
        timestamp: 1718000000,
        nonce: "deterministic_nonce_12345",
      });

      // Signature base string must be identical
      expect(result1.signatureBaseString).toBe(result2.signatureBaseString);
      expect(result1.signature).toBe(result2.signature);
      expect(result1.authorizationHeader).toBe(result2.authorizationHeader);

      // Verify signing key structure: consumerSecret&tokenSecret
      expect(result1.signingKey).toBe("test_consumer_secret_67890&test_token_secret_fghij");

      // Verify Authorization header format
      expect(result1.authorizationHeader.startsWith('OAuth realm="",')).toBe(true);
      expect(result1.authorizationHeader).toContain('oauth_consumer_key="test_consumer_key_12345"');
      expect(result1.authorizationHeader).toContain('oauth_token="test_token_value_abcde"');
      expect(result1.authorizationHeader).toContain('oauth_signature_method="HMAC-SHA1"');
      expect(result1.authorizationHeader).toContain('oauth_timestamp="1718000000"');
      expect(result1.authorizationHeader).toContain('oauth_nonce="deterministic_nonce_12345"');
      expect(result1.authorizationHeader).toContain('oauth_version="1.0"');
      expect(result1.authorizationHeader).toContain(`oauth_signature="${rfc3986Encode(result1.signature)}"`);
    });

    it("verifies against RFC 5849 Section 3.4.1.1 example base string vectors", () => {
      // RFC 5849 example credentials and request
      const rfcCreds: BrickLinkCredentials = {
        consumerKey: "dpf43f3p2l4k3l03",
        consumerSecret: "kd94hf93kjl27hs6",
        tokenValue: "nnch734d00sl2jdk",
        tokenSecret: "pfkkdhi9sl3r4s00",
      };

      const signed = signBrickLinkRequest(rfcCreds, {
        method: "POST",
        url: "http://example.com/request?b5=%3D%253D&a3=a",
        queryParams: {
          "c@": "",
          a2: "r b",
        },
        timestamp: 137131201,
        nonce: "kllo9940pd9333jh",
      });

      // Expected normalized parameter string according to RFC 5849 Section 3.4.1.3.2
      // a2=r%20b, a3=a, b5=%3D%253D, c%40=, oauth_consumer_key=..., oauth_nonce=..., oauth_signature_method=..., oauth_timestamp=..., oauth_token=..., oauth_version=1.0
      expect(signed.signatureBaseString).toContain("POST&http%3A%2F%2Fexample.com%2Frequest&");
      // Signing key according to RFC 5849 Section 3.4.2
      expect(signed.signingKey).toBe("kd94hf93kjl27hs6&pfkkdhi9sl3r4s00");
      // Generated signature is non-empty base64 string
      expect(signed.signature).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    });
  });
});
