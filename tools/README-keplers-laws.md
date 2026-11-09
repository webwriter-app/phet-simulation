# Kepler’s Laws build details

The source checkout uses the public 1.2.11 release commit `4706dbc977bcc5af671397d9a119847a49705064`. The release manifest records `22803eba7135389fc5d3a8f04fc294016e4b0cb1` for the simulation itself. All other public dependencies use the release manifest pins, and Babel uses the separate pin in [the build lock](keplers-laws-build.lock.json).

The build creates an isolated checkout below the system temporary directory. Set `PHET_KEPLERS_BUILD_DIR` to choose its parent. The toolchain needs access to the public GitHub repositories and the npm registry for the upstream lockfiles.

The build recipe enables the `adapted-from-phet` brand in the temporary manifest, exposes Joist’s existing available-screens property to the adapter, and installs the adapter after the simulation launcher calls `sim.start()`. It uses Chipper’s `--allHTML` output for live locale switching. The public build excludes the private PhET-iO and Studio dependencies. Chipper skips the full upstream type check for this build because the launcher references a private engine module.
