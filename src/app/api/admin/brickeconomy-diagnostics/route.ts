import { NextResponse } from "next/server";
import { checkRole } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import {
  FETCH_TIMEOUT_MS,
  fetchSetFacts,
  looksLikeBotChallenge,
} from "@/services/pricing/setFacts/brickEconomyClient";

export const dynamic = "force-dynamic";

/**
 * Reports what the SERVER sees when it reaches BrickEconomy, which is not
 * necessarily what a browser sees.
 *
 * The source is behind Cloudflare, and Cloudflare challenges datacenter IPs
 * much more readily than residential ones. So the catalogue lookup can work
 * perfectly from a laptop and be refused from Railway. This endpoint makes
 * that visible instead of leaving it to be guessed from a slow page.
 *
 * GET /api/admin/brickeconomy-diagnostics?q=10255
 */
export async function GET(request: Request) {
  try {
    await checkRole([UserRole.ADMIN]);
  } catch {
    return NextResponse.json({ error: "Unauthorized. Admin role required." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const identifier = searchParams.get("q") || searchParams.get("identifier") || "10255";

  const probeUrl = `https://www.brickeconomy.com/search?query=${encodeURIComponent(identifier)}`;
  const startedAt = Date.now();

  // Step 1: a raw probe, so we can see the status and body even on a refusal.
  let probe: {
    ok: boolean;
    status: number | null;
    ms: number;
    bytes: number;
    server: string | null;
    cfRay: string | null;
    botChallenge: boolean | null;
    bodyHead: string | null;
    error: string | null;
  };

  try {
    const res = await fetch(probeUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = await res.text();
    probe = {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - startedAt,
      bytes: body.length,
      server: res.headers.get("server"),
      cfRay: res.headers.get("cf-ray"),
      botChallenge: looksLikeBotChallenge(res.status, body),
      bodyHead: body.slice(0, 300).replace(/\s+/g, " "),
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    probe = {
      ok: false,
      status: null,
      ms: Date.now() - startedAt,
      bytes: 0,
      server: null,
      cfRay: null,
      botChallenge: null,
      bodyHead: null,
      error: /abort|timeout|timed out/i.test(msg) ? `Timed out after ${FETCH_TIMEOUT_MS / 1000}s` : msg,
    };
  }

  // Step 2: the real lookup, so the parsed result can be compared.
  const lookupStart = Date.now();
  const facts = await fetchSetFacts(identifier);

  const verdict = probe.botChallenge
    ? "BLOCKED: bot protection is answering instead of the page. The server's IP is being challenged; a browser on a home connection is not."
    : probe.error
      ? "UNREACHABLE: the request did not complete from this server."
      : facts.resolutionError
        ? `REACHED but not parsed: ${facts.resolutionError}`
        : facts.currentValueNew !== null
          ? "OK: page reached, parsed, and a current value was found."
          : "REACHED and parsed, but no current value was published for this set.";

  return NextResponse.json({
    identifier,
    verdict,
    probe,
    lookup: {
      ms: Date.now() - lookupStart,
      setNumber: facts.setNumber,
      name: facts.name,
      status: facts.status,
      rrp: facts.rrp,
      rrpBasis: facts.rrpBasis,
      currentValueNew: facts.currentValueNew,
      usedValue: facts.usedValue,
      valueBasis: facts.valueBasis,
      retirementDate: facts.retirementDate,
      resolutionError: facts.resolutionError,
      sourceUrl: facts.sourceUrl,
    },
    totalMs: Date.now() - startedAt,
  });
}
