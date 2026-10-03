import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import moderacion from "../../moderacion.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../moderacion.spec")["default"]>(databaseSchema, moderacion, RegisteredConvexFunction.make);
