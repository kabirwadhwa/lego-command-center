const BASE_URL = process.env.LIVE_APP_URL || "https://lego-command-center-production.up.railway.app";

async function testLogin() {
  console.log("Testing login flow on live Railway app...");

  // 1. Password Verification
  const verifyRes = await fetch(`${BASE_URL}/api/auth/demo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Forwarded-Host": "lego-command-center-production.up.railway.app",
      "X-Forwarded-Proto": "https"
    },
    body: "action=verify-password&password=Admin123!",
    redirect: "manual"
  });

  console.log("Verify Password Response Status:", verifyRes.status);
  const verifyCookies = verifyRes.headers.get("set-cookie");
  console.log("Verify Cookies:", verifyCookies);

  if (!verifyCookies || !verifyCookies.includes("demo_access_token")) {
    console.error("Failed to get demo_access_token cookie.");
    return;
  }

  const demoTokenCookie = verifyCookies.split(";")[0];

  // 2. Profile Selection Login
  const loginRes = await fetch(`${BASE_URL}/api/auth/demo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Forwarded-Host": "lego-command-center-production.up.railway.app",
      "X-Forwarded-Proto": "https",
      "Cookie": demoTokenCookie
    },
    body: "action=login-profile&userId=44444444-4444-4444-4444-444444444444",
    redirect: "manual"
  });

  console.log("Profile Login Response Status:", loginRes.status);
  const loginCookies = loginRes.headers.get("set-cookie");
  console.log("Profile Cookies:", loginCookies);

  if (!loginCookies || !loginCookies.includes("lego_demo_user_id")) {
    console.error("Failed to get lego_demo_user_id cookie.");
    return;
  }

  const userIdCookie = loginCookies.split(";")[0];
  const combinedCookies = `${demoTokenCookie}; ${userIdCookie}`;

  // 3. Fetch Dashboard Page
  const dashRes = await fetch(`${BASE_URL}/`, {
    headers: {
      "Cookie": combinedCookies
    }
  });

  console.log("Dashboard GET Response Status:", dashRes.status);
  const html = await dashRes.text();
  console.log("HTML length:", html.length);
  if (html.includes("Kristof Vervliet")) {
    console.log("✅ Successfully reached Dashboard as Kristof!");
  } else {
    console.log("❌ Dashboard content does not contain Kristof's name.");
  }
}

testLogin().catch(console.error);
