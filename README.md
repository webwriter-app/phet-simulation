# PhET simulations for WebWriter

Insert a PhET snippet, then select the widget and use **Simulation** in the drawer to switch to another simulation. The selection is stored as a `type` attribute, such as `type="pendulum-lab"`. Widgets authored before this attribute was added still open Kepler’s Laws. Existing plain iframe embeds still open as authored.

The widget keeps its authored size, audio, color profile, and language when switching. A simulation follows the nearest HTML `lang` value and uses the language it supports. The public PhET builds load online and apply audio, locale, and supported color profiles at startup. Changing one of these settings on a public build reloads its frame.

**Kepler’s Laws** ships with a state adapter. Its checkpoint and simulation-specific settings stay in the document when you switch away. The other simulations currently use public embeds, which do not expose their model state to WebWriter.

- Use **Enabled screens** to select the lessons learners can open. An empty selection uses all four screens.
- Use **Preferences** to set the more-orbital-data option alongside the general settings.
- Interact with the simulation in edit mode and WebWriter saves the experiment shortly after the interaction ends. During visible playback it saves changes every ten seconds.

WebWriter’s Undo and Redo step through automatic checkpoints and authored settings. Applying an authored change such as undo, redo, or a collaborator’s edit suspends automatic saving until the next simulation interaction. Unchanged samples are skipped, and saving pauses offscreen or in a hidden tab.

A checkpoint records the selected screen and each screen’s orbit, time, playback controls, tool positions, and display settings. Hidden screens keep their model state. This proof of concept recomputes derived orbital elements and starts a new simulation rewind point at the captured orbit. In-progress period traces, swept-area history, and partially completed gestures are transient. The build bundles translations from the pinned PhET locale data, including English and German.

The widget stores preferences in reflected attributes and the versioned checkpoint in a direct `<script type="application/json" slot="data">` block. Changes made during learner interaction remain local to the simulation. The adapted simulation runs in a sandboxed frame bundled with the widget so a saved document can restore the same model version.

The widget handles selection, switching, shared settings, and checkpoint persistence. The catalog lives in `simulations.json`, and `sims/adapters.js` registers bundled simulations and their options. Each model adapter supplies screen identifiers and state readers and writers. The common bridge in `adaptations/shared/` applies preferences and coordinates checkpoint exchange. Other adapters can use a `data-simulation` attribute on their checkpoint block and their own attributes for simulation-specific settings.

## Build and test

Use Node.js 22 or 24 and run `npm run build:keplers-laws` to rebuild the bundled simulation from its pinned public sources. The build downloads the sources into a fresh temporary directory and prints its path. See the [build details](tools/README-keplers-laws.md) for the source pins and upstream patches. Run `npm test` with Chrome or Chromium to check automatic saving, live settings, and reopening authored HTML. Set `CHROME_BIN` if the browser is installed at a nonstandard path.

The WebWriter widget is MIT-licensed. The adapted simulation source and its adapter are GPLv3. The bundled HTML retains PhET’s CC BY-NC 4.0 notice and its third-party asset notices. The corresponding source consists of the pinned public source and dependencies, the build recipe, and the adapter in `adaptations/keplers-laws/`. The simulation uses the **Adapted from PhET** brand.

Simulation by PhET Interactive Simulations, University of Colorado Boulder. [Kepler’s Laws](https://phet.colorado.edu/en/simulations/keplers-laws)
