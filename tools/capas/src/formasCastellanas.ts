/**
 * La forma castellana de cada nombre oficial bilingüe del IGN, por código INE: las cuatro
 * provincias y los 130 municipios que el IGN escribe «A/B» (ADR 0025). Ningún dato oficial dice
 * cuál de las dos es la castellana, así que va a mano. El usuario la aprobó el 03/10/2026 en el
 * prototipo (`prototipo/mapa-base-ign`, 54f3339). Al lado va el oficial, para leerla.
 *
 * `pnpm run nombres` falla si un oficial bilingüe no está aquí, si la forma no es una de sus dos
 * partes o si sobra alguna: entonces hay que decidirla y añadirla, o quitarla.
 */
export const FORMAS_CASTELLANAS: ReadonlyMap<string, string> = new Map([
  ["01", "Álava"], // Araba/Álava
  ["03", "Alicante"], // Alacant/Alicante
  ["12", "Castellón"], // Castelló/Castellón
  ["46", "Valencia"], // València/Valencia
  ["01010", "Ayala"], // Ayala/Aiara
  ["01011", "Baños de Ebro"], // Baños de Ebro/Mañueta
  ["01017", "Campezo"], // Campezo/Kanpezu
  ["01021", "Elburgo"], // Elburgo/Burgelu
  ["01023", "Elvillar"], // Elvillar/Bilar
  ["01028", "Labastida"], // Labastida/Bastida
  ["01032", "Lanciego"], // Lanciego/Lantziego
  ["01036", "Llodio"], // Laudio/Llodio
  ["01039", "Moreda de Álava"], // Moreda de Álava/Moreda Araba
  ["01046", "Ribera Alta"], // Erriberagoitia/Ribera Alta
  ["01047", "Ribera Baja"], // Ribera Baja/Erriberabeitia
  ["01051", "Salvatierra"], // Agurain/Salvatierra
  ["01053", "San Millán"], // San Millán/Donemiliaga
  ["01055", "Valdegovía"], // Valdegovía/Gaubea
  ["01056", "Valle de Arana"], // Harana/Valle de Arana
  ["01057", "Villabuena de Álava"], // Villabuena de Álava/Eskuernaga
  ["01060", "Yécora"], // Yécora/Iekora
  ["01901", "Iruña de Oca"], // Iruña Oka/Iruña de Oca
  ["03009", "Alcoy"], // Alcoi/Alcoy
  ["03014", "Alicante"], // Alacant/Alicante
  ["03042", "Benitachell"], // el Poble Nou de Benitatxell/Benitachell
  ["03051", "Campo de Mirra"], // el Camp de Mirra/Campo de Mirra
  ["03065", "Elche"], // Elx/Elche
  ["03077", "Hondón de las Nieves"], // el Fondó de les Neus/Hondón de las Nieves
  ["03082", "Jávea"], // Xàbia/Jávea
  ["03083", "Jijona"], // Xixona/Jijona
  ["03084", "Lorcha"], // l'Orxa/Lorcha
  ["03089", "Monóvar"], // Monòver/Monóvar
  ["03105", "Pinoso"], // el Pinós/Pinoso
  ["03122", "San Vicente del Raspeig"], // Sant Vicent del Raspeig/San Vicente del Raspeig
  ["03132", "Torremanzanas"], // la Torre de les Maçanes/Torremanzanas
  ["03139", "Villajoyosa"], // la Vila Joiosa/Villajoyosa
  ["12028", "Benicasim"], // Benicàssim/Benicasim
  ["12032", "Burriana"], // Borriana/Burriana
  ["12040", "Castellón de la Plana"], // Castelló de la Plana/Castellón de la Plana
  ["12053", "Chilches"], // Chilches/Xilxes
  ["12055", "Chodos"], // Xodos/Chodos
  ["12072", "Lucena del Cid"], // Llucena/Lucena del Cid
  ["12085", "Oropesa del Mar"], // Orpesa/Oropesa del Mar
  ["12089", "Peñíscola"], // Peníscola/Peñíscola
  ["12099", "San Jorge"], // Sant Jordi/San Jorge
  ["12108", "Sueras"], // Suera/Sueras
  ["12122", "Useras"], // les Useres/Useras
  ["12129", "Villafranca del Cid"], // Vilafranca/Villafranca del Cid
  ["12901", "Alquerías del Niño Perdido"], // les Alqueries/Alquerías del Niño Perdido
  ["20055", "Mondragón"], // Arrasate/Mondragón
  ["20069", "San Sebastián"], // Donostia/San Sebastián
  ["31002", "Abárzuza"], // Abárzuza/Abartzuza
  ["31003", "Abaurrea Alta"], // Abaurregaina/Abaurrea Alta
  ["31004", "Abaurrea Baja"], // Abaurrepea/Abaurrea Baja
  ["31009", "Aibar"], // Aibar/Oibar
  ["31010", "Alsasua"], // Altsasu/Alsasua
  ["31011", "Allín"], // Allín/Allin
  ["31014", "Ancín"], // Ancín/Antzin
  ["31016", "Ansoáin"], // Ansoáin/Antsoain
  ["31019", "Aoiz"], // Aoiz/Agoitz
  ["31021", "Aranarache"], // Aranarache/Aranaratxe
  ["31028", "Arce"], // Arce/Artzi
  ["31041", "Ayegui"], // Ayegui/Aiegi
  ["31058", "Burguete"], // Auritz/Burguete
  ["31059", "Burgui"], // Burgui/Burgi
  ["31060", "Burlada"], // Burlada/Burlata
  ["31071", "Castillonuevo"], // Castillonuevo/Gazteluberri
  ["31074", "Cirauqui"], // Cirauqui/Zirauki
  ["31075", "Ciriza"], // Ciriza/Ziritza
  ["31083", "Echarri"], // Echarri/Etxarri
  ["31086", "Valle de Egüés"], // Valle de Egüés/Eguesibar
  ["31088", "Valle de Elorz"], // Valle de Elorz/Elortzibar
  ["31089", "Enériz"], // Enériz/Eneritz
  ["31093", "Ezcároz"], // Ezcároz/Ezkaroze
  ["31095", "Esparza de Salazar"], // Esparza de Salazar/Espartza Zaraitzu
  ["31110", "Gallipienzo"], // Gallipienzo/Galipentzu
  ["31111", "Gallués"], // Gallués/Galoze
  ["31118", "Val de Goñi"], // Val de Goñi/Goñerri
  ["31119", "Güesa"], // Güesa/Gorza
  ["31120", "Guesálaz"], // Guesálaz/Gesalatz
  ["31122", "Huarte"], // Huarte/Uharte
  ["31128", "Isaba"], // Isaba/Izaba
  ["31131", "Iza"], // Iza/Itza
  ["31133", "Izalzu"], // Izalzu/Itzaltzu
  ["31136", "Juslapeña"], // Juslapeña/Txulapain
  ["31146", "Leache"], // Leache/Leatxe
  ["31150", "Leoz"], // Leoz/Leotz
  ["31156", "Lizoain-Arriasgoiti"], // Lizoain-Arriasgoiti/Lizoainibar-Arriasgoiti
  ["31158", "Lónguida"], // Lónguida/Longida
  ["31172", "Monreal"], // Monreal/Elo
  ["31181", "Navascués"], // Navascués/Nabaskoze
  ["31185", "Ochagavía"], // Ochagavía/Otsagabia
  ["31189", "Olazagutía"], // Olazti/Olazagutía
  ["31191", "Olite"], // Olite/Erriberri
  ["31192", "Olóriz"], // Olóriz/Oloritz
  ["31193", "Cendea de Olza"], // Cendea de Olza/Oltza Zendea
  ["31194", "Valle de Ollo"], // Valle de Ollo/Ollaran
  ["31198", "Oronz"], // Oronz/Orontze
  ["31199", "Oroz-Betelu"], // Oroz-Betelu/Orotz-Betelu
  ["31201", "Pamplona"], // Pamplona/Iruña
  ["31202", "Peralta"], // Peralta/Azkoien
  ["31206", "Puente la Reina"], // Puente la Reina/Gares
  ["31207", "Pueyo"], // Pueyo/Puiu
  ["31209", "Romanzado"], // Romanzado/Erromantzatua
  ["31210", "Roncal"], // Roncal/Erronkari
  ["31211", "Roncesvalles"], // Orreaga/Roncesvalles
  ["31214", "Salinas de Oro"], // Salinas de Oro/Jaitz
  ["31216", "Sangüesa"], // Sangüesa/Zangoza
  ["31221", "Santesteban"], // Doneztebe/Santesteban
  ["31222", "Sarriés"], // Sarriés/Sartze
  ["31235", "Ujué"], // Ujué/Uxue
  ["31238", "Unzué"], // Unzué/Untzue
  ["31239", "Urdax"], // Urdazubi/Urdax
  ["31245", "Urzainqui"], // Urzainqui/Urzainki
  ["31247", "Uztárroz"], // Uztárroz/Uztarroze
  ["31248", "Valcarlos"], // Luzaide/Valcarlos
  ["31252", "Vidángoz"], // Vidángoz/Bidankoze
  ["31256", "Villanueva de Aezkoa"], // Hiriberri/Villanueva de Aezkoa
  ["31258", "Villava"], // Villava/Atarrabia
  ["31260", "Valle de Yerri"], // Valle de Yerri/Deierri
  ["31262", "Zabalza"], // Zabalza/Zabaltza
  ["31901", "Barañáin"], // Barañáin/Barañain
  ["31902", "Berrioplano"], // Berrioplano/Berriobeiti
  ["31907", "Zizur Mayor"], // Zizur Mayor/Zizur Nagusia
  ["46013", "Alboraya"], // Alboraia/Alboraya
  ["46170", "Mogente"], // Moixent/Mogente
  ["46171", "Moncada"], // Montcada/Moncada
  ["46175", "Montichelvo"], // Montitxelvo/Montichelvo
  ["46176", "Montroy"], // Montroi/Montroy
  ["46178", "Náquera"], // Nàquera/Náquera
  ["46220", "Sagunto"], // Sagunt/Sagunto
  ["46255", "Villalonga"], // Vilallonga/Villalonga
  ["48022", "Valle de Carranza"], // Karrantza Harana/Valle de Carranza
  ["48074", "Orduña"], // Urduña/Orduña
]);
