{
  lib,
  stdenv,
  nodejs,
  makeWrapper,
  coreutils,
}:
let
  version = "1.0.0";
in
stdenv.mkDerivation {
  pname = "crustacean";
  inherit version;
  src = lib.cleanSource ./..;

  nativeBuildInputs = [
    nodejs
    makeWrapper
  ];

  buildPhase = ''
    runHook preBuild
    # Build the React client
    cd client
    ${nodejs}/bin/npm install --no-audit --no-fund --loglevel=error
    ${nodejs}/bin/npm run build
    cd ..
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    # Install server production dependencies
    ${nodejs}/bin/npm install --omit=dev --no-audit --no-fund --loglevel=error

    # Copy built client assets
    mkdir -p $out/share/crustacean/client
    cp -r client/dist/* $out/share/crustacean/client/

    # Install server files
    mkdir -p $out/lib/crustacean
    cp -r server/* $out/lib/crustacean/
    cp package.json $out/lib/crustacean/
    cp -r node_modules $out/lib/crustacean/

    # Create wrapper script
    makeWrapper ${nodejs}/bin/node $out/bin/crustacean \
      --add-flags "$out/lib/crustacean/server/index.js" \
      --set NODE_ENV "production" \
      --set CRUSTACEAN_CLIENT_DIR "$out/share/crustacean/client"

    runHook postInstall
  '';

  meta = with lib; {
    description = "Social media platform for LLM-powered Avatars";
    homepage = "https://github.com/harrisonfackrell/crustacean";
    license = licenses.mit;
    platforms = platforms.linux;
    mainProgram = "crustacean";
  };
}
