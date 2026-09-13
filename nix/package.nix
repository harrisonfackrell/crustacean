{
  lib,
  buildNpmPackage,
  nodejs,
  # When true, the Vite/React frontend is built and bundled so the Express
  # server can serve it. Set to false for a server-only package.
  withFrontend ? true,
  # Optionally provide your own frontend derivation to embed instead of
  # building the bundled client.
  frontend ? null,
}:
let
  versionOf =
    path:
    let
      m = builtins.match "\"version\": \"([^\"]+)\"" (lib.readFile path);
    in
    if m != null then builtins.head m else "1.0.0";

  # Drop locally-managed artifacts (installed deps, committed DB, build
  # output, VCS) so the sources in the store are hermetic.
  stripNpmArtifacts =
    name: type:
    let
      baseName = lib.baseNameOf name;
    in
    !(
      baseName == ".git"
      || baseName == "node_modules"
      || (baseName == "data" && type == "directory")
      || (baseName == "dist" && type == "directory")
    );

  # The React frontend, built with Vite. Its output (client/dist) is served
  # by the Express server in production mode.
  client = buildNpmPackage {
    pname = "crustacean-client";
    version = versionOf ./../client/package.json;

    src = lib.cleanSourceWith {
      src = ./../client;
      filter = stripNpmArtifacts;
    };

    npmDepsHash = "sha256-wgggVxNUNPDZv05hiAtmbQumu2Qx1fmUrmm3Vtl1t0g=";
    npmBuildScript = "build";

    # Vite writes its bundle to ./dist; we only want the build artifact,
    # not npmInstallHook's `npm pack`-based file selection.
    dontNpmInstall = true;
    installPhase = ''
      runHook preInstall
      mkdir $out
      cp -r dist $out
      runHook postInstall
    '';

    meta = with lib; {
      description = "Crustacean web frontend (React/Vite)";
      license = licenses.mit;
      platforms = platforms.linux ++ platforms.darwin;
    };
  };

  effectiveFrontend =
    if frontend != null then frontend else client;
in
buildNpmPackage {
  pname = "crustacean";
  version = versionOf ./../package.json;

  src = lib.cleanSourceWith {
    src = ./..;
    filter = stripNpmArtifacts;
  };

  npmDepsHash = "sha256-ymWHqXQ3RrAV50hD3Yd9D2URCXKfMlsoYcma8sAftXw=";

  # The server is plain CommonJS: there is nothing to compile.
  dontNpmBuild = true;

  postPatch = ''
    # The SQLite database must live outside the read-only Nix store.
    # Location: $CRUSTACEAN_DATA_DIR/crustacean.db (created at runtime).
    substituteInPlace server/db/index.js \
      --replace-fail "path.join(__dirname, '..', '..', 'data', 'crustacean.db')" \
      "path.join(process.env.CRUSTACEAN_DATA_DIR || path.join(require('os').homedir(), '.local', 'share', 'crustacean'), 'crustacean.db')"
  '';

  dontNpmInstall = true;
  installPhase = ''
    runHook preInstall
    mkdir -p $out/bin $out/lib

    # Application source + installed dependencies
    cp -r server package.json $out/lib/
    cp -r node_modules $out/lib/

    # Built frontend (Express serves this in production mode)
    ${
      lib.optionalString withFrontend
      ''
      mkdir -p $out/lib/client
      cp -r ${effectiveFrontend}/dist $out/lib/client/dist
      ''
    }

    # Launcher: node + our tree, production mode.
    cat > $out/bin/crustacean <<'EOF'
    #!/bin/sh
    dir="$(dirname "$(readlink -f "$0")")"
    export NODE_ENV=production
    exec ${nodejs}/bin/node "$dir/../lib/server/index.js" "$@"
    EOF
    chmod 0755 $out/bin/crustacean

    runHook postInstall
  '';

  passthru = {
    inherit client;
  };

  meta = with lib; {
    description = "A social media platform for LLM-powered avatars";
    homepage = "https://github.com/harrisonfackrell/crustacean";
    changelog = "https://github.com/harrisonfackrell/crustacean/releases";
    license = licenses.mit;
    platforms = platforms.linux ++ platforms.darwin;
    mainProgram = "crustacean";
  };
}
