import bundled from "./bundled.js"

export const defaultType = "keplers-laws"

const flag = (label, attribute) => ({label, attribute, type: Boolean})
const select = (label, attribute, entries) => ({
  label, attribute, type: "select",
  options: entries.map(([value, label]) => ({value: String(value), label})),
})
const toggle = (label, attribute) => select(label, attribute, [[true, "Enabled"], [false, "Disabled"]])
const spokenNumbers = type => ({
  autoHear: flag("Read numbers aloud automatically", `${type}-auto-hear`),
  secondLocaleEnabled: flag("Enable a second spoken language", `${type}-second-language-enabled`),
  secondLocale: {
    label: "Second spoken language", attribute: `${type}-second-language`, type: "select", runtimeLocales: true,
  },
})
const preferences = {
  "acid-base-solutions": {
    showSolvent: flag("Show solvent molecules", "abs-show-solvent"),
  },
  "keplers-laws": {
    moreOrbitalData: flag("More orbital data", "more-orbital-data"),
  },
  "arithmetic": {
    gameTimer: flag("Game timer", "arithmetic-game-timer"),
  },
  "balancing-chemical-equations": {
    initialCoefficient: select("Initial coefficient", "bce-initial-coefficient", [[0, "0"], [1, "1"]]),
  },
  "build-an-atom": {
    chargeNotation: select("Charge notation", "atom-charge-notation", [["signFirst", "Sign first"], ["signLast", "Sign last"]]),
  },
  "calculus-grapher": {
    functionVariable: select("Function variable", "calculus-function-variable", [["x", "x"], ["t", "t"]]),
    derivativeNotation: select("Derivative notation", "calculus-derivative-notation",
      [["lagrange", "Lagrange"], ["leibniz", "Leibniz"]]),
    connectDiscontinuities: select("Connect discontinuities", "calculus-connect-discontinuities",
      [["noLine", "No line"], ["dashedLine", "Dashed line"]]),
    valuesVisible: flag("Show values", "calculus-show-values"),
    predictFeature: flag("Prediction tool", "calculus-prediction-tool"),
    showPrimaryCurveCheckbox: select("Original function checkbox", "calculus-original-function-checkbox",
      [[true, "Shown"], [false, "Hidden"]]),
  },
  "center-and-variability": {
    plotType: select("Plot type", "variability-plot-type", [["LINE_PLOT", "Line plot"], ["DOT_PLOT", "Dot plot"]]),
    maxKicks: select("Maximum kicks", "variability-max-kicks", [5, 10, 15, 20, 25, 30].map(n => [n, String(n)])),
    showOutliers: flag("Show outliers", "variability-show-outliers"),
  },
  "forces-and-motion-basics": {
    pullerColors: select("Puller colors", "forces-puller-colors", [["blueRed", "Blue and red"], ["purpleOrange", "Purple and orange"]]),
  },
  "greenhouse-effect": {
    defaultTemperatureUnits: select("Temperature units", "greenhouse-temperature-units",
      [["KELVIN", "Kelvin"], ["CELSIUS", "Celsius"], ["FAHRENHEIT", "Fahrenheit"]]),
    cueingArrows: toggle("Cueing arrows", "greenhouse-cueing-arrows"),
  },
  "molecule-polarity": {
    dipoleDirection: select("Dipole direction", "polarity-dipole-direction",
      [["positiveToNegative", "Positive to negative"], ["negativeToPositive", "Negative to positive"]]),
    surfaceColor: select("Surface colors", "polarity-surface-color",
      [["blueWhiteRed", "Blue, white and red"], ["rainbow", "Rainbow"]]),
  },
  "molecule-shapes": {
    showOuterLonePairs: flag("Show outer lone pairs", "molecule-shapes-outer-lone-pairs"),
  },
  "membrane-transport": {
    animateLipids: toggle("Animate lipids", "membrane-animate-lipids"),
    glucoseMetabolism: toggle("Glucose metabolism", "membrane-glucose-metabolism"),
    stereoCrossingSounds: toggle("Stereo crossing sounds", "membrane-stereo-crossing-sounds"),
  },
  "number-compare": {
    showLabOnes: select("Ones on the Lab screen", "number-compare-lab-ones", [["shown", "Shown"], ["hidden", "Hidden"]]),
    ...spokenNumbers("number-compare"),
  },
  "number-line-distance": {
    terminology: select("Terminology", "number-line-distance-terminology",
      [["directedDistance", "Directed distance"], ["displacement", "Displacement"]]),
  },
  "number-pairs": {
    ...spokenNumbers("number-pairs"),
    primaryLanguage: toggle("Use primary spoken language", "number-pairs-primary-language"),
    numberModel: select("Number model", "number-pairs-model", [["numberBond", "Number bond"], ["barModel", "Bar model"]]),
    sumTotalOnTop: flag("Put the sum on top", "number-pairs-sum-on-top"),
  },
  "number-play": {
    ...spokenNumbers("number-play"),
    primaryLanguage: toggle("Use primary spoken language", "number-play-primary-language"),
    showLabOnes: toggle("Show ones on the Lab screen", "number-play-lab-ones"),
    subitizeTimeShown: {
      label: "Time to show each quantity", attribute: "number-play-quantity-time",
      type: "number", min: 0.1, max: 2, step: 0.1, unit: "s",
    },
  },
  "quadrilateral": {
    soundDesign: select("Sound design", "quadrilateral-sound-design", [["shapeLayer", "Layered"], ["shapeUnique", "Unique per shape"]]),
    tracksPlayForever: flag("Keep sound tracks playing", "quadrilateral-loop-sound-tracks"),
  },
  "quantum-bound-states": {
    phaseCheckbox: select("Phase checkbox", "quantum-phase-checkbox", [["shown", "Shown"], ["hidden", "Hidden"]]),
  },
}

for (const type of ["faradays-electromagnetic-lab", "generator", "magnet-and-compass", "magnets-and-electromagnets"]) {
  preferences[type] = {
    magneticUnits: select("Magnetic field units", `${type}-magnetic-units`, [["G", "Gauss"], ["T", "Tesla"]]),
    ...(type === "magnet-and-compass" ? {} : {
      currentFlow: select("Current flow", `${type}-current-flow`, [["electron", "Electron"], ["conventional", "Conventional"]]),
    }),
    ...(type === "generator" ? {} : {
      addEarthCheckbox: toggle("Earth checkbox", `${type}-earth-checkbox`),
      earthHemisphere: select("Earth hemisphere", `${type}-earth-hemisphere`, [["western", "Western"], ["eastern", "Eastern"]]),
    }),
  }
}

for (const type of ["buoyancy", "buoyancy-basics", "density"]) {
  preferences[type] = {
    volumeUnits: select("Volume units", `${type}-volume-units`, [["liters", "Liters"], ["decimetersCubed", "Cubic decimeters"]]),
    ...(type === "density" ? {} : {
      percentSubmergedVisible: select("Percent submerged", `${type}-percent-submerged`, [[true, "Shown"], [false, "Hidden"]]),
    }),
  }
}
for (const type of ["circuit-construction-kit-ac", "circuit-construction-kit-ac-virtual-lab",
  "circuit-construction-kit-dc", "circuit-construction-kit-dc-virtual-lab"]) {
  preferences[type] = {
    schematicStandard: select("Schematic standard", `${type}-schematic-standard`, [["IEEE", "IEEE"], ["IEC", "IEC"], ["BRITISH", "British"]]),
    ammeterReadout: select("Ammeter readout", `${type}-ammeter-readout`, [["MAGNITUDE", "Magnitude"], ["SIGNED", "Signed"]]),
  }
}
for (const type of ["energy-skate-park", "energy-skate-park-basics"]) {
  preferences[type] = {
    accelerationUnits: select("Acceleration units", `${type}-acceleration-units`,
      [["METERS_PER_SECOND_SQUARED", "m/s²"], ["NEWTONS_PER_KILOGRAM", "N/kg"]]),
    showPatterns: flag("Show patterns", `${type}-show-patterns`),
  }
}
for (const type of ["gas-properties", "gases-intro"]) {
  preferences[type] = {pressureNoise: toggle("Pressure noise", `${type}-pressure-noise`)}
}
for (const type of ["geometric-optics", "geometric-optics-basics"]) {
  preferences[type] = {
    focalLengthControl: select("Focal length control", `${type}-focal-length-control`, [["direct", "Direct"], ["indirect", "Indirect"]]),
    twoFPointsCheckbox: toggle("2F points checkbox", `${type}-2f-points-checkbox`),
    cueingArrows: toggle("Cueing arrows", `${type}-cueing-arrows`),
  }
}
for (const type of ["ph-scale", "ph-scale-basics"]) {
  preferences[type] = {autoFill: toggle("Auto-fill solutions", `${type}-auto-fill`)}
}
for (const type of ["vector-addition", "vector-addition-equations"]) {
  preferences[type] = {
    angleConvention: select("Angle convention", `${type}-angle-convention`, [["signed", "Signed"], ["unsigned", "Unsigned"]]),
  }
}
for (const type of ["quantum-coin-toss", "quantum-measurement"]) {
  preferences[type] = {
    classicalCoinsStartHidden: flag("Hide classical coins at the start", `${type}-hide-classical-coins`),
    ...(type === "quantum-measurement" ? {
      showGlobalPhase: flag("Show global phase", `${type}-show-global-phase`),
    } : {}),
  }
}
for (const type of ["projectile-data-lab", "projectile-sampling-distributions"]) {
  preferences[type] = {
    autoGenerateData: flag("Generate data automatically", `${type}-generate-data`),
    launchSound: select("Launch sound", `${type}-launch-sound`, [["speed", "Speed"], ["angle", "Angle"], ["none", "None"]]),
    playLandingSound: toggle("Landing sound", `${type}-landing-sound`),
    ...(type === "projectile-data-lab" ? {
      projectileTypeAffectsSpeed: toggle("Projectile type affects speed", `${type}-type-affects-speed`),
      binStrategy: select("Histogram bins", `${type}-histogram-bins`, [["binWidth", "Bin width"], ["totalBins", "Total bins"]]),
      showStandardError: flag("Show standard error", `${type}-show-standard-error`),
    } : {}),
  }
}

export const adapters = new Map(Object.entries(bundled).map(([type, load]) => [
  type, {
    bridge: `webwriter-${type}/v1`,
    load,
    screenAttribute: type === defaultType ? "enabled-screens" : `${type}-screens`,
    preferences: preferences[type],
  },
]))
