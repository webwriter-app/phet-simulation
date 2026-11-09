import "../widgets/webwriter-phet-simulation.js"

function check(condition, message) {
  if (!condition) throw new Error(message)
}

function same(actual, expected, message) {
  check(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`)
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

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
  document.body.append(widget)
  await waitFor(() => !widget.options.locale.disabled)
  const initial = await widget.getSimulationState()
  same(initial.preferences.enabledScreens, ["first-law", "second-law", "third-law", "all-laws"], "Default screens")
  check(widget.options.locale.options.some(({value}) => value === "de"), "Missing bundled German translation")
  const frame = widget.shadowRoot.querySelector("iframe")
  check(frame.clientWidth >= 600 && frame.clientHeight >= 350, "Incorrect iframe dimensions")
  check(!widget.hasAttribute("snapshot"), "Initial load created an unnecessary checkpoint")

  const snapshot = structuredClone(initial.snapshot)
  snapshot.activeScreen = "second-law"
  snapshot.screens["second-law"].controls.divisions = 6
  snapshot.screens["second-law"].display.timeValues = true
  snapshot.screens["second-law"].timing.time = 1.25
  snapshot.screens["second-law"].orbit.position = [2.5, 0.25]
  snapshot.screens["second-law"].orbit.velocity = [-2, 14]
  snapshot.screens["third-law"].orbit.sunMass = 250
  widget.setAttribute("snapshot", JSON.stringify(snapshot))

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
  widget.setAttribute("snapshot", JSON.stringify(running))
  const time = async () => (await widget.getSimulationState()).snapshot.screens["second-law"].timing.time
  await waitFor(async () => (await time()) > 1.3)
  await widget.restoreSnapshot()
  check((await time()) < 1.3, "Restore snapshot did not rewind the running orbit")
  widget.setAttribute("snapshot", JSON.stringify(snapshot))

  widget.setAttribute("enabled-screens", '["third-law","first-law"]')
  widget.setAttribute("locale", "de")
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
  const previous = widget.getAttribute("snapshot")
  await click(frame, 0.46, 0.86) // Play on the Third Law screen.
  const started = await waitFor(() => {
    const value = widget.getAttribute("snapshot")
    return value && value !== previous && JSON.parse(value).screens["third-law"].timing.playing && value
  })
  const periodic = await waitFor(() => {
    const value = widget.getAttribute("snapshot")
    return value !== started && value
  })
  check(JSON.parse(periodic).screens["third-law"].timing.time > JSON.parse(started).screens["third-law"].timing.time,
    "Continuous playback did not advance the saved checkpoint")

  // WebWriter undo/redo restores the authored attribute. Applying a running
  // checkpoint must not start a new save loop or destroy the redo entry.
  widget.setAttribute("snapshot", started)
  await delay(10500)
  same(widget.getAttribute("snapshot"), started, "Playback overwrote a checkpoint applied by history")
  await click(frame, 0.46, 0.86) // Pause, which also re-arms automatic saving.
  const checkpoint = await waitFor(() => {
    const value = widget.getAttribute("snapshot")
    return value && value !== started && !JSON.parse(value).screens["third-law"].timing.playing && value
  })
  same(JSON.parse(checkpoint).activeScreen, "third-law", "Captured active screen")

  const incompatible = {...JSON.parse(checkpoint), schemaVersion: 2}
  widget.setAttribute("snapshot", JSON.stringify(incompatible))
  widget.setAttribute("audio", "enabled")
  const unaffected = await widget.getSimulationState()
  same(unaffected.snapshot.screens["second-law"].controls.divisions, 6, "An incompatible snapshot changed the model")
  same(unaffected.preferences.audio, "enabled", "An incompatible snapshot blocked a preference update")
  widget.setAttribute("snapshot", checkpoint)
  widget.setAttribute("audio", "muted")

  // The normal document serialization contains only the authored checkpoint and preferences.
  const html = widget.outerHTML
  check(!html.includes("<iframe"), "The simulation frame leaked into authored HTML")
  widget.remove()
  document.body.insertAdjacentHTML("beforeend", html.replace(' contenteditable=""', ""))
  const reopened = document.querySelector("webwriter-phet-simulation")
  await waitFor(async () => {
    try { return (await reopened.getSimulationState()).preferences.locale === "de" }
    catch { return false }
  })
  check(reopened.actions.restoreSnapshot.disabled, "Read mode exposed the authoring action")
  same((await reopened.getSimulationState()).snapshot.screens["second-law"].controls.divisions, 6, "Reopened checkpoint")
  await click(reopened.shadowRoot.querySelector("iframe"), 0.46, 0.86)
  await waitFor(async () => (await reopened.getSimulationState()).snapshot.screens["third-law"].timing.playing)
  await delay(850)
  same(reopened.getAttribute("snapshot"), checkpoint, "Learner interaction edited the authored checkpoint")

  reopened.setAttribute("enabled-screens", '["first-law","second-law","third-law","all-laws"]')
  reopened.removeAttribute("snapshot")
  const restored = await reopened.getSimulationState()
  same(restored.snapshot.activeScreen, initial.snapshot.activeScreen, "Initial active screen")
  same(restored.snapshot.screens["second-law"].controls.divisions, initial.snapshot.screens["second-law"].controls.divisions,
    "Undo of the first checkpoint restores the initial experiment")
  same(restored.preferences.locale, "de", "Snapshot restore leaves authored preferences in place")
}

try {
  await run()
  await fetch("/test-result", {method: "POST", body: "{}"})
}
catch (error) {
  await fetch("/test-result", {method: "POST", body: JSON.stringify({error: error.stack ?? String(error)})})
}
