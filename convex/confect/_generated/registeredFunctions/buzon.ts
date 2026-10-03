import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import buzon from "../../buzon.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../buzon.spec")["default"]>(databaseSchema, buzon, RegisteredConvexFunction.make);
