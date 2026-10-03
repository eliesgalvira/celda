import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import limpieza from "../../limpieza.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../limpieza.spec")["default"]>(databaseSchema, limpieza, RegisteredConvexFunction.make);
