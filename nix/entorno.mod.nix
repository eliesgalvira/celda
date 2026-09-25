{
  perSystem =
    { pkgs, ... }:
    {
      devShells.default = pkgs.mkShellNoCC {
        packages = [
          # WEB
          pkgs.nodejs_24
          pkgs.pnpm_10

          # CAPAS
          pkgs.pmtiles
          pkgs.tippecanoe
        ];
      };
    };
}
