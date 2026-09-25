{
  perSystem =
    { config, lib, pkgs, ... }:
    let
      inherit (lib.meta) getExe;
    in
    {
      apps.default = {
        type = "app";

        program = getExe <| pkgs.writeShellApplication {
          name = "celda";
          runtimeInputs = config.devShells.default.nativeBuildInputs;
          text = /* bash */ ''
            pnpm install --frozen-lockfile
            exec pnpm run dev
          '';
        };
      };
    };
}
