import { Router, type IRouter } from "express";
import daasRouter from "./daas";
import healthRouter from "./health";
import quotesRouter from "./quotes";
import { sameOrigin, requireUser } from "../middlewares/app-auth";
import { requireRole, APP_ROLES } from "../middlewares/require-role";
import usersRouter from "./users";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sameOrigin, requireUser, requireRole(...APP_ROLES));
router.use(usersRouter);
router.use(quotesRouter);
router.use(daasRouter);

export default router;
