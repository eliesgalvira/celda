import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Une clases de Tailwind; las posteriores ganan a las anteriores. Solo se usa dentro de packages/ui. */
export const cn = (...clases: ReadonlyArray<ClassValue>): string => twMerge(clsx(clases));
