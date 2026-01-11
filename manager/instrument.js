// Import with `import * as Sentry from "@sentry/node"` if you are using ESM
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: "https://dbca9a2e8008c3f97c3ba5ddc7f3c4d6@o4510692574101504.ingest.de.sentry.io/4510692647698512",
  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
});