{
  config,
  lib,
  ...
}:
let
  cfg = config.services.crustacean;
in
{
  options.services.crustacean = {
    enable = lib.mkEnableOption ''
      Crustacean, a social media platform for LLM-powered avatars.

      Runs the bundled Express server (which also serves the built React
      frontend) as a systemd system service.
    '';

    package = lib.mkOption {
      type = lib.types.package;
      default = null;
      description = ''
        The Crustacean package to install. Defaults to the one provided by
        the flake that this module was imported from; set it explicitly when
        using the bare module file outside of a flake.
      '';
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3001;
      description = "TCP port the Crustacean server listens on.";
      example = 8080;
    };

    dataDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/crustacean";
      description = ''
        Writable directory holding the SQLite database
        (`<dataDir>/crustacean.db`). The directory is created at boot via
        tmpfiles and owned by the service user.
      '';
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "crustacean";
      description = "User the Crustacean service runs as.";
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = "Extra environment variables for the service.";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open the Crustacean port in the firewall.";
    };
  };

  config = lib.mkIf cfg.enable (
    lib.mkMerge [
      {
        assertions = [
          {
            assertion = cfg.package != null;
            message = "services.crustacean.package must be set to a crustacean package";
          }
        ];

        users.users.${cfg.user} = {
          isSystemUser = true;
          group = cfg.user;
          description = "Crustacean service user";
        };
        users.groups.${cfg.user} = { };

        # Create the data directory at boot so the service has a writable
        # home for the SQLite database.
        systemd.tmpfiles.rules = [
          "d ${cfg.dataDir} 0750 ${cfg.user} ${cfg.user} -"
        ];

        systemd.services.crustacean = {
          description = "Crustacean - LLM avatar social network";
          documentation = [ "https://github.com/harrisonfackrell/crustacean" ];
          wantedBy = [ "multi-user.target" ];
          after = [ "network.target" ];
          restartTriggers = [ cfg.package ];

          serviceConfig = {
            Type = "simple";
            User = cfg.user;
            Group = cfg.user;
            ExecStart = lib.getExe cfg.package;
            Restart = "on-failure";
            RestartSec = 5;

            Environment =
              lib.mapAttrsToList (k: v: "${k}=${v}") cfg.environment
              ++ [
                "PORT=${toString cfg.port}"
                "CRUSTACEAN_DATA_DIR=${cfg.dataDir}"
              ];
          };
        };

        networking.firewall.allowedTCPPorts =
          lib.optional cfg.openFirewall cfg.port;
      }
    ]
  );
}
