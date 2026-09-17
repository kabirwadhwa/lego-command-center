const token = process.env.TEST_AUTH_TOKEN;
if (!token) {
  console.error("Error: TEST_AUTH_TOKEN environment variable is required.");
  process.exit(1);
}

const url = `https://lego-command-center-production.up.railway.app/api/test/seed?token=${encodeURIComponent(token)}`;

console.log("Triggering database seed on live Railway app...");

fetch(url, {
  method: "POST"
})
.then(async res => {
  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Response:", text);
})
.catch(err => {
  console.error("Seed request failed:", err);
});
