import { leerMuestra } from "@celda/ingesta/pruebas/grabado";
import { clienteDePrueba, NO_HAY_ROBOTS, type Peticion } from "@celda/ingesta/pruebas/http";
import { capaPorCajas, OPCIONES } from "@celda/ingesta/registro-oficial/extractor";
import { decodificarLatin1 } from "@celda/ingesta/texto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

/**
 * Un geoportal de prueba que contesta como el de verdad, para el extractor real sobre un cliente
 * HTTP de prueba: el listado grabado en el Campus Nord y fichas grabadas en HTML.
 */

/** Bytes en ISO-8859-1, como los manda el geoportal. */
export const latin1 = (texto: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(texto, (caracter) => caracter.charCodeAt(0));

/** Un elemento del listado grabado, con lo que lee el extractor, que una prueba puede cambiar. */
const ElementoDelListado = Schema.Struct({
  type: Schema.String,
  id: Schema.String,
  geometry: Schema.Struct({
    type: Schema.String,
    coordinates: Schema.Tuple([Schema.Finite, Schema.Finite]),
  }),
  properties: Schema.Struct({ Gis_ID: Schema.String, Dirección: Schema.String }),
});
export type ElementoDelListado = typeof ElementoDelListado.Type;

const ListadoEnJson = Schema.fromJsonString(
  Schema.Struct({ features: Schema.Array(ElementoDelListado) }),
);
const decodificarListado = Schema.decodeEffect(ListadoEnJson);
const codificarListado = Schema.encodeSync(ListadoEnJson);
const sinCambios = (elementos: ReadonlyArray<ElementoDelListado>) => elementos;

/** Lo que contesta el geoportal de prueba a cada ficha, por su código. */
export type Fichas = (codigo: string) => Uint8Array<ArrayBuffer>;

/**
 * El geoportal con el listado grabado en el Campus Nord, que contesta cada caja con los elementos
 * que caen en ella, y cada ficha con lo que diga `fichas`. `listado` cambia los elementos antes de
 * contestar, como si el registro escribiera otra cosa. Apunta cada petición.
 */
export const geoportal = (
  fichas: Ref.Ref<Fichas>,
  listado?: Ref.Ref<
    (elementos: ReadonlyArray<ElementoDelListado>) => ReadonlyArray<ElementoDelListado>
  >,
) =>
  Effect.gen(function* () {
    const { features: elementos } = yield* decodificarListado(
      decodificarLatin1(yield* leerMuestra("geojson-campus-nord.iso-8859-1.json")),
    );
    const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
    return {
      peticiones,
      /** El extractor real sobre ese geoportal, sin pausas, para que el reloj no tenga que andar. */
      extractor: Effect.map(
        Effect.all([
          Ref.get(fichas),
          listado === undefined ? Effect.succeed(sinCambios) : Ref.get(listado),
        ]),
        ([deFicha, cambiar]) =>
          capaPorCajas(
            { ...OPCIONES, pausa: Duration.zero },
            { ...OPCIONES, pausa: Duration.zero, maxPeticiones: 1000 },
          ).pipe(
            Layer.provide(
              clienteDePrueba(peticiones, (url) => {
                if (url.pathname === "/robots.txt") return NO_HAY_ROBOTS;
                if (url.pathname === "/VCTEL/detalleEstacion.do") {
                  return {
                    estado: 200,
                    cuerpo: deFicha(url.searchParams.get("emplazamiento") ?? ""),
                  };
                }
                const [oeste = 0, sur = 0, este = 0, norte = 0] = (
                  url.searchParams.get("bbox") ?? ""
                )
                  .split(",")
                  .map(Number);
                const dentro = cambiar(elementos).filter(
                  ({
                    geometry: {
                      coordinates: [longitud, latitud],
                    },
                  }) => longitud >= oeste && longitud <= este && latitud >= sur && latitud <= norte,
                );
                return {
                  estado: 200,
                  cuerpo: latin1(
                    dentro.length === 0 ? "{}" : codificarListado({ features: dentro }),
                  ),
                };
              }),
            ),
          ),
      ),
    };
  });

/** Las fichas grabadas: tres en HTML, el aviso de código no válido y una que no se puede leer. */
export const fichasGrabadas = Effect.gen(function* () {
  const muestra = (nombre: string) => Effect.map(leerMuestra(nombre), (b) => new Uint8Array(b));
  const telefonica = yield* muestra("detalle-telefonica-0800942.iso-8859-1.html");
  const orange = yield* muestra("detalle-orange-CATR0228A.iso-8859-1.html");
  const digi = yield* muestra("detalle-digi-0800143.iso-8859-1.html");
  const sinFicha = yield* muestra("detalle-codigo-no-valido.iso-8859-1.html");
  const ilegible = latin1('<table class="tablaDetalleEstacion"><tr><td>Obras</td></tr>');
  const fichas: Fichas = (codigo) => {
    switch (codigo) {
      case "0800942":
        return telefonica;
      case "CATR0228A":
        return orange;
      case "079808":
        return sinFicha;
      case "0800199":
        return ilegible;
      default:
        return digi;
    }
  };
  return { fichas, telefonica, orange, digi, sinFicha, ilegible };
});
