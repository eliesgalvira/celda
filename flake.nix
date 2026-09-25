{
  description = "Celda: antenas de telefonía móvil de Barcelona en un mapa";

  nixConfig = {
    extra-experimental-features = [ "pipe-operators" ];
  };

  inputs.nixpkgs = {
    url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  inputs.flake-parts = {
    url = "github:hercules-ci/flake-parts";
    inputs.nixpkgs-lib.follows = "nixpkgs";
  };

  inputs.import-tree = {
    url = "github:denful/import-tree";
  };

  outputs =
    inputs:
    let
      inherit (inputs.nixpkgs.lib.strings) hasSuffix;
    in
    inputs.flake-parts.lib.mkFlake { inherit inputs; }
    <| inputs.import-tree.filter (hasSuffix ".mod.nix") ./nix;
}
