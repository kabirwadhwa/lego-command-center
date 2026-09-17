process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const query = `
query {
  projectToken {
    project {
      services {
        edges {
          node {
            name
            id
            serviceInstances {
              edges {
                node {
                  latestDeployment {
                    id
                    status
                    createdAt
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

const token = process.env.RAILWAY_PROJECT_TOKEN;
if (!token) {
  console.error("Error: RAILWAY_PROJECT_TOKEN environment variable is required.");
  process.exit(1);
}

fetch("https://backboard.railway.app/graphql/v2", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Project-Access-Token": token
  },
  body: JSON.stringify({ query })
})
.then(res => res.json())
.then(data => {
  console.log(JSON.stringify(data, null, 2));
})
.catch(err => {
  console.error("Error fetching deployments:", err);
});
