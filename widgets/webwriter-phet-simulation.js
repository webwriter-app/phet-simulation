import {adapters, defaultType} from "../sims/adapters.js"
import {hostedSource, supportsProjector} from "../sims/hosted.js"
import catalog from "../simulations.json" with {type: "json"}
const interactionSaveDelay = 650
const playbackSaveInterval = 10000

const snapshotSelector = ':scope > script[type="application/json"][slot="data"]:not([src])'
const preferenceAttributes = ["lang", "color-profile", "audio", ...[...adapters.values()].flatMap(adapter => [
  adapter.screenAttribute, ...Object.values(adapter.preferences).map(option => option.attribute),
])]
const choices = (values) => values.map(([value, label]) => ({value, label}))
const simulations = choices(Object.entries(catalog).map(([id, entry]) => [id, entry.title])
  .sort((a, b) => a[1].localeCompare(b[1], "en")))

function readJSON(value) {
  return value === null ? null : JSON.parse(value)
}

function frameSource(document, simulation) {
  const nonce = document.querySelector("script[nonce]")?.nonce
  if (!nonce) return simulation

  // The sandboxed document inherits WebWriter's CSP. Its bundled scripts use
  // the same nonce as the widget modules authorized by the document.
  const parsed = new DOMParser().parseFromString(simulation, "text/html")
  for (const script of parsed.scripts) script.setAttribute("nonce", nonce)
  return "<!doctype html>" + parsed.documentElement.outerHTML
}

export class WebWriterPhetSimulation extends HTMLElement {
  static observedAttributes = ["type", "locale", "contenteditable", ...preferenceAttributes]

  static optionGroups = {
    simulation: {label: "Simulation"},
    screens: {label: "Screens"},
    preferences: {label: "Preferences"},
  }

  #frame
  #frameType
  #status
  #window
  #port
  #readyTimer
  #capabilities
  #requests = new Map()
  #nextRequest = 0
  #scheduled = false
  #applyRevision = 0
  #lastSnapshot = null
  #lastPreferences
  #authoredObserver = new MutationObserver(() => this.#scheduleApply())
  #visibilityObserver
  #visible = false
  #saveDelay
  #saveTimer
  #saveRevision = 0

  constructor() {
    super()
    const shadow = this.attachShadow({mode: "open"})
    shadow.innerHTML = `
      <style>
        :host { display: block; min-width: 460px; height: 420px; min-height: 300px; }
        div { display: flex; flex-direction: column; height: 100%; }
        iframe { flex: 1 1 0; min-height: 0; border: 0; width: 100%; }
        output { display: block; padding: .4em .65em; font: inherit; }
        output[hidden] { display: none; }
      </style>
      <div><output role="status" hidden></output></div>
    `
    this.#status = shadow.querySelector("output")
  }

  connectedCallback() {
    this.#window = this.ownerDocument.defaultView
    this.#window.addEventListener("message", this.#onFrameReady)
    this.#authoredObserver.observe(this, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["slot", "type", "src", "data-simulation"],
    })
    for (let ancestor = this.parentElement; ancestor; ancestor = ancestor.parentElement) {
      this.#authoredObserver.observe(ancestor, {attributes: true, attributeFilter: ["lang"]})
    }
    this.#visibilityObserver = new IntersectionObserver(([entry]) => {
      if (!this.isConnected || this.#visible === entry.isIntersecting) return
      this.#visible = entry.isIntersecting
      this.#onVisibilityChange()
    })
    this.#visibilityObserver.observe(this)
    this.ownerDocument.addEventListener("visibilitychange", this.#onVisibilityChange)
    this.#scheduleApply()
  }

  disconnectedCallback() {
    this.#authoredObserver.disconnect()
    this.#visibilityObserver.disconnect()
    this.#visible = false
    this.ownerDocument.removeEventListener("visibilitychange", this.#onVisibilityChange)
    this.#window.removeEventListener("message", this.#onFrameReady)
    this.#unmountSimulation()
    this.#window = undefined
  }

  attributeChangedCallback(name, oldValue, value) {
    if (oldValue === value || !this.isConnected) return
    if (name === "contenteditable") {
      this.#scheduleSave()
      this.#refreshOptions()
    }
    else this.#scheduleApply()
  }

  get type() {
    return this.getAttribute("type") ?? defaultType
  }

  set type(value) {
    this.setAttribute("type", value)
  }

  get #adapter() {
    return adapters.get(this.type)
  }

  get enabledScreens() {
    const adapter = this.#adapter
    if (!adapter) return []
    const screenIds = adapter.screens.map(screen => screen.value)
    let values
    try {
      values = readJSON(this.getAttribute(adapter.screenAttribute))
    }
    catch {
      // Treat an unreadable screen list as the default.
    }
    const valid = Array.isArray(values) ? [...new Set(values.filter(value => screenIds.includes(value)))] : []
    return valid.length ? valid : [...screenIds]
  }

  #simulationLocale(locales, fallback = "en") {
    const language = this.getAttribute("lang") ?? this.getAttribute("locale") ??
      this.parentElement?.closest("[lang]")?.getAttribute("lang") ?? ""
    const parts = language.toLowerCase().replaceAll("_", "-").split("-")
    // New catalog entries may only have a title. Let the public build fall
    // back to English if it does not ship the requested language.
    if (!locales) return /^[a-z]{2,3}$/.test(parts[0]) ? parts[0] : fallback
    while (parts.length) {
      const tag = parts.join("-")
      const locale = locales.find(candidate => candidate.toLowerCase().replaceAll("_", "-") === tag)
      if (locale) return locale
      parts.pop()
    }
    return fallback
  }

  get colorProfile() {
    return this.getAttribute("color-profile") === "projector" ? "projector" : "default"
  }

  get audio() {
    return this.getAttribute("audio") === "muted" ? "muted" : "enabled"
  }

  get options() {
    const disabled = !this.isContentEditable
    const adapter = this.#adapter
    const options = {
      type: {
        label: "Simulation", attribute: "type", group: "simulation",
        type: "select", options: simulations, disabled,
      },
      colorProfile: {
        label: "Color profile", attribute: "color-profile", group: "preferences",
        type: "select", disabled: disabled || !(adapter || supportsProjector(this.type)),
        options: choices([["default", "Default"], ["projector", "Projector"]]),
      },
      audio: {
        label: "Audio", attribute: "audio", group: "preferences", type: "select", disabled,
        options: choices([["enabled", "Enabled"], ["muted", "Muted"]]),
      },
    }
    if (adapter) {
      const loading = disabled || !this.#capabilities
      options.enabledScreens = {
        label: "Enabled screens", attribute: adapter.screenAttribute, group: "screens",
        type: "select", control: "tree", multiple: true, options: adapter.screens, disabled: loading,
        description: "Choose the screens learners can open. Clearing the selection enables all screens.",
      }
      for (const [name, option] of Object.entries(adapter.preferences)) {
        options[name] = {...option, group: "preferences", disabled: loading}
      }
    }
    return options
  }

  /** Reads the live model and preferences without editing the document. */
  async getSimulationState() {
    // Queue authored changes even if their mutation observer has not run yet.
    this.#scheduleApply()
    await Promise.resolve()
    if (!this.#adapter) throw new Error("This simulation does not provide checkpoints.")
    return this.#request("read")
  }

  #mountSimulation() {
    this.#unmountSimulation()
    const type = this.#frameType = this.type
    this.#setStatus("")
    this.#refreshOptions()
    if (!Object.hasOwn(catalog, type)) {
      this.#setStatus("Choose a PhET simulation from the Simulation setting.")
      return
    }

    const iframe = this.ownerDocument.createElement("iframe")
    iframe.title = catalog[type].title
    iframe.sandbox.add("allow-scripts", "allow-popups", "allow-popups-to-escape-sandbox")
    const adapter = this.#adapter
    if (!adapter) iframe.sandbox.add("allow-same-origin")
    this.#frame = iframe
    this.#status.after(iframe)
    if (!adapter) return

    this.#readyTimer = this.#window.setTimeout(() => {
      this.#setStatus(`${iframe.title} did not start. Reload the document to try again.`)
    }, 20000)
    adapter.load().then(({default: simulation}) => {
      if (iframe === this.#frame) iframe.srcdoc = frameSource(this.ownerDocument, simulation)
    }).catch(() => {
      if (iframe !== this.#frame) return
      this.#window.clearTimeout(this.#readyTimer)
      this.#setStatus(`${iframe.title} could not be loaded.`)
    })
  }

  #unmountSimulation() {
    this.#scheduleSave()
    this.#window.clearTimeout(this.#readyTimer)
    this.#closePort()
    this.#frame?.remove()
    this.#frame = undefined
    this.#frameType = undefined
  }

  #onFrameReady = event => {
    const bridge = this.#adapter?.bridge
    if (!bridge || this.#frameType !== this.type) return
    if (this.#port || event.source !== this.#frame?.contentWindow || event.origin !== "null" ||
        event.data?.bridge !== bridge || event.data.type !== "ready") return

    const channel = new MessageChannel()
    this.#port = channel.port1
    channel.port1.onmessage = ({data}) => {
      if (this.#port !== channel.port1 || this.#frameType !== this.type) return
      if (data?.type === "connected") {
        this.#window.clearTimeout(this.#readyTimer)
        this.#capabilities = data.capabilities
        this.#setStatus("")
        this.#refreshOptions()
        this.#scheduleApply()
      }
      else if (data?.type === "input-start") {
        this.#scheduleSave()
      }
      else if (data?.type === "input-end" && this.isContentEditable) {
        // Focusing the frame lets WebWriter capture the widget through shadow
        // focus. Wait until the gesture ends since capture can scroll it into view.
        if (this.shadowRoot.activeElement !== this.#frame) this.#frame.focus({preventScroll: true})
        this.#scheduleSave(interactionSaveDelay)
      }
      else {
        const pending = this.#requests.get(data?.id)
        if (!pending) return
        this.#requests.delete(data.id)
        this.#window.clearTimeout(pending.timer)
        if (data.error) pending.reject(new Error(data.error))
        else pending.resolve(data.value)
      }
    }
    // An opaque-origin frame requires a wildcard target. The source and the
    // one-time handshake above bind the private port to this iframe.
    event.source.postMessage({bridge, type: "connect"}, "*", [channel.port2])
  }

  #closePort() {
    this.#port?.close()
    this.#port = undefined
    this.#capabilities = undefined
    this.#lastPreferences = undefined
    this.#lastSnapshot = null
    for (const pending of this.#requests.values()) {
      this.#window.clearTimeout(pending.timer)
      pending.reject(new Error("The simulation disconnected."))
    }
    this.#requests.clear()
  }

  #request(type, value) {
    if (!this.#capabilities) return Promise.reject(new Error("The simulation is still loading."))
    const id = ++this.#nextRequest
    return new Promise((resolve, reject) => {
      const timer = this.#window.setTimeout(() => {
        this.#requests.delete(id)
        reject(new Error("The simulation did not respond."))
      }, 5000)
      this.#requests.set(id, {resolve, reject, timer})
      this.#port.postMessage({id, type, value})
    })
  }

  #onVisibilityChange = () => this.#scheduleSave(this.#saveDelay)

  #canSave() {
    return this.isConnected && this.isContentEditable && this.#capabilities &&
      this.#visible && !this.ownerDocument.hidden
  }

  #scheduleSave(delay) {
    const revision = ++this.#saveRevision
    this.#window?.clearTimeout(this.#saveTimer)
    this.#saveDelay = delay
    if (delay !== undefined && this.#canSave()) {
      this.#saveTimer = this.#window.setTimeout(() => void this.#saveSnapshot(revision), delay)
    }
  }

  async #saveSnapshot(revision) {
    if (revision !== this.#saveRevision || !this.#canSave()) return
    const authored = this.#readSnapshot()
    try {
      const {snapshot} = await this.getSimulationState()
      // Undo, redo, remote edits and newer input invalidate a pending read.
      if (revision !== this.#saveRevision || !this.#canSave() || authored !== this.#readSnapshot()) return
      const serialized = JSON.stringify(snapshot).replaceAll("<", "\\u003c")
      if (serialized !== (authored ?? this.#capabilities.initialSnapshot)) {
        this.#lastSnapshot = serialized
        this.#writeSnapshot(serialized)
      }
      const playing = this.#adapter.isPlaying(snapshot)
      this.#scheduleSave(playing ? playbackSaveInterval : undefined)
    }
    catch {
      if (revision === this.#saveRevision) this.#scheduleSave()
    }
  }

  #readSnapshot() {
    const value = this.#snapshotBlock()?.textContent.trim()
    return !value || value === "null" ? null : value
  }

  #snapshotBlock() {
    return [...this.querySelectorAll(snapshotSelector)]
      .find(block => (block.getAttribute("data-simulation") ?? defaultType) === this.type)
  }

  #writeSnapshot(snapshot) {
    const existing = this.#snapshotBlock()
    const block = existing ?? this.ownerDocument.createElement("script")
    if (block.childNodes.length === 1 && block.firstChild.nodeType === Node.TEXT_NODE) {
      block.firstChild.data = snapshot
    }
    else block.textContent = snapshot
    if (!existing) {
      block.type = "application/json"
      block.slot = "data"
      if (this.type !== defaultType) block.setAttribute("data-simulation", this.type)
      this.append(block)
    }
  }

  #readPreferences() {
    return JSON.stringify({
      enabledScreens: this.enabledScreens,
      locale: this.#simulationLocale(this.#capabilities.locales, this.#capabilities.defaults.locale),
      colorProfile: this.colorProfile,
      audio: this.audio,
      ...Object.fromEntries(Object.entries(this.#adapter.preferences).map(([name, option]) =>
        [name, this.hasAttribute(option.attribute)])),
    })
  }

  #scheduleApply() {
    if (this.#scheduled || !this.isConnected) return
    this.#scheduled = true
    queueMicrotask(() => {
      this.#scheduled = false
      if (!this.isConnected) return
      if (this.#frameType !== this.type) this.#mountSimulation()
      if (!this.#adapter && this.#frame) {
        const {translations} = catalog[this.type]
        const source = hostedSource(this.type, {
          locale: this.#simulationLocale(translations && Object.keys(translations)),
          audio: this.audio, colorProfile: this.colorProfile,
        })
        if (this.#frame.src !== source) this.#frame.src = source
      }
      if (!this.#capabilities) return
      const snapshot = this.#readSnapshot()
      const preferences = this.#readPreferences()
      if (snapshot === this.#lastSnapshot && preferences === this.#lastPreferences) return
      this.#scheduleSave()
      const port = this.#port
      const changes = []
      if (preferences !== this.#lastPreferences) {
        this.#lastPreferences = preferences
        changes.push(this.#request("apply", {preferences: JSON.parse(preferences)}))
      }
      if (snapshot !== this.#lastSnapshot) {
        this.#lastSnapshot = snapshot
        try {
          changes.push(this.#request("apply", {snapshot: readJSON(snapshot)}))
        }
        catch {
          changes.push(Promise.reject(new Error("The saved simulation snapshot is invalid.")))
        }
      }
      const revision = ++this.#applyRevision
      Promise.allSettled(changes).then(results => {
        if (port !== this.#port || revision !== this.#applyRevision) return
        const failure = results.find(result => result.status === "rejected")
        this.#setStatus(failure?.reason.message ?? "")
      })
    })
  }

  #setStatus(message) {
    this.#status.textContent = message
    this.#status.hidden = !message
  }

  #refreshOptions() {
    this.dispatchEvent(new Event("optionschange", {bubbles: true}))
  }
}

customElements.define("webwriter-phet-simulation", WebWriterPhetSimulation)
