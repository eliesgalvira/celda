import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import datos from "../../datos.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../datos.spec")["default"]>(databaseSchema, datos, RegisteredConvexFunction.make);
