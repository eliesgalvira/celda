import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import capas from "../../capas.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../capas.spec")["default"]>(databaseSchema, capas, RegisteredConvexFunction.make);
