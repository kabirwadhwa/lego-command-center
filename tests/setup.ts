// Test environment setup: ensure tests do not trigger live external network calls to third-party scrapers by default
delete process.env.APIFY_API_TOKEN;
