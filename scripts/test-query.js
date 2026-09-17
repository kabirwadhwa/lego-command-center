process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const body = {
  model: "product",
  action: "findMany",
  args: {
    take: 3,
    include: {
      variants: true
    }
  }
};

const token = process.env.TEST_AUTH_TOKEN;
if (!token) {
  console.error("Error: TEST_AUTH_TOKEN environment variable is required.");
  process.exit(1);
}

fetch(`https://lego-command-center-production.up.railway.app/api/test/query?token=${encodeURIComponent(token)}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(body)
})
.then(res => {
  console.log("Status:", res.status);
  return res.json();
})
.then(data => {
  console.log(JSON.stringify(data, null, 2));
})
.catch(err => {
  console.error("Error querying database:", err);
});
