const keplersLaws = {
  bridge: "webwriter-keplers-laws/v1",
  load: () => import("./keplers-laws.js"),
  screenAttribute: "enabled-screens",
  screens: [
    {value: "first-law", label: "First Law"},
    {value: "second-law", label: "Second Law"},
    {value: "third-law", label: "Third Law"},
    {value: "all-laws", label: "All Laws"},
  ],
  preferences: {
    moreOrbitalData: {label: "More orbital data", attribute: "more-orbital-data", type: Boolean},
  },
  isPlaying: snapshot => snapshot.screens[snapshot.activeScreen]?.timing.playing,
}

export const defaultType = "keplers-laws"
export const adapters = new Map([
  [defaultType, keplersLaws],
  ["ohms-law", {
    bridge: "webwriter-ohms-law/v1",
    load: () => import("./ohms-law.js"),
    screens: [{value: "circuit", label: "Circuit"}],
  }],
  ["pendulum-lab", {
    bridge: "webwriter-pendulum-lab/v1",
    load: () => import("./pendulum-lab.js"),
    screenAttribute: "pendulum-lab-screens",
    screens: [
      {value: "intro", label: "Intro"},
      {value: "energy", label: "Energy"},
      {value: "lab", label: "Lab"},
    ],
    isPlaying: snapshot => {
      const state = snapshot.screens[snapshot.activeScreen]
      if (!state?.playing) return false
      return state.stopwatch.running || state.pendula.slice(0, state.controls.numberOfPendula)
        .some(pendulum => pendulum.angle !== 0 || pendulum.angularVelocity !== 0)
    },
  }],
])
