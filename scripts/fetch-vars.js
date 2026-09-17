process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const query = `
mutation {
  serviceInstanceDeploy(
    environmentId: "b3147a05-f56f-4633-96e7-5d26870da2c3"
    serviceId: "83d6170a-b691-4a07-ac40-85140af99e1e"
    latestCommit: true
  )
}
`;

fetch("https://backboard.railway.app/graphql/v2", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Project-Access-Token": "7919a1be-8967-4e2d-a3a6-1b11cf106a64"
  },
  body: JSON.stringify({ query })
})
.then(res => res.json())
.then(data => {
  console.log(JSON.stringify(data, null, 2));
})
.catch(err => {
  console.error("Error triggering deploy:", err);
});
