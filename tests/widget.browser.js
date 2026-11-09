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

async function run() {
  const widget = document.createElement("webwriter-phet-simulation")
  widget.setAttribute("contenteditable", "")
  widget.innerHTML = '<script type="application/json" slot="data">null</script>'
  const container = document.createElement("section")
  container.append(widget)
  document.body.append(container)
  await waitFor(() => !widget.options.enabledScreens.disabled)
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
  const frame = widget.shadowRoot.querySelector("iframe")
  const dimensions = element => [element.clientWidth, element.clientHeight]
  same(dimensions(frame), dimensions(widget), "Iframe fills the widget")
  const defaultHeight = widget.clientHeight
  container.style.width = "360px"
  same(dimensions(widget), [360, defaultHeight], "Narrowing the widget leaves its height unchanged")
  widget.style.height = "480px"
  same(dimensions(frame), [360, 480], "Iframe follows authored height independently of width")
  widget.style.height = "240px"
  same(dimensions(widget), [360, 300], "Widget minimum height")
  same(dimensions(frame), [360, 300], "Iframe fills the widget at its minimum height")
  widget.style.maxWidth = "240px"
  same(dimensions(widget), [300, 300], "Widget minimum width")
  same(dimensions(frame), [300, 300], "Iframe fills the widget at its minimum width")
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
  await waitFor(() => !legacy.options.enabledScreens.disabled)
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
}

try {
  await run()
  await fetch("/test-result", {method: "POST", body: "{}"})
}
catch (error) {
  await fetch("/test-result", {method: "POST", body: JSON.stringify({error: error.stack ?? String(error)})})
}
