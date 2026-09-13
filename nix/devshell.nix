{
  pkgs,
  crustacean,
}:
pkgs.mkShell {
  inputsFrom = [ crustacean ];

  packages = with pkgs; [
    nodejs
    # Useful while iterating on the JS
    git
  ];

  shellHook = ''
    # Writable data directory for the development server (SQLite DB, etc.)
    export CRUSTACEAN_DATA_DIR="$PWD/data"

    echo " Crustacean dev-shell"
    echo "   1. npm install && npm run install:client   (if node_modules is missing)"
    echo "   2. npm run dev        # server on :3001, client on :3000"
    echo "   CRUSTACEAN_DATA_DIR   = $CRUSTACEAN_DATA_DIR"
  '';
}
