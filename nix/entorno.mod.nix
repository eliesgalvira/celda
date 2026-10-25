{
  perSystem =
    { pkgs, ... }:
    {
      devShells.default = pkgs.mkShellNoCC {
        packages = [
          pkgs.nodejs_24
          pkgs.pnpm_10
        ];
      };
    };
}
