import tema from "../tema.css?raw";
import { leerTokens, type Tema } from "../tokens.ts";

export type { Tema };

/** Las variables CSS que define tema.css para un tema, con su valor tal cual. */
export const tokensDelTema = (cual: Tema): ReadonlyMap<string, string> => leerTokens(tema, cual);
