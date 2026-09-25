import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import ingesta from "../../ingesta.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../ingesta.spec")["default"]>(databaseSchema, ingesta, RegisteredConvexFunction.make);
