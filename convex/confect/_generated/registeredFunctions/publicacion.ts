import { RegisteredFunctions } from "@confect/server";
import { RegisteredNodeFunction } from "@confect/server/node";
import databaseSchema from "../schema";
import publicacion from "../../publicacion.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../publicacion.spec")["default"]>(databaseSchema, publicacion, RegisteredNodeFunction.make);
