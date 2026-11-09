import "../widgets/webwriter-phet-simulation.js"

function check(condition, message) {
  if (!condition) throw new Error(message)
}

function same(actual, expected, message) {
  check(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`)
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const dataBlock = widget => widget.querySelector(':scope > script[type="application/json"][slot="data"]')

async function waitFor(read) {
  for (let attempt = 0; attempt < 325; attempt++) {
    const value = await read()
    if (value) return value
    await delay(40)
  }
  throw new Error("The simulation did not reach the expected state.")
}

async function click(frame, x, y) {
  const bounds = frame.getBoundingClientRect()
  const response = await fetch("/test-click", {
    method: "POST", body: JSON.stringify([bounds.x + x * bounds.width, bounds.y + y * bounds.height]),
  })
  check(response.ok, await response.text())
}

const readSimulation = widget => waitFor(async () => {
  try {
    const state = await widget.getSimulationState()
    return state.snapshot.build.startsWith(widget.type + "@") && state
  }
  catch {
    return false
  }
})

async function run() {
  const widget = document.createElement("webwriter-phet-simulation")
  widget.setAttribute("contenteditable", "")
  widget.innerHTML = '<script type="application/json" slot="data">null</script>'
  const container = document.createElement("section")
  container.append(widget)
  document.body.append(container)
  await waitFor(() => widget.options.enabledScreens?.disabled === false)
  const initial = await widget.getSimulationState()
  same(initial.preferences.enabledScreens, ["first-law", "second-law", "third-law", "all-laws"], "Default screens")
  check(!widget.actions && !widget.options.locale && !widget.constructor.optionGroups.state, "Unexpected state or language controls")
  container.lang = "de-Latn-AT"
  same((await widget.getSimulationState()).preferences.locale, "de", "Inherited language fallback")
  widget.lang = "fr"
  same((await widget.getSimulationState()).preferences.locale, "fr", "Widget language override")
  widget.removeAttribute("lang")
  same((await widget.getSimulationState()).preferences.locale, "de", "Removing lang restored inheritance")
  container.removeAttribute("lang")
  document.documentElement.lang = "fr"
  same((await widget.getSimulationState()).preferences.locale, "fr", "Document language change")
  widget.lang = ""
  same((await widget.getSimulationState()).preferences.locale, initial.preferences.locale, "Empty lang did not use the default")
  document.documentElement.lang = "en"
  let frame = widget.shadowRoot.querySelector("iframe")
  const dimensions = element => [element.clientWidth, element.clientHeight]
  same(dimensions(frame), dimensions(widget), "Iframe fills the widget")
  const defaultHeight = widget.clientHeight
  container.style.width = "520px"
  same(dimensions(widget), [520, defaultHeight], "Narrowing the widget leaves its height unchanged")
  widget.style.height = "480px"
  same(dimensions(frame), [520, 480], "Iframe follows authored height independently of width")
  widget.style.height = "240px"
  same(dimensions(widget), [520, 300], "Widget minimum height")
  same(dimensions(frame), [520, 300], "Iframe fills the widget at its minimum height")
  widget.style.maxWidth = "440px"
  same(dimensions(widget), [460, 300], "Widget minimum width")
  same(dimensions(frame), [460, 300], "Iframe fills the widget at its minimum width")
  widget.style.removeProperty("max-width")
  widget.style.removeProperty("height")
  container.style.removeProperty("width")
  const block = dataBlock(widget)
  const savedText = block.firstChild
  same(savedText.data, "null", "Initial load created an unnecessary checkpoint")

  const snapshot = structuredClone(initial.snapshot)
  snapshot.activeScreen = "second-law"
  snapshot.screens["second-law"].controls.divisions = 6
  snapshot.screens["second-law"].display.timeValues = true
  snapshot.screens["second-law"].timing.time = 1.25
  snapshot.screens["second-law"].orbit.position = [2.5, 0.25]
  snapshot.screens["second-law"].orbit.velocity = [-2, 14]
  snapshot.screens["third-law"].orbit.sunMass = 250
  savedText.data = JSON.stringify(snapshot)

  const applied = await widget.getSimulationState()
  same(applied.snapshot.activeScreen, "second-law", "Active screen")
  same(applied.snapshot.screens["second-law"].controls.divisions, 6, "Period divisions")
  same(applied.snapshot.screens["second-law"].display.timeValues, true, "View flags")
  same(applied.snapshot.screens["second-law"].timing.time, 1.25, "Model time")
  same(applied.snapshot.screens["second-law"].orbit.position, [2.5, 0.25], "Planet position")
  same(applied.snapshot.screens["second-law"].orbit.velocity, [-2, 14], "Planet velocity")
  same(applied.snapshot.screens["third-law"].orbit.sunMass, 250, "Inactive screen orbit")

  savedText.data = JSON.stringify({...snapshot, build: "keplers-laws@1.2.11-webwriter.1"})
  same((await widget.getSimulationState()).snapshot, snapshot, "The original Kepler build's checkpoint still restores")

  const running = structuredClone(snapshot)
  running.screens["second-law"].timing.playing = true
  savedText.data = JSON.stringify(running)
  const time = async () => (await widget.getSimulationState()).snapshot.screens["second-law"].timing.time
  await waitFor(async () => (await time()) > 1.3)
  savedText.data = JSON.stringify(snapshot)
  same(await time(), 1.25, "Replacing block data did not rewind the running orbit")

  widget.setAttribute("enabled-screens", '["third-law","first-law"]')
  widget.lang = "de"
  widget.setAttribute("color-profile", "projector")
  widget.setAttribute("audio", "muted")
  widget.setAttribute("more-orbital-data", "")
  const configured = await widget.getSimulationState()
  same(configured.preferences, {
    enabledScreens: ["third-law", "first-law"],
    locale: "de",
    colorProfile: "projector",
    audio: "muted",
    moreOrbitalData: true,
  }, "Runtime preferences")
  same(configured.snapshot.activeScreen, "third-law", "Disabled-screen fallback")
  same(configured.snapshot.screens["second-law"].controls.divisions, 6, "Hidden screen retained")
  check(frame === widget.shadowRoot.querySelector("iframe"), "Preference changes reloaded the simulation")
  document.getSelection().setPosition(container, 0)
  const previous = savedText.data
  await click(frame, 0.46, 0.86) // Play on the Third Law screen.
  await waitFor(() => widget.shadowRoot.activeElement === frame)
  check(document.getSelection().isCollapsed, "Simulation input created a document range selection")
  const started = await waitFor(() => {
    const value = savedText.data
    return value && value !== previous && JSON.parse(value).screens["third-law"].timing.playing && value
  })
  const periodic = await waitFor(() => {
    const value = savedText.data
    return value !== started && value
  })
  check(JSON.parse(periodic).screens["third-law"].timing.time > JSON.parse(started).screens["third-law"].timing.time,
    "Continuous playback did not advance the saved checkpoint")

  // WebWriter undo/redo restores the authored data. Applying a running
  // checkpoint must not start a new save loop or destroy the redo entry.
  savedText.data = started
  await delay(10500)
  same(savedText.data, started, "Playback overwrote a checkpoint applied by history")
  await click(frame, 0.46, 0.86) // Pause, which also re-arms automatic saving.
  const checkpoint = await waitFor(() => {
    const value = savedText.data
    return value && value !== started && !JSON.parse(value).screens["third-law"].timing.playing && value
  })
  same(JSON.parse(checkpoint).activeScreen, "third-law", "Captured active screen")

  widget.type = "blackbody-spectrum"
  const spectrum = await readSimulation(widget)
  same(spectrum.preferences, {enabledScreens: ["spectrum"], locale: "de", colorProfile: "projector", audio: "muted"},
    "General settings followed the type change")
  check(!widget.options.enabledScreens && !widget.options.moreOrbitalData, "Kepler settings leaked into another simulation")
  same(savedText.data, checkpoint, "Switching simulations overwrote the Kepler checkpoint")

  widget.type = "ohms-law"
  same((await readSimulation(widget)).preferences.colorProfile, "default",
    "Ohm's Law uses its default when projector mode is unavailable")
  same(widget.colorProfile, "projector", "Switching to a sim without projector mode lost the general setting")

  widget.removeAttribute("type")
  await waitFor(() => widget.options.enabledScreens?.disabled === false)
  frame = widget.shadowRoot.querySelector("iframe")
  const switchedBack = await widget.getSimulationState()
  same(switchedBack.snapshot, JSON.parse(checkpoint), "Switching back restored the Kepler checkpoint")
  same(switchedBack.preferences, configured.preferences, "Switching back restored general and Kepler settings")

  const incompatible = {...JSON.parse(checkpoint), schemaVersion: 2}
  savedText.data = JSON.stringify(incompatible)
  widget.setAttribute("audio", "enabled")
  const unaffected = await widget.getSimulationState()
  same(unaffected.snapshot.screens["second-law"].controls.divisions, 6, "An incompatible snapshot changed the model")
  same(unaffected.preferences.audio, "enabled", "An incompatible snapshot blocked a preference update")
  const status = widget.shadowRoot.querySelector("output")
  await waitFor(() => !status.hidden)
  check(Math.abs(frame.clientHeight + status.clientHeight - widget.clientHeight) <= 1,
    "The status and iframe fit inside the widget")
  savedText.data = checkpoint
  widget.setAttribute("audio", "muted")

  // The normal document serialization contains only the authored checkpoint and preferences.
  const html = widget.outerHTML
  check(!html.includes("<iframe"), "The simulation frame leaked into authored HTML")
  check(!widget.hasAttribute("snapshot") && dataBlock(widget) === block, "Checkpoint did not stay in the authored block")
  widget.remove()
  document.body.insertAdjacentHTML("beforeend", html.replace(' contenteditable=""', ""))
  const reopened = document.querySelector("webwriter-phet-simulation")
  await waitFor(async () => {
    try { return (await reopened.getSimulationState()).preferences.locale === "de" }
    catch { return false }
  })
  same((await reopened.getSimulationState()).snapshot.screens["second-law"].controls.divisions, 6, "Reopened checkpoint")
  await click(reopened.shadowRoot.querySelector("iframe"), 0.46, 0.86)
  await waitFor(async () => (await reopened.getSimulationState()).snapshot.screens["third-law"].timing.playing)
  await delay(850)
  same(dataBlock(reopened).textContent, checkpoint, "Learner interaction edited the authored checkpoint")

  reopened.setAttribute("enabled-screens", '["first-law","second-law","third-law","all-laws"]')
  dataBlock(reopened).textContent = "null"
  const restored = await reopened.getSimulationState()
  same(restored.snapshot.activeScreen, initial.snapshot.activeScreen, "Initial active screen")
  same(restored.snapshot.screens["second-law"].controls.divisions, initial.snapshot.screens["second-law"].controls.divisions,
    "Undo of the first checkpoint restores the initial experiment")
  same(restored.preferences.locale, "de", "Snapshot restore leaves authored preferences in place")

  reopened.remove()
  const legacy = document.createElement("webwriter-phet-simulation")
  legacy.setAttribute("snapshot", checkpoint)
  legacy.setAttribute("locale", "de")
  legacy.setAttribute("contenteditable", "")
  document.body.append(legacy)
  await waitFor(() => legacy.options.enabledScreens?.disabled === false)
  const legacyState = await legacy.getSimulationState()
  same(legacyState.preferences.locale, "de", "Legacy authored language")
  same(legacyState.snapshot.activeScreen, initial.snapshot.activeScreen, "Obsolete snapshot attribute affected the simulation")
  legacy.lang = "fr"
  same((await legacy.getSimulationState()).preferences.locale, "fr", "Standard lang overrides the legacy setting")
  legacy.setAttribute("enabled-screens", '["third-law"]')
  await legacy.getSimulationState()
  await click(legacy.shadowRoot.querySelector("iframe"), 0.46, 0.86)
  await waitFor(() => dataBlock(legacy))
  same(legacy.getAttribute("snapshot"), checkpoint, "An automatic save modified the obsolete attribute")
  legacy.remove()
}

async function runPilots() {
  const widget = document.createElement("webwriter-phet-simulation")
  widget.contentEditable = "true"
  widget.type = "ohms-law"
  widget.lang = "de"
  widget.setAttribute("audio", "muted")
  widget.setAttribute("color-profile", "projector")
  document.body.append(widget)

  const checkpoint = type => widget.querySelector(`script[data-simulation="${type}"]`)

  const ohm = await readSimulation(widget)
  const resourceLoads = file => performance.getEntriesByType("resource")
    .filter(entry => new URL(entry.name).pathname === "/sims/" + file).length
  same(resourceLoads("runtime.js"), 1, "Shared runtime is loaded once")
  same(resourceLoads("pendulum-lab.js"), 0, "Unselected simulation was not loaded")
  same(ohm.preferences, {enabledScreens: ["circuit"], locale: "de", colorProfile: "default", audio: "muted"},
    "Ohm's Law applied supported shared settings")
  check(!widget.options.enabledScreens && widget.options.colorProfile.disabled, "Unsupported controls were available")
  const ohmState = structuredClone(ohm.snapshot)
  ohmState.screens.circuit = {voltage: 7, resistance: 250, currentUnit: "amps"}
  widget.insertAdjacentHTML("beforeend", '<script type="application/json" slot="data" data-simulation="ohms-law"></script>')
  const ohmBlock = checkpoint("ohms-law")
  ohmBlock.textContent = JSON.stringify(ohmState)
  same((await widget.getSimulationState()).snapshot, ohmState, "Ohm's Law restored all controls")
  ohmBlock.textContent = "null"
  same((await widget.getSimulationState()).snapshot, ohm.snapshot, "Removing the Ohm's Law checkpoint restored defaults")
  ohmBlock.textContent = JSON.stringify(ohmState)

  widget.type = "pendulum-lab"
  const pendulum = await readSimulation(widget)
  same(resourceLoads("runtime.js"), 1, "Switching reuses the shared runtime")
  same(resourceLoads("pendulum-lab.js"), 1, "Selection loaded the Pendulum Lab module")
  same(pendulum.preferences.enabledScreens, ["intro", "energy", "lab"], "Pendulum Lab screens")
  same(pendulum.preferences.locale, "de", "Language survived switching to Pendulum Lab")
  const pendulumState = structuredClone(pendulum.snapshot)
  pendulumState.activeScreen = "lab"
  const lab = pendulumState.screens.lab
  lab.playing = false
  Object.assign(lab.controls, {
    body: "custom", customGravity: 11, friction: 0.1, numberOfPendula: 2, timeSpeed: 0.125,
    velocityVisible: true, accelerationVisible: true, periodTraceVisible: true,
  })
  Object.assign(lab.pendula[0], {length: 0.8, mass: 1.2, angle: 0.5, angularVelocity: -0.8, thermalEnergy: 0.12})
  Object.assign(lab.pendula[0].trace, {
    visible: true, counterClockwise: true, firstAngle: 0.7, secondAngle: null, time: 0.6, points: 2,
  })
  Object.assign(lab.periodTimer, {running: true, time: 0.6})
  Object.assign(lab.stopwatch, {visible: true, time: 3.5, running: true})
  Object.assign(pendulumState.screens.energy.controls, {energyExpanded: true, energyZoom: 1.3})
  widget.insertAdjacentHTML("beforeend", '<script type="application/json" slot="data" data-simulation="pendulum-lab"></script>')
  const pendulumBlock = checkpoint("pendulum-lab")
  pendulumBlock.textContent = JSON.stringify(pendulumState)
  same((await widget.getSimulationState()).snapshot, pendulumState, "Pendulum Lab restored motion, tools, and display")

  widget.setAttribute("pendulum-lab-screens", '["intro"]')
  const hidden = await widget.getSimulationState()
  same(hidden.snapshot.activeScreen, "intro", "Hiding Lab selected a visible screen")
  same(hidden.snapshot.screens.lab, lab, "Hiding Lab preserved its experiment")
  widget.removeAttribute("pendulum-lab-screens")
  widget.type = "ohms-law"
  same((await readSimulation(widget)).snapshot, ohmState, "Returning to Ohm's Law restored its own checkpoint")
  same(checkpoint("pendulum-lab").textContent, JSON.stringify(pendulumState), "Switching preserved the other checkpoint")

  const markup = widget.outerHTML.replace('contenteditable="true"', 'type-test=""')
  widget.remove()
  document.body.insertAdjacentHTML("beforeend", markup)
  const reopened = document.querySelector("[type-test]")
  same((await readSimulation(reopened)).snapshot, ohmState, "Reader restored Ohm's Law from document HTML")
  reopened.type = "pendulum-lab"
  same((await readSimulation(reopened)).snapshot, pendulumState, "Reader restored Pendulum Lab from document HTML")
}

try {
  await run()
  await runPilots()
  await fetch("/test-result", {method: "POST", body: "{}"})
}
catch (error) {
  await fetch("/test-result", {method: "POST", body: JSON.stringify({error: error.stack ?? String(error)})})
}
