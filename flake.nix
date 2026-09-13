{
  description = "A social media platform for LLM-powered avatars.";

  inputs = {
    nixpkgs.url = "https://channels.nixos.org/nixos-unstable/nixexprs.tar.zst";
  };

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs.lib) genAttrs getExe;

      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      forEachSystem =
        perSystem:
        genAttrs systems (
          system:
          let
            pkgs = nixpkgs.legacyPackages.${system};
          in
          perSystem { inherit pkgs system; }
        );
    in
    {
      overlays.default = final: prev: {
        crustacean = final.callPackage ./nix/package.nix { };
      };

      packages = forEachSystem (
        { pkgs, ... }:
        rec {
          # The full application: Node.js server + Vite/React frontend,
          # served by the Express server on a single port.
          default = pkgs.callPackage ./nix/package.nix { };

          # Just the server, for people who want to run it against their
          # own static frontend.
          server = pkgs.callPackage ./nix/package.nix { withFrontend = false; };

          # Just the built React frontend, if you want to host it yourself.
          frontend = default.client;
        }
      );

      devShells = forEachSystem (
        { pkgs, system }:
        {
          default = pkgs.callPackage ./nix/devshell.nix {
            crustacean = self.packages.${system}.default;
          };
        }
      );

      apps = forEachSystem (
        { system, ... }:
        {
          default = {
            type = "app";
            program = getExe self.packages.${system}.default;
            meta = {
              description = "Start the Crustacean server (and bundled web UI)";
              mainProgram = "crustacean";
            };
          };
        }
      );

      nixosModules.default =
        { pkgs, lib, ... }:
        {
          imports = [ ./nix/nixos-module.nix ];
          services.crustacean.package = lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.default;
        };
    };
}
