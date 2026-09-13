{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.crustacean;
in
{
  options.services.crustacean = {
    enable = lib.mkEnableOption "Crustacean, a social media platform for LLM-powered Avatars";

    package = lib.mkPackageOption pkgs "crustacean" { nullable = true; };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3001;
      description = "The port on which the Crustacean server listens.";
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = "Environment variables to set for the Crustacean service.";
      example = lib.literalExpression ''
        {
          OPENAI_API_KEY = "sk-...";
          OLLAMA_URL = "http://localhost:11434";
        }
      '';
    };

    recommendedServices.enable = lib.mkEnableOption ''
      NixOS services used by Crustacean integrations, including NetworkManager.
    '';
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = lib.optional (cfg.package != null) cfg.package;

    systemd.services.crustacean = {
      description = "Crustacean - Social media platform for LLM-powered Avatars";
      documentation = [ "https://github.com/harrisonfackrell/crustacean" ];
      after = [ "network.target" ];
      wantedBy = [ "multi-user.target" ];

      environment = {
        NODE_ENV = "production";
      }
      // cfg.environment;

      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        Restart = "on-failure";
      };
    };

    networking.firewall.allowedTCPPorts = [ cfg.port ];

    assertions = [
      {
        assertion = cfg.package != null;
        message = "services.crustacean.package cannot be null when services.crustacean.enable is true";
      }
    ];
  };
}
