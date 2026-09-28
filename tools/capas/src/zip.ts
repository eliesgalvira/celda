import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

/**
 * Lo justo para sacar ficheros de un ZIP, como el de límites del IGN: el directorio central y
 * entradas guardadas tal cual o comprimidas con deflate. No lee ZIP64 ni ficheros cifrados.
 */

/** El fichero no es un ZIP que se sepa leer. */
export class ZipIlegible extends Schema.TaggedError<ZipIlegible>()("ZipIlegible", {
  motivo: Schema.String,
}) {}

/** Una entrada del directorio central. */
export interface EntradaDeZip {
  readonly nombre: string;
  readonly metodo: number;
  readonly comprimido: number;
  readonly descomprimido: number;
  /** Dónde empieza su cabecera local. */
  readonly cabecera: number;
}

const FIN_DEL_DIRECTORIO = 0x06_05_4b_50;
const ENTRADA_CENTRAL = 0x02_01_4b_50;
const CABECERA_LOCAL = 0x04_03_4b_50;
const SIN_COMPRIMIR = 0;
const DEFLATE = 8;

const leerDirectorio = (zip: Uint8Array): ReadonlyArray<EntradaDeZip> => {
  const datos = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // El final del directorio está en los últimos 22 bytes más un comentario de hasta 64 KB.
  let fin = -1;
  for (let k = zip.length - 22; k >= Math.max(0, zip.length - 22 - 65_535); k--) {
    if (datos.getUint32(k, true) === FIN_DEL_DIRECTORIO) {
      fin = k;
      break;
    }
  }
  if (fin < 0) throw new Error("no tiene directorio central");
  const cuantas = datos.getUint16(fin + 10, true);
  let k = datos.getUint32(fin + 16, true);
  const entradas: Array<EntradaDeZip> = [];
  const texto = new TextDecoder();
  for (let n = 0; n < cuantas; n++) {
    if (datos.getUint32(k, true) !== ENTRADA_CENTRAL) {
      throw new Error(`la entrada ${n} del directorio está dañada`);
    }
    const largoNombre = datos.getUint16(k + 28, true);
    const entrada = {
      nombre: texto.decode(zip.subarray(k + 46, k + 46 + largoNombre)),
      metodo: datos.getUint16(k + 10, true),
      comprimido: datos.getUint32(k + 20, true),
      descomprimido: datos.getUint32(k + 24, true),
      cabecera: datos.getUint32(k + 42, true),
    };
    if (entrada.comprimido === 0xff_ff_ff_ff || entrada.cabecera === 0xff_ff_ff_ff) {
      throw new Error(`${entrada.nombre} está en ZIP64`);
    }
    entradas.push(entrada);
    k += 46 + largoNombre + datos.getUint16(k + 30, true) + datos.getUint16(k + 32, true);
  }
  return entradas;
};

/** Las entradas del directorio central, en su orden. */
export const entradasDelZip = (
  zip: Uint8Array,
): Result.Result<ReadonlyArray<EntradaDeZip>, ZipIlegible> =>
  Result.try({
    try: () => leerDirectorio(zip),
    catch: (causa) =>
      new ZipIlegible({ motivo: causa instanceof Error ? causa.message : String(causa) }),
  });

/** Los bytes de una entrada, descomprimidos. */
export const leerEntrada = Effect.fn("Zip.leerEntrada")(function* (
  zip: Uint8Array,
  entrada: EntradaDeZip,
) {
  const datos = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (datos.getUint32(entrada.cabecera, true) !== CABECERA_LOCAL) {
    return yield* new ZipIlegible({ motivo: `la cabecera de ${entrada.nombre} está dañada` });
  }
  const inicio =
    entrada.cabecera +
    30 +
    datos.getUint16(entrada.cabecera + 26, true) +
    datos.getUint16(entrada.cabecera + 28, true);
  const comprimidos = zip.subarray(inicio, inicio + entrada.comprimido);
  if (entrada.metodo === SIN_COMPRIMIR) return comprimidos;
  if (entrada.metodo !== DEFLATE) {
    return yield* new ZipIlegible({
      motivo: `${entrada.nombre} usa el método de compresión ${entrada.metodo}`,
    });
  }
  const bytes = yield* Effect.tryPromise({
    try: () =>
      new Response(
        new Blob([comprimidos]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
      ).arrayBuffer(),
    catch: (causa) =>
      new ZipIlegible({ motivo: `${entrada.nombre} no se descomprime: ${String(causa)}` }),
  });
  if (bytes.byteLength !== entrada.descomprimido) {
    return yield* new ZipIlegible({
      motivo: `${entrada.nombre} ocupa ${bytes.byteLength} bytes y debería ocupar ${entrada.descomprimido}`,
    });
  }
  return new Uint8Array(bytes);
});
