import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      PROPOSAL_TEMPLATE_EMAIL_1: "contact@example.com",
      PROPOSAL_TEMPLATE_EMAIL_2: "sales@example.com",
    },
  },
});
