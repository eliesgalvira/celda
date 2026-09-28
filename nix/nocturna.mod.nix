{
  perSystem =
    { lib, pkgs, ... }:
    let
      inherit (lib.fileset) fileFilter toSource unions;
      inherit (lib.meta) getExe;
      inherit (lib.platforms) unix;
    in
    {
      # La ingesta nocturna (ADR 0015): apps/nocturna en un solo fichero que ejecuta el Node 24 de
      # nixpkgs. Las dependencias de pnpm se fijan por su hash; cómo actualizarlo está en
      # docs/patterns/nixos.md.
      packages.celda-nocturna = pkgs.callPackage (
        {
          esbuild,
          fetchPnpmDeps,
          makeWrapper,
          nodejs-slim_24,
          pnpm_10,
          pnpmConfigHook,
          stdenvNoCC,
        }:
        stdenvNoCC.mkDerivation (finalAttrs: {
          pname = "celda-nocturna";
          version = "0-unstable";

          src = toSource {
            root = ../.;
            fileset = unions [
              ../package.json
              ../pnpm-lock.yaml
              ../pnpm-workspace.yaml
              ../tsconfig.base.json

              # pnpm lee el manifiesto de cada paquete del espacio de trabajo
              (fileFilter (fichero: fichero.name == "package.json") ../.)

              ../apps/nocturna
              ../packages/dominio
              ../packages/ingesta
              ../packages/publicacion
            ];
          };

          # Solo las dependencias de producción de la ingesta: las de desarrollo traen los
          # binarios de vite-plus para todas las plataformas, más de 1 GiB.
          pnpmWorkspaces = [ "@celda/nocturna..." ];

          pnpmInstallFlags = [ "--prod" ];

          pnpmDeps = fetchPnpmDeps {
            inherit (finalAttrs)
              pname
              pnpmInstallFlags
              pnpmWorkspaces
              src
              ;
            pnpm = pnpm_10;
            fetcherVersion = 4;
            hash = "sha256-Na529J1xfs4JIQvuwIB7cj4mo7udcKwrHnvD87377z8=";
          };

          nativeBuildInputs = [
            esbuild
            makeWrapper
            pnpm_10
            pnpmConfigHook
          ];

          # El gancho de pnpm se lanza a mano para decir qué actualizar si el hash se queda viejo:
          # con un pnpm-lock.yaml nuevo y el hash de antes, Nix reutiliza las dependencias viejas y
          # la instalación sin red no encuentra los paquetes nuevos.
          dontPnpmConfigure = true;

          configurePhase = /* bash */ ''
            runHook preConfigure
            if ! (pnpmConfigHook); then
              echo
              echo "Las dependencias de pnpm de la ingesta no corresponden a pnpm-lock.yaml."
              echo "Actualiza pnpmDeps.hash en nix/nocturna.mod.nix: ponlo a \"\", lanza"
              echo "«nix build .#celda-nocturna» y copia el hash que da Nix («got: sha256-…»)."
              echo "Más en docs/patterns/nixos.md."
              exit 1
            fi
            runHook postConfigure
          '';

          # Como el build de apps/nocturna (vite.config.ts), pero con el esbuild de nixpkgs.
          buildPhase = /* bash */ ''
            runHook preBuild
            esbuild apps/nocturna/src/principal.ts \
              --bundle \
              --platform=node \
              --target=node24 \
              --format=esm \
              --outfile=apps/nocturna/dist/nocturna.js
            runHook postBuild
          '';

          installPhase = /* bash */ ''
            runHook preInstall
            install -D --mode=0444 apps/nocturna/dist/nocturna.js "$out/lib/celda-nocturna/nocturna.js"
            makeWrapper ${getExe nodejs-slim_24} "$out/bin/celda-nocturna" \
              --add-flags "$out/lib/celda-nocturna/nocturna.js"
            runHook postInstall
          '';

          meta = {
            description = "Ingesta nocturna de Celda: registro oficial, publicación y copia de la base";
            mainProgram = "celda-nocturna";
            platforms = unix;
          };
        })
      ) { };
    };
}
