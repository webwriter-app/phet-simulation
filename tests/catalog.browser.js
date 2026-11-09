import "../widgets/webwriter-phet-simulation.js"

const ids = await (await fetch("/test-simulations")).json()
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function check(condition, message) {
  if (!condition) throw new Error(message)
}

function same(actual, expected, message) {
  check(JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// Exercise authored model changes in addition to the common screen and
// preferences contract. Fields here are inputs the original sim lets users edit.
const controls = {
  "acid-base-solutions": ["my-solution", "weak"],
  "area-builder": ["explore", "grid"],
  "atomic-interactions": ["atomic-interactions", "forcesExpanded"],
  "balloons-and-static-electricity": ["balloons", "wallVisible"],
  "blackbody-spectrum": ["spectrum", "graphValuesVisible"],
  "build-an-atom": ["atom", "elementName"],
  "calculus-grapher": ["derivative", "controls", "grid"],
  "capacitor-lab-basics": ["capacitance", "controls", "plateCharges"],
  "center-and-variability": ["median", "controls", "playAreaMedian"],
  "charges-and-fields": ["charges-and-fields", "controls", "grid"],
  "collision-lab": ["intro", "controls", "paths"],
  "color-vision": ["single-bulb", "bulbs", "filterVisible"],
  "curve-fitting": ["curve-fitting", "controls", "values"],
  "diffusion": ["diffusion", "controls", "centerOfMass"],
  "graphing-quadratics": ["explore", "controls", "graphVisible"],
  "hookes-law": ["intro", "valuesVisible"],
}

async function initialState(widget) {
  const status = widget.shadowRoot.querySelector("output")
  for (let attempt = 0; attempt < 260; attempt++) {
    if (!status.hidden) throw new Error(status.textContent)
    try {
      return await widget.getSimulationState()
    }
    catch {
      await delay(40)
    }
  }
  throw new Error("The state bridge did not connect.")
}

async function verify(type) {
  const widget = document.createElement("webwriter-phet-simulation")
  widget.type = type
  widget.setAttribute("audio", "muted")
  widget.lang = type === "quantum-bound-states" ? "qaa" : "de"
  const block = document.createElement("script")
  block.type = "application/json"
  block.slot = "data"
  block.dataset.simulation = type
  block.textContent = "null"
  widget.append(block)
  document.body.append(widget)
  try {
    const {snapshot, preferences} = await initialState(widget)
    const screens = Object.keys(snapshot.screens)
    check(snapshot.build.startsWith(type + "@"), "Unexpected build ID")
    check(snapshot.schemaVersion === 1 && screens.length > 0, "Invalid checkpoint")
    same(preferences.enabledScreens, screens, "All screens are enabled by default")
    same(preferences.audio, "muted", "Audio preference")
    if (type === "quantum-bound-states") same(preferences.locale, "en", "Unsupported language uses English")
    const state = structuredClone(snapshot)
    const target = screens.at(-1)
    state.activeScreen = target
    const control = controls[type]
    const container = data => control?.slice(0, -1).reduce((object, key) => object?.[key], data.screens)
    const key = control?.at(-1)
    const readControl = data => container(data)?.[key]
    const oldValue = readControl(snapshot)
    if (control) {
      check(typeof oldValue === "boolean", "Missing editable control in checkpoint")
      container(state)[key] = !oldValue
    }
    const targetState = state.screens[target]
    const circuit = type.startsWith("circuit-construction-kit-")
    if (circuit) {
      targetState.playback.playing = false
      targetState.vertices = [[330, 180], [510, 180], [510, 320], [330, 320]]
        .map(position => ({position, voltage: 0}))
      targetState.elements = [["battery", 9], ["wire", null], ["resistor", 10], ["wire", null]]
        .map(([kind, parameters], start) => ({kind, start, end: (start + 1) % 4, parameters, current: 0, history: null}))
    }
    if (type === "charges-and-fields") {
      targetState.charges = [
        {origin: [0, 0], position: [-0.2, 0], sign: 1},
        {origin: [0, 0], position: [0.2, 0], sign: -1},
      ]
    }
    const detector = type === "quantum-wave-interference" && targetState.scenes.photons
    if (detector) {
      const bytes = new Uint8Array(32)
      const view = new DataView(bytes.buffer)
      const coordinates = [0.125, -0.25, -0.5, 0.75]
      coordinates.forEach((coordinate, index) => view.setFloat64(index * 8, coordinate, true))
      targetState.playing = false
      detector.totalHits = 2
      detector.hits = btoa(String.fromCharCode(...bytes))
    }

    block.textContent = JSON.stringify(state)
    const applied = await widget.getSimulationState()
    check(widget.shadowRoot.querySelector("output").hidden, widget.shadowRoot.querySelector("output").textContent)
    same(applied.snapshot.activeScreen, target, "Restore selected screen")
    same(readControl(applied.snapshot), readControl(state), "Restore model control")
    if (circuit) {
      const topology = ({kind, start, end, parameters}) => ({kind, start, end, parameters})
      same(applied.snapshot.screens[target].elements.map(topology), targetState.elements.map(topology), "Restore a closed circuit")
    }
    if (type === "charges-and-fields") {
      same(applied.snapshot.screens[target].charges, targetState.charges, "Restore charge positions")
    }
    if (detector) {
      const restored = applied.snapshot.screens[target].scenes.photons
      same([restored.totalHits, restored.hits], [detector.totalHits, detector.hits], "Restore detector hits without losing precision")
    }
    same(applied.preferences, preferences, "Restoring state preserves preferences")

    for (const [key, option] of Object.entries(widget.options)) {
      if (option.group !== "preferences" || key === "audio" || key === "colorProfile") continue
      if (option.type === Boolean) widget.toggleAttribute(option.attribute, !preferences[key])
      else if (option.type === "number") widget.setAttribute(option.attribute, preferences[key] === option.min ? option.max : option.min)
      else {
        const choice = option.options.find(choice => choice.value !== String(preferences[key]))
        if (!choice) continue
        widget.setAttribute(option.attribute, choice.value)
      }
      const changed = await widget.getSimulationState()
      same(String(changed.preferences[key]), String(widget[key]), `Apply ${key} preference`)
      check(changed.preferences[key] !== preferences[key], `The ${key} preference did not change`)
      widget.removeAttribute(option.attribute)
    }

    if (screens.length > 1) {
      const screenOption = widget.options.enabledScreens
      same(screenOption.options.map(screen => screen.value), screens, "Published screen options")
      widget.setAttribute(screenOption.attribute, JSON.stringify([screens[0]]))
      const hidden = await widget.getSimulationState()
      same(hidden.preferences.enabledScreens, [screens[0]], "Screen selection")
      same(hidden.snapshot.activeScreen, screens[0], "A hidden screen cannot remain active")
      same(Object.keys(hidden.snapshot.screens), screens, "Hidden screens retain state")
      widget.removeAttribute(screenOption.attribute)
    }

    block.textContent = "null"
    const reset = await widget.getSimulationState()
    check(widget.shadowRoot.querySelector("output").hidden, widget.shadowRoot.querySelector("output").textContent)
    same(readControl(reset.snapshot), oldValue, "Removing checkpoint restores initial model control")
    same(reset.preferences.enabledScreens, screens, "Restored available screens")
    same(block.textContent, "null", "Reader must not overwrite authored state")
  }
  finally {
    widget.remove()
  }
}

const errors = []
for (const id of ids) {
  try { await verify(id) }
  catch (error) { errors.push(`${id}: ${error.message}`) }
}
await fetch("/test-result", {
  method: "POST",
  body: JSON.stringify({error: errors.length ? errors.join("\n") : undefined}),
})
