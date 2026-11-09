# PhET simulations for WebWriter

Version 2.0.0 adds a stateful **Kepler’s Laws** snippet alongside the public PhET embeds. Previously authored iframe embeds can still be opened as-is.

Load this package in WebWriter through **Developer console → Local packages → Add from local folder**, then insert **Kepler’s Laws**. Select the widget to open its drawer.

- Use **Enabled screens** to select the lessons learners can open. An empty selection uses all four screens.
- Use **Preferences** to set the language, color profile, audio, and the more-orbital-data option. The choices apply to the embedded simulation immediately.
- Interact with a screen and use **Capture snapshot** to save the experiment. **Restore snapshot** returns to that checkpoint. Use WebWriter’s Undo and Redo to step through captured checkpoints and authored settings. The first checkpoint can be undone to the original experiment.

A checkpoint records the selected screen and each screen’s orbit, time, playback controls, tool positions, and display settings. Hidden screens keep their model state. This proof of concept recomputes derived orbital elements and starts a new simulation rewind point at the captured orbit. In-progress period traces, swept-area history, and partially completed gestures are transient. The build bundles translations from the pinned PhET locale data, including English and German.

The widget stores preferences in reflected attributes and the checkpoint in the versioned `snapshot` attribute. Changes made during learner interaction remain local to the simulation. The adapted simulation runs in a sandboxed frame bundled with the widget so a saved document can restore the same model version.

## Build and test

Use Node.js 22 or 24 and run `npm run build:keplers-laws` to rebuild the bundled simulation from its pinned public sources. The build downloads the sources into a fresh temporary directory and prints its path. See the [build details](tools/README-keplers-laws.md) for the source pins and upstream patches. Run `npm test` with Chrome or Chromium to check the frame, live settings, snapshot restore, and reopening authored HTML. Set `CHROME_BIN` if the browser is installed at a nonstandard path.

The WebWriter widget is MIT-licensed. The adapted simulation source and its adapter are GPLv3. The bundled HTML retains PhET’s CC BY-NC 4.0 notice and its third-party asset notices. The corresponding source consists of the pinned public source and dependencies, the build recipe, and the adapter in `adaptations/keplers-laws/`. The simulation uses the **Adapted from PhET** brand.

Simulation by PhET Interactive Simulations, University of Colorado Boulder. [Kepler’s Laws](https://phet.colorado.edu/en/simulations/keplers-laws)
