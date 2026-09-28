{
  perSystem =
    { config, lib, pkgs, ... }:
    let
      inherit (lib.lists) singleton;
      inherit (lib.meta) getExe;
    in
    {
      # El entorno de siempre y un Chromium para la prueba de resistencia (tools/rendimiento).
      devShells.resistencia = pkgs.mkShellNoCC {
        # ENTORNO
        CELDA_CHROMIUM = getExe pkgs.chromium;

        inputsFrom = singleton config.devShells.default;
      };
    };
}
