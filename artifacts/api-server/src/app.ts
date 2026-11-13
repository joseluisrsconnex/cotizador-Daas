import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import { serveFrontend } from "./lib/serve-frontend";

const app: Express = express();
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) app.set("trust proxy", trustProxy === "1" ? 1 : trustProxy);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(clerkMiddleware((req) => ({
  publishableKey: process.env.CLERK_PROXY_ENABLED === "false"
    ? process.env.CLERK_PUBLISHABLE_KEY
    : publishableKeyFromHost(getClerkProxyHost(req) ?? "", process.env.CLERK_PUBLISHABLE_KEY),
  ...(process.env.CLERK_AUTHORIZED_PARTIES
    ? { authorizedParties: process.env.CLERK_AUTHORIZED_PARTIES.split(",").map(value => value.trim()).filter(Boolean) }
    : {}),
})));

app.use("/api", router);
serveFrontend(app, process.env.STATIC_DIR);

export default app;
