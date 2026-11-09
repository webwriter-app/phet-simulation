# Building the adapted simulations

Use Node.js 22 or 24 and run `npm run build:simulations`. The build uses the public sources in [simulations-build.lock.json](simulations-build.lock.json). It installs the pinned Chipper and Perennial toolchains and compiles the public source trees together. Chipper uses each entry's module list to generate its locale data, media license notices, and HTML shell. PhET-iO and Studio are excluded.

The build creates a fresh workspace in the system temporary directory. Set `PHET_BUILD_DIR` to choose the parent directory and `PHET_BUILD_JOBS` to set the number of concurrent HTML builds (default 3). A directory of existing pinned Git checkouts can be reused via `PHET_SOURCE_CACHE`. The build verifies the checked out commit against the lock in either case.

Pass simulation IDs after `--` to build a subset for testing. The subset's output stays in the temporary workspace; it doesn't replace the package's shared runtime. `npm run build:keplers-laws` builds a Kepler-only subset.

The build stages the shared adapter code once and adds each adapter to the simulation's launcher. The adapter runs after Joist has created the models and views. Joist's existing screen selection property is exposed so the widget can set the enabled screens without remounting the simulation. Each adapter identifies every screen, reads its model state, and validates incoming values before applying them. Adapters can signal playback when their active model changes on its own.

Webpack builds the transpiled entries together. Code and identical preload scripts used by every entry go into `sims/runtime.js`. Larger code groups and identical preloads shared by a subset go into chunks loaded only by those entries. The widget loads the selected entry on demand and assembles its HTML for a sandboxed iframe. The host reuses imported modules across widgets; each iframe has its own model and JavaScript environment.

Kepler's Laws still accepts version 1 checkpoints authored with the original public 1.2.11 release build. The current build uses the same public source cohort as the other adapters so they can share the runtime.

Run `npm test` with Chrome or Chromium to exercise the authored checkpoints and preferences in sandboxed frames. To test a subset, set `PHET_TEST_ARTIFACT_DIR` to the subset's `artifacts` directory and `PHET_TEST_SIMULATIONS` to a comma-separated list of IDs. Set `CHROME_BIN` to use a different browser binary.
