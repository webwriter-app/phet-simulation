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
export const adapters = new Map([[defaultType, keplersLaws]])
