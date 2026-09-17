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

fetch("https://lego-command-center-production.up.railway.app/api/test/query?token=7919a1be-8967-4e2d-a3a6-1b11cf106a64", {
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
