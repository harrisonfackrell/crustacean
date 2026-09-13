{
  pkgs,
  crustacean,
}:
pkgs.mkShell {
  inputsFrom = [ crustacean ];

  nativeBuildInputs = with pkgs; [
    # Node.js & npm
    nodejs
  ];

  shellHook = ''
    # Install dev dependencies globally in the shell environment
    ${pkgs.nodejs}/bin/npm install -g concurrently nodemon 2>/dev/null || true

    echo " Crustacean dev-shell | 'npm run dev' to start development server"
    echo " Frontend will be available at http://localhost:5173"
    echo " Backend will be available at http://localhost:3001"
  '';
}
