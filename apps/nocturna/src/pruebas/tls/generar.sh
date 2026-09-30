#!/usr/bin/env bash
# Certificados de prueba de conexionDelRegistro.test.ts, como la cadena del geoportal: una raíz,
# un intermedio y una hoja para localhost firmada por el intermedio. Y otra hoja para localhost de
# otra autoridad, firmada por otro intermedio. Son de la prueba: no protegen nada y duran cien
# años. Se lanza desde esta carpeta; guarda las claves de las hojas y ningún otro secreto.
set -euo pipefail

dias=36500
ec=(-newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes)
trabajo=$(mktemp -d)
trap 'rm -rf "$trabajo"' EXIT

# raiz <nombre> <asunto>
raiz() {
  openssl req -x509 "${ec[@]}" -subj "$2" -days "$dias" \
    -keyout "$trabajo/$1.key" -out "$1.pem" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
}

# firmar <nombre> <asunto> <emisor> <extensiones>: la clave del emisor está en el directorio de trabajo.
firmar() {
  openssl req "${ec[@]}" -subj "$2" -keyout "$trabajo/$1.key" -out "$trabajo/$1.csr"
  printf '%b' "$4" > "$trabajo/$1.ext"
  openssl x509 -req -in "$trabajo/$1.csr" -CA "$3.pem" -CAkey "$trabajo/$3.key" \
    -set_serial "0x$(openssl rand -hex 8)" -days "$dias" -extfile "$trabajo/$1.ext" -out "$1.pem"
}

intermedio='basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n'
hoja='basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nauthorityKeyIdentifier=keyid\n'

raiz raiz "/C=ES/O=Celda/OU=Raiz de prueba"
firmar intermedio "/C=ES/O=Celda/OU=Intermedio de prueba" raiz "$intermedio"
firmar hoja "/CN=localhost" intermedio "$hoja"
cp "$trabajo/hoja.key" hoja.key

raiz otra-raiz "/C=ES/O=Otra/OU=Otra raiz de prueba"
firmar otro-intermedio "/C=ES/O=Otra/OU=Otro intermedio de prueba" otra-raiz "$intermedio"
firmar otra-hoja "/CN=localhost" otro-intermedio "$hoja"
cp "$trabajo/otra-hoja.key" otra-hoja.key
rm otra-raiz.pem otro-intermedio.pem
