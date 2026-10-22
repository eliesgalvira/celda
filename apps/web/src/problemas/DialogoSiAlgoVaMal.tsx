import { Boton, Enlace } from "@celda/ui/Boton.tsx";
import { Desplegable } from "@celda/ui/Desplegable.tsx";
import { Dialogo } from "@celda/ui/Dialogo.tsx";
import { Nota, Paso, Pasos, Puntos } from "@celda/ui/medir/Medir.tsx";
import { Termino } from "@celda/ui/termino/Termino.tsx";
import type { JSX } from "@solidjs/web";

/**
 * Las páginas oficiales a las que lleva el panel, todas de la investigación 09
 * (`docs/investigacion/reclamaciones-y-exposicion.md`), leídas el 20/10/2026.
 */
export const PAGINAS = {
  oficina: {
    texto: "Reclamar en la Oficina",
    enlace: "https://usuariosteleco.digital.gob.es/reclamaciones/telefonia-e-internet",
  },
  arbitraje: {
    texto: "Arbitraje de consumo",
    enlace:
      "https://www.dsca.gob.es/es/consumo/como-reclamar-conflicto-consumo/sistema-arbitral-consumo",
  },
  movil: {
    texto: "La cobertura, según la Oficina",
    enlace: "https://usuariosteleco.digital.gob.es/derechos-usuario/telefonia-movil",
  },
  llega700: { texto: "Web de Llega700", enlace: "https://www.llega700.es/" },
  ministerioTelevision: {
    texto: "Reclamar al ministerio",
    enlace: "https://television.digital.gob.es/2DD-5G/gestion-reclamaciones-5g",
  },
  interferencias: {
    texto: "Servicio Interferencias",
    enlace:
      "https://digital.gob.es/ministerio/servicios-a-la-ciudadania/procedimientos-y-servicios/telecomunicaciones-e-infraestructuras-digitales/espectro-radioelectrico/servicio_interferencias",
  },
  jefaturas: {
    texto: "Jefaturas provinciales",
    enlace:
      "https://digital.gob.es/telecomunicaciones-infraestructuras-digitales/jefaturas-provinciales/contacto",
  },
  urbanismo: {
    texto: "Preguntas frecuentes del ministerio",
    enlace:
      "https://digital.gob.es/telecomunicaciones-infraestructuras-digitales/areas-interes/urbanismo-despliegue-redes/Preguntas_Frecuentes",
  },
  medidaDeExposicion: {
    texto: "Pedir una medida",
    enlace:
      "https://digital.gob.es/ministerio/servicios-a-la-ciudadania/procedimientos-y-servicios/telecomunicaciones-e-infraestructuras-digitales/espectro-radioelectrico/servicio_medida_niveles_emision_radioelectrica",
  },
} as const;

/** Un enlace a una página oficial, que se abre aparte. */
function EnlaceOficial(props: { readonly pagina: keyof typeof PAGINAS }) {
  return (
    <Enlace variante="enlace" href={PAGINAS[props.pagina].enlace} target="_blank" rel="noreferrer">
      {PAGINAS[props.pagina].texto}
    </Enlace>
  );
}

/** Lo que conviene guardar en un caso. */
function QueGuardar(props: { readonly children: JSX.Element }) {
  return (
    <Nota titulo="Qué conviene guardar">
      <Puntos>{props.children}</Puntos>
    </Nota>
  );
}

export interface DialogoSiAlgoVaMalProps {
  readonly alCerrar: () => void;
  /** Abre «Medir mi señal» encima de este panel. */
  readonly alMedir: () => void;
}

/**
 * «Si algo va mal» (#87): para seis problemas, a quién se acude, en qué orden, con qué plazos y
 * qué conviene guardar, con las páginas oficiales. No tiene formularios ni envía nada. Afirma solo
 * lo que la investigación 09 comprobó en una fuente primaria, y lo que no está claro lo dice así.
 */
export function DialogoSiAlgoVaMal(props: DialogoSiAlgoVaMalProps) {
  const medir = () => (
    <div>
      <Boton variante="enlace" aria-haspopup="dialog" onClick={() => props.alMedir()}>
        Medir mi señal
      </Boton>
    </div>
  );
  return (
    <Dialogo titulo="Si algo va mal" antetitulo="A QUIÉN ACUDIR" alCerrar={props.alCerrar}>
      <Desplegable
        titulo="No tienes cobertura en casa o se te cortan las llamadas"
        variante="recuadro"
      >
        <p>
          En el móvil no hay obligación de cobertura universal, y lo normal es que no se pueda
          obligar a una compañía a dar cobertura en un sitio concreto. Sí puedes reclamar un corte
          del servicio, una oferta que no se cumple o una diferencia clara con lo que dice tu
          contrato.
        </p>
        <Pasos>
          <Paso numero={1} titulo="Reclama a tu compañía en el plazo de un mes">
            <p>
              El mes cuenta desde que te das cuenta del problema. Su atención al cliente es gratuita
              y tiene que aceptar la reclamación por teléfono. Pide el número de referencia. Si
              pides un justificante por escrito, te lo tienen que mandar en diez días.
            </p>
          </Paso>
          <Paso
            numero={2}
            titulo="Si no contesta en un mes o no te convence, reclama en la Oficina de Atención al Usuario de Telecomunicaciones"
            acciones={
              <>
                <EnlaceOficial pagina="oficina" />
                <EnlaceOficial pagina="arbitraje" />
              </>
            }
          >
            <p>
              Tienes tres meses desde la respuesta, o desde que acabó el mes sin ella. Se reclama
              por internet, con certificado electrónico o Cl@ve, o en papel. La Oficina tiene seis
              meses para resolver, y lo que resuelve obliga a la compañía.
            </p>
            <p>
              En lugar de la Oficina, puedes ir a una Junta Arbitral de Consumo si la compañía está
              adherida al arbitraje. Si la Junta abre el arbitraje, ya no puedes ir a la Oficina.
            </p>
          </Paso>
        </Pasos>
        <QueGuardar>
          <li>El número de referencia de tu reclamación a la compañía.</li>
          <li>El contrato y la oferta, si prometían algo de cobertura o de calidad.</li>
          <li>Las facturas.</li>
          <li>Las fechas, las horas y los sitios en que falla.</li>
          <li>
            Capturas del <Termino termino="modo-de-informacion">modo de información</Termino> con la
            fecha. La Oficina admite toda la documentación que consideres relevante, aunque ninguna
            norma reconoce una medida propia como prueba.
          </li>
        </QueGuardar>
        {medir()}
      </Desplegable>

      <Desplegable titulo="Todo el barrio va mal con la misma compañía" variante="recuadro">
        <Pasos>
          <Paso
            numero={1}
            titulo="Cada cliente reclama a la compañía y, si hace falta, a la Oficina"
          >
            <p>
              La Oficina de Atención al Usuario atiende reclamaciones de personas, autónomos y
              microempresas. Los plazos son los de cuando falla en casa: un mes para reclamar a la
              compañía y, si no contesta en un mes o no convence, tres meses más para ir a la
              Oficina.
            </p>
          </Paso>
          <Paso
            numero={2}
            titulo="Pide al ayuntamiento que hable con la compañía"
            acciones={<EnlaceOficial pagina="movil" />}
          >
            <p>
              Para las zonas sin cobertura, a veces los ayuntamientos, las diputaciones o las
              comunidades autónomas firman convenios con las compañías.
            </p>
          </Paso>
        </Pasos>
        <p>
          Si es un corte del servicio, la compañía tiene que compensarte sin que se lo pidas: en las
          llamadas, si la compensación pasa de 1 euro, y en internet, si el corte dura más de seis
          horas entre las 8:00 y las 22:00. En un corte del móvil, para cobrarla puedes declarar, en
          los 10 días siguientes a que vuelva el servicio, que estabas en la zona afectada. No está
          claro que una mala cobertura dentro de casa cuente como corte.
        </p>
        <QueGuardar>
          <li>El número de referencia de cada reclamación.</li>
          <li>En un corte, el día y la hora en que volvió el servicio.</li>
          <li>
            Capturas del <Termino termino="modo-de-informacion">modo de información</Termino> de
            varias personas en varios sitios, con la fecha. Enseñan hasta dónde llega el problema,
            aunque ninguna norma las prevé.
          </li>
        </QueGuardar>
        {medir()}
      </Desplegable>

      <Desplegable titulo="La tele se ve mal desde que hay 4G o 5G cerca" variante="recuadro">
        <p>
          Las compañías que emiten en las <Termino termino="banda">bandas</Termino> de 700 y 800 MHz
          tienen que arreglar a su costa la televisión que estropeen. Lo hacen a través de Llega700.
        </p>
        <Pasos>
          <Paso
            numero={1}
            titulo="Llama a Llega700 en los seis meses siguientes"
            acciones={<EnlaceOficial pagina="llega700" />}
          >
            <p>
              El plazo cuenta desde que la <Termino termino="estacion-base">estación base</Termino>{" "}
              empezó a emitir o cambió. Llama gratis al 900 833 999, de lunes a sábado de 9:00 a
              22:00, o usa el formulario de su web. Tienen 5 días hábiles para resolverlo, y no te
              cobran nada.
            </p>
          </Paso>
          <Paso
            numero={2}
            titulo="Si Llega700 no lo arregla en un mes, reclama al ministerio en los tres meses siguientes"
            acciones={<EnlaceOficial pagina="ministerioTelevision" />}
          />
        </Pasos>
        <p>
          Pasados los seis meses, o con otras bandas, la compañía sigue obligada a corregir la
          interferencia a su costa. No está claro a quién se acude entonces. Lo más probable es que
          sea la Jefatura Provincial de Inspección de Telecomunicaciones, por el Servicio
          Interferencias.
        </p>
        <QueGuardar>
          <li>La dirección.</li>
          <li>Los canales que fallan.</li>
          <li>Desde cuándo fallan.</li>
          <li>
            Desde cuándo publica el <Termino termino="registro-oficial">registro oficial</Termino>{" "}
            el emplazamiento de al lado con la banda de 700 u 800 MHz. En Celda lo dice su ficha. Es
            la fecha del registro y no la de la puesta en servicio, así que solo orienta sobre el
            plazo.
          </li>
        </QueGuardar>
      </Desplegable>

      <Desplegable
        titulo="Un aparato interfiere, como un repetidor comprado por internet"
        variante="recuadro"
      >
        <p>
          Un repetidor de cobertura solo se puede instalar con autorización de la compañía, porque
          emite en sus <Termino termino="banda">bandas</Termino>. Causar interferencias es una
          infracción grave o muy grave.
        </p>
        <Pasos>
          <Paso
            numero={1}
            titulo="Comunícalo a la Jefatura Provincial de Inspección de Telecomunicaciones"
            acciones={
              <>
                <EnlaceOficial pagina="interferencias" />
                <EnlaceOficial pagina="jefaturas" />
              </>
            }
          >
            <p>
              Se hace por el Servicio Interferencias, por internet con certificado electrónico o
              Cl@ve y su formulario firmado, o por escrito. Lo atiende la Jefatura de la provincia
              donde pasa. No está claro que actúe a petición de un particular.
            </p>
          </Paso>
          <Paso numero={2} titulo="Avisa también a tu compañía">
            <p>El derecho a que la protejan de interferencias es de la compañía.</p>
          </Paso>
        </Pasos>
        <QueGuardar>
          <li>Qué falla, como el móvil o la televisión.</li>
          <li>El canal o la frecuencia, si los sabes.</li>
          <li>El sitio, y las fechas y horas en que pasa.</li>
          <li>Cómo se nota, como llamadas que se cortan o una imagen que se pixela.</li>
          <li>
            Capturas del <Termino termino="modo-de-informacion">modo de información</Termino> de
            antes y de después, con fecha y hora.
          </li>
        </QueGuardar>
        {medir()}
      </Desplegable>

      <Desplegable titulo="Han montado un emplazamiento sin licencia municipal" variante="recuadro">
        <p>
          Muchos no la necesitan. En un edificio o un terreno privado, el ayuntamiento solo puede
          pedir licencia en casos concretos, como un bien de interés cultural o una instalación de
          más de 300 m². En los demás basta una declaración responsable de la compañía, y sin ella
          el <Termino termino="emplazamiento">emplazamiento</Termino> no puede funcionar y hay que
          retirarlo. Añadir equipos, bandas o tecnologías, como el 5G, a un mástil que ya estaba no
          necesita nada.
        </p>
        <Pasos>
          <Paso
            numero={1}
            titulo="Pregunta al ayuntamiento"
            acciones={<EnlaceOficial pagina="urbanismo" />}
          >
            <p>
              Se encarga del urbanismo, y cualquiera puede pedirle que actúe. Pregunta si la
              compañía presentó la licencia o la declaración responsable. El trámite depende de cada
              comunidad autónoma.
            </p>
          </Paso>
        </Pasos>
        <p>
          Si el emplazamiento sale en el{" "}
          <Termino termino="registro-oficial">registro oficial</Termino>, tiene autorización del
          ministerio, porque el registro solo publica estaciones autorizadas. Esa autorización no
          incluye la del ayuntamiento. Si funciona y no sale en el registro, puede que el registro
          aún no lo haya publicado o que le falte la autorización del ministerio, y eso sería asunto
          de la Jefatura Provincial de Inspección de Telecomunicaciones.
        </p>
        <QueGuardar>
          <li>La dirección.</li>
          <li>Fotos.</li>
          <li>La fecha en que apareció.</li>
          <li>Desde cuándo lo publica el registro. En Celda lo dice su ficha.</li>
        </QueGuardar>
      </Desplegable>

      <Desplegable titulo="Te preocupa la exposición cerca de un colegio" variante="recuadro">
        <p>
          Los límites de exposición son los mismos en toda España, y cerca de un colegio no hay uno
          distinto ni una distancia mínima. Ni el ayuntamiento ni la comunidad autónoma pueden poner
          otros. Si hay un colegio, una guardería, un centro de salud o un parque a menos de 100 m
          de una estación urbana de más de 1 W, la norma pide a la compañía reducir al mínimo la
          exposición sobre ellos y medirla allí en su certificación de cada año.
        </p>
        <Pasos>
          <Paso
            numero={1}
            titulo="Pide una medida a la Jefatura Provincial de Inspección de Telecomunicaciones"
            acciones={
              <>
                <EnlaceOficial pagina="medidaDeExposicion" />
                <EnlaceOficial pagina="jefaturas" />
              </>
            }
          >
            <p>
              Cualquiera puede pedirla por el Servicio para medida de Niveles de Emisión
              Radioeléctrica. Su plantilla pregunta qué tipo de sitio es, como un domicilio, un
              parque o un colegio. No se publica el plazo ni si cuesta algo.
            </p>
          </Paso>
        </Pasos>
        <QueGuardar>
          <li>La dirección del colegio.</li>
          <li>
            Las medidas de exposición del ministerio alrededor de cada{" "}
            <Termino termino="emplazamiento">emplazamiento</Termino> cercano. En Celda las enseña su
            ficha.
          </li>
        </QueGuardar>
      </Desplegable>

      <p>Sale de las normas y las páginas oficiales tal como estaban el 20 oct 2026.</p>
    </Dialogo>
  );
}
