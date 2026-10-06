// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { CapitalesDeMunicipios, indexarMunicipios } from "@celda/dominio/municipio";
import {
  clienteDePrueba,
  NO_HAY_ROBOTS,
  type Peticion,
  type Respuesta,
} from "@celda/ingesta/pruebas/http";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  asignarCapitales,
  CAPACIDADES_NGBE,
  type CapitalDelNgbe,
  capitalesDelWfs,
  descargarCapitales,
  leerCapacidades,
  paginaDeCapitales,
  POR_PAGINA,
} from "./capitales.ts";
import { unidadesDelGml } from "./gml.ts";
import { ficheroDeMunicipios, limitesDelIgn } from "./municipios.ts";
import {
  FUENTE_DE_PRUEBA,
  GML_PROVINCIAS_DE_PRUEBA,
  gmlDe,
  rectangulo,
  type UnidadDePrueba,
} from "./pruebas.ts";

/** Un municipio de prueba de Barcelona (08) o de Burgos (09). */
const municipio = (
  codigo: string,
  nombre: string,
  ...poligonos: UnidadDePrueba["poligonos"]
): UnidadDePrueba => ({
  codigoNacional: `340${codigo.startsWith("09") ? "7" : "9"}${codigo.slice(0, 2)}${codigo}`,
  nombre,
  poligonos,
});

// Gran rodea el punto de la capital de Enclavat, que tiene su recinto aparte. La capital de Veí se
// llama Gran, como Gatika tiene la suya en Garai, pero Gran ya tiene la suya. En Burgos hay otro
// Enclavat, que no le quita la capital al de Barcelona.
const LIMITES = Result.getOrThrow(
  limitesDelIgn(
    Result.getOrThrow(
      unidadesDelGml(
        gmlDe([
          municipio("08001", "Gran", [rectangulo(2, 41, 2.1, 41.1)]),
          municipio("08002", "Enclavat", [rectangulo(2.2, 41, 2.21, 41.01)]),
          municipio("08003", "Veí/Vecino", [rectangulo(2.1, 41, 2.2, 41.1)]),
          municipio("09001", "Enclavat/Enclavado", [rectangulo(-3, 42, -2.9, 42.1)]),
        ]),
      ),
    ),
    Result.getOrThrow(unidadesDelGml(GML_PROVINCIAS_DE_PRUEBA)),
    FUENTE_DE_PRUEBA,
  ),
);
const INDICE = indexarMunicipios(LIMITES);

const capital = (
  nombres: ReadonlyArray<string>,
  longitud: number,
  latitud: number,
  desde = "2023-06-29",
): CapitalDelNgbe => ({ nombres, posicion: { longitud, latitud }, desde });

const CAPITALES: ReadonlyArray<CapitalDelNgbe> = [
  capital(["Gran"], 2.02, 41.02),
  capital(["Enclavat"], 2.05, 41.05, "2026-05-28"),
  capital(["Gran", "Grande"], 2.15, 41.05),
  capital(["Enclavado"], -2.95, 42.05),
];

/** Una página del WFS del NGBE con estas capitales, con lo que se lee de ella. */
const paginaDe = (capitales: ReadonlyArray<CapitalDelNgbe>, tipo = "Capital de municipio") =>
  [
    "<?xml version='1.0' encoding='UTF-8'?>",
    `<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" numberMatched="unknown" numberReturned="${capitales.length}" timeStamp="2026-10-06T00:19:20Z">`,
    ...capitales.map((c, i) =>
      [
        "<wfs:member>",
        `<gn:NamedPlace gml:id="ES.IGN.NGBE.${i}">`,
        `<gn:beginLifespanVersion>${c.desde}T00:00:00</gn:beginLifespanVersion>`,
        `<gn:geometry><gml:Point gml:id="P${i}" srsName="http://www.opengis.net/def/crs/EPSG/0/4258">`,
        `<gml:pos>${c.posicion.latitud.toFixed(6)} ${c.posicion.longitud.toFixed(6)}</gml:pos>`,
        "</gml:Point></gn:geometry>",
        `<gn:inspireId><base:Identifier><base:localId>${i}</base:localId></base:Identifier></gn:inspireId>`,
        `<gn:localType><gmd:LocalisedCharacterString locale="es-ES">${tipo}</gmd:LocalisedCharacterString></gn:localType>`,
        ...c.nombres.map(
          (nombre) =>
            `<gn:name><gn:GeographicalName><gn:spelling><gn:SpellingOfName><gn:text>${nombre.replaceAll("&", "&amp;")}</gn:text></gn:SpellingOfName></gn:spelling></gn:GeographicalName></gn:name>`,
        ),
        "</gn:NamedPlace>",
        "</wfs:member>",
      ].join("\n"),
    ),
    "</wfs:FeatureCollection>",
  ].join("\n");

const capacidadesDe = (licencia = "CC BY 4.0 ign.es") =>
  [
    '<wfs:WFS_Capabilities version="2.0.0">',
    "<ows:ServiceIdentification>",
    "<ows:Title>Nomenclátor Geográfico Básico de España</ows:Title>",
    `<ows:Fees>No se aplican condiciones</ows:Fees><ows:AccessConstraints>${licencia}</ows:AccessConstraints>`,
    "</ows:ServiceIdentification>",
    "<ows:OperationsMetadata><ows:Title>Otra cosa</ows:Title></ows:OperationsMetadata>",
    "</wfs:WFS_Capabilities>",
  ].join("\n");

describe("capitales del NGBE", () => {
  it("lee de cada lugar sus nombres, su punto, con la latitud primero, y su fecha", () => {
    assert.deepStrictEqual(capitalesDelWfs(paginaDe(CAPITALES)), Result.succeed(CAPITALES));
    const conAmpersand = capitalesDelWfs(paginaDe([capital(["Sant Joan & Sant Pau"], 2, 41)]));
    assert.deepStrictEqual(
      Result.map(conAmpersand, (leidas) => leidas.map((c) => c.nombres)),
      Result.succeed([["Sant Joan & Sant Pau"]]),
    );
  });

  it("falla si un lugar no es una capital o si no trae tantos como anuncia", () => {
    assert.isTrue(Result.isFailure(capitalesDelWfs(paginaDe(CAPITALES, "Entidad singular"))));
    const corta = paginaDe(CAPITALES).replace('numberReturned="4"', 'numberReturned="5"');
    assert.isTrue(Result.isFailure(capitalesDelWfs(corta)));
  });

  it("lee de las capacidades el título y la licencia del servicio", () => {
    assert.deepStrictEqual(
      leerCapacidades(capacidadesDe()),
      Result.succeed({
        producto: "Nomenclátor Geográfico Básico de España",
        licencia: "CC BY 4.0 ign.es",
      }),
    );
    assert.isTrue(Result.isFailure(leerCapacidades("<ows:Title>Otro</ows:Title>")));
  });

  it("pide las capitales por páginas, con el filtro de capital de municipio", () => {
    const url = new URL(paginaDeCapitales(2000));
    assert.strictEqual(url.origin + url.pathname, "https://www.ign.es/wfs-inspire/ngbe");
    assert.strictEqual(url.searchParams.get("startIndex"), "2000");
    assert.strictEqual(url.searchParams.get("count"), String(POR_PAGINA));
    assert.include(
      url.searchParams.get("filter"),
      "<fes:Literal>Capital de municipio</fes:Literal>",
    );
  });
});

describe("cada capital a su municipio", () => {
  it("por su punto o, si se llama como otro de su provincia sin capital, a ese otro", () => {
    const asignadas = asignarCapitales(CAPITALES, INDICE);
    if (Result.isFailure(asignadas)) return assert.fail(asignadas.failure.motivo);
    assert.deepStrictEqual(
      asignadas.success.capitales.map((c) => [c.codigo, c.nombre]),
      [
        ["08001", "Gran"],
        ["08002", "Enclavat"],
        ["08003", "Gran / Grande"],
        ["09001", "Enclavado"],
      ],
    );
    assert.deepStrictEqual(asignadas.success.capitales[1]?.posicion, {
      longitud: 2.05,
      latitud: 41.05,
    });
    assert.deepStrictEqual(asignadas.success.porNombre, [
      { capital: "Enclavat", delPunto: "08001", municipio: "08002" },
    ]);
  });

  it("falla si un municipio se queda sin capital o con dos, o si una cae fuera de todos", () => {
    const motivo = (capitales: ReadonlyArray<CapitalDelNgbe>) =>
      Result.match(asignarCapitales(capitales, INDICE), {
        onSuccess: () => "",
        onFailure: (error) => error.motivo,
      });
    assert.include(motivo(CAPITALES.slice(1)), "1 municipios sin capital (08001 Gran)");
    assert.include(
      motivo([...CAPITALES, capital(["Otra"], 2.03, 41.03)]),
      "1 municipios con varias (08001: Gran, Otra)",
    );
    assert.include(
      motivo([...CAPITALES, capital(["En el mar"], 3, 40)]),
      "1 capitales fuera de todo municipio (En el mar)",
    );
  });
});

/**
 * La orden con el servicio de prueba, en una carpeta temporal. Devuelve cómo acabó, las
 * peticiones y lo que quedó escrito.
 */
const descargar = (paginas: ReadonlyArray<string>, licencia?: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const carpeta = yield* fs.makeTempDirectoryScoped();
    const opciones = {
      municipios: `${carpeta}/municipios.json`,
      capitales: `${carpeta}/capitales.json`,
      pausa: Duration.zero,
    };
    yield* fs.writeFileString(opciones.municipios, ficheroDeMunicipios(LIMITES));
    const responder = (url: URL): Respuesta => {
      if (url.pathname === "/robots.txt") return NO_HAY_ROBOTS;
      if (url.href === CAPACIDADES_NGBE) return { estado: 200, cuerpo: capacidadesDe(licencia) };
      const inicio = Number(url.searchParams.get("startIndex"));
      const pagina = paginas[inicio / POR_PAGINA];
      return pagina === undefined ? { estado: 404, cuerpo: "" } : { estado: 200, cuerpo: pagina };
    };
    const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
    const salida = yield* Effect.result(
      descargarCapitales(opciones).pipe(Effect.provide(clienteDePrueba(peticiones, responder))),
    );
    return {
      salida,
      rutas: (yield* Ref.get(peticiones)).map((p) => new URL(p.ruta, "https://www.ign.es")),
      escrito: yield* fs
        .readFileString(opciones.capitales)
        .pipe(Effect.orElseSucceed(() => undefined)),
    };
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const decodificarCapitales = Schema.decodeSync(Schema.fromJsonString(CapitalesDeMunicipios));

describe("orden capitales", () => {
  it.effect("comprueba la licencia, descarga, asigna y guarda las capitales con su fuente", () =>
    Effect.gen(function* () {
      const { salida, rutas, escrito } = yield* descargar([paginaDe(CAPITALES)]);
      assert.isTrue(Result.isSuccess(salida));
      assert.deepStrictEqual(
        rutas.map((url) => url.searchParams.get("request") ?? url.pathname),
        ["/robots.txt", "GetCapabilities", "GetFeature"],
      );
      const guardadas = decodificarCapitales(escrito ?? "");
      assert.deepStrictEqual(guardadas.fuente, {
        atribucion: "Instituto Geográfico Nacional",
        producto: "Nomenclátor Geográfico Básico de España",
        licencia: "CC BY 4.0",
        enlace: CAPACIDADES_NGBE,
        fecha: "2026-05-28",
      });
      assert.deepStrictEqual(
        guardadas.capitales.map((c) => c.codigo),
        ["08001", "08002", "08003", "09001"],
      );
      // Una capital por línea, para que un cambio se lea en un diff.
      assert.lengthOf(escrito?.split("\n") ?? [], CAPITALES.length + 3);
    }),
  );

  it.effect("pide la página siguiente mientras vengan llenas, y no escribe si no cuadran", () =>
    Effect.gen(function* () {
      const llena = paginaDe(
        Array.from({ length: POR_PAGINA }, () => capital(["Gran"], 2.02, 41.02)),
      );
      const { salida, rutas, escrito } = yield* descargar([llena, paginaDe([])]);
      assert.deepStrictEqual(
        Result.isFailure(salida) ? salida.failure._tag : undefined,
        "CapitalesDescuadradas",
      );
      assert.deepStrictEqual(
        rutas.map((url) => url.searchParams.get("startIndex")).filter((inicio) => inicio !== null),
        ["0", String(POR_PAGINA)],
      );
      assert.isUndefined(escrito);
    }),
  );

  it.effect("si la licencia del servicio cambia, no descarga ninguna capital", () =>
    Effect.gen(function* () {
      const { salida, rutas, escrito } = yield* descargar([paginaDe(CAPITALES)], "Uso restringido");
      assert.deepStrictEqual(
        Result.isFailure(salida) ? salida.failure._tag : undefined,
        "FuenteDeMunicipiosCambiada",
      );
      assert.notInclude(
        rutas.map((url) => url.searchParams.get("request")),
        "GetFeature",
      );
      assert.isUndefined(escrito);
    }),
  );
});
