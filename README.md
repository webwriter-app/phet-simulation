# PhET simulations for WebWriter

Insert a PhET snippet, then select the widget and use **Simulation** in the drawer to switch to another simulation. The selection is stored as a `type` attribute, such as `type="pendulum-lab"`. Widgets authored before this attribute was added still open Kepler’s Laws. Existing plain iframe embeds still open as authored.

The widget keeps its authored size, audio, color profile, and language when switching. A simulation follows the nearest HTML `lang` value and uses the language it supports.

Bundled simulations save a separate checkpoint for each simulation type. Their checkpoints and settings stay in the document when you switch away.

- Use **Enabled screens** to choose which screens learners can open in simulations with more than one screen. An empty selection enables all screens.
- Use **Preferences** to edit general settings and the selected simulation’s own preferences, when available.
- Interact with the simulation in edit mode and WebWriter saves the experiment shortly after the interaction ends. During visible playback it saves changes every ten seconds, with longer intervals for large experiments.

WebWriter’s Undo and Redo step through automatic checkpoints and authored settings. Applying an authored change such as undo, redo, or a collaborator’s edit suspends automatic saving until the next simulation interaction. Unchanged samples are skipped, and saving pauses offscreen or in a hidden tab.

Checkpoints capture each screen’s experiment, including hidden screens. The model adapter restores the saved inputs, tools, and motion where available. Simulations may reconstruct derived results and finish or reset gestures and short animations that were still in progress.

The widget stores preferences in reflected attributes and the versioned checkpoint in a direct `<script type="application/json" slot="data">` block. Changes made during learner interaction remain local to the simulation. The selected simulation runs in a sandboxed frame. It loads the bundled shared runtime and its own code and assets on demand.

The catalog lives in `simulations.json`. Model adapters in `adaptations/` supply screen identifiers and state readers and writers. The common bridge handles preferences and checkpoint exchange. A checkpoint’s `data-simulation` attribute identifies its simulation type; an unmarked block belongs to Kepler’s Laws for compatibility with older documents.

## Build and test

Use Node.js 22 or 24 and run `npm run build:simulations` to rebuild from the pinned public sources. See the [build details](tools/README.md) for the source pins, subset builds, and test options. Run `npm test` with Chrome or Chromium to verify save and restore behavior.

The WebWriter widget is MIT-licensed. The adapted simulation sources and adapters are GPLv3. The bundled HTML retains PhET’s CC BY-NC 4.0 notice and its third-party asset notices. The corresponding source consists of the pinned public source and dependencies, the build recipe, and the adapters in `adaptations/`. The bundled simulations use the **Adapted from PhET** brand.
