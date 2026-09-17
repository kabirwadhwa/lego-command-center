const BASE_URL = process.env.LIVE_APP_URL || "https://lego-command-center-production.up.railway.app";

async function verify() {
  console.log("=== VERIFYING LIVE RAILWAY DEPLOYMENT ===");
  console.log("Target:", BASE_URL);

  const pages = [
    { path: "/", check: "Kristof Vervliet" },
    { path: "/inventory", check: "Grond" },
    { path: "/pricing", check: "Pricing Recommendation Engine" },
    { path: "/alerts", check: "Alerts" },
    { path: "/analytics", check: "Analytics" },
    { path: "/sales", check: "Sales" },
    { path: "/purchases", check: "Purchases" }
  ];

  for (const p of pages) {
    try {
      const res = await fetch(`${BASE_URL}${p.path}`);
      const text = await res.text();
      const hasContent = text.includes(p.check);
      console.log(`[${res.status === 200 && hasContent ? "PASS" : "FAIL"}] ${p.path} (Status: ${res.status}, Found "${p.check}": ${hasContent}, HTML Size: ${text.length}b)`);
    } catch (err) {
      console.log(`[FAIL] ${p.path} Error: ${err.message}`);
    }
  }
}

verify().catch(console.error);
