import {adapters, defaultType} from "../sims/adapters.js"
import catalog from "../sims/catalog.js"
const interactionSaveDelay = 650
const playbackSaveInterval = 10000
const playbackCheckpointBudget = 64 * 1024 // characters per second

const snapshotSelector = ':scope > script[type="application/json"][slot="data"]:not([src])'
const preferenceAttributes = ["lang", "color-profile", "audio", "region-and-culture", ...[...adapters.values()].flatMap(adapter => [
  adapter.screenAttribute, ...Object.values(adapter.preferences ?? {}).map(option => option.attribute),
].filter(Boolean))]
const choices = (values) => values.map(([value, label]) => ({value, label}))
const regionNames = {
  usa: "United States", africa: "Africa", africaModest: "Africa (modest dress)", asia: "Asia",
  latinAmerica: "Latin America", oceania: "Oceania", random: "Random",
}
const simulations = choices(Object.entries(catalog).sort((a, b) => a[1].localeCompare(b[1], "en")))

function readJSON(value) {
  return value === null ? null : JSON.parse(value)
}

function languageChoices(locales) {
  const labels = new Intl.DisplayNames(["en"], {type: "language"})
  return locales.map(value => {
    let label = value
    try { label = labels.of(value.replaceAll("_", "-")) ?? value }
    catch { /* Keep the original label for a nonstandard locale code. */ }
    return {value, label}
  })
}

function frameLocales(html) {
  // Use the locales actually bundled with this build, including any PhET
  // fallback translations. The catalog can list different release locales.
  const metadata = html.match(/^window\.phet\.chipper\.localeData = (\{[^\r\n]*\});/m)
  return metadata ? Object.keys(JSON.parse(metadata[1])) : ["en"]
}

function frameSource(document, simulation, locale) {
  // Some upstream controls read their strings only during construction.
  const initialLocale = JSON.stringify(locale).replaceAll("<", "\\u003c")
  const source = simulation.replace("window.phet.chipper.locale = 'en';",
    () => `window.phet.chipper.locale = ${initialLocale};`)
  const nonce = document.querySelector("script[nonce]")?.nonce
  if (!nonce) return source

  // The sandboxed document inherits WebWriter's CSP. Its bundled scripts use
  // the same nonce as the widget modules authorized by the document.
  const parsed = new DOMParser().parseFromString(source, "text/html")
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

  static {
    const names = new Set([...adapters.values()].flatMap(adapter => Object.keys(adapter.preferences ?? {})))
    for (const name of names) {
      Object.defineProperty(this.prototype, name, {get() { return this.#preferenceOptionValue(name) }})
    }
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
    const screenIds = this.#capabilities?.screens.map(screen => screen.value) ?? []
    const attribute = this.#adapter?.screenAttribute
    if (screenIds.length < 2 || !attribute) return screenIds
    let values
    try {
      values = readJSON(this.getAttribute(attribute))
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

  get regionAndCulture() {
    const region = this.getAttribute("region-and-culture")
    return this.#capabilities?.regions?.includes(region) ? region : this.#capabilities?.defaults.regionAndCulture
  }

  get options() {
    const disabled = !this.isContentEditable
    const adapter = this.#adapter
    const projector = this.#capabilities?.colorProfiles.includes("projector")
    const options = {
      type: {
        label: "Simulation", attribute: "type", group: "simulation",
        type: "select", options: simulations, disabled,
      },
      colorProfile: {
        label: "Color profile", attribute: "color-profile", group: "preferences",
        type: "select", disabled: disabled || !projector,
        options: choices([["default", "Default"], ["projector", "Projector"]]),
      },
      audio: {
        label: "Audio", attribute: "audio", group: "preferences", type: "select", disabled,
        options: choices([["enabled", "Enabled"], ["muted", "Muted"]]),
      },
    }
    const loading = disabled || !this.#capabilities
    const regions = this.#capabilities?.regions ?? []
    if (regions.length > 1) {
      options.regionAndCulture = {
        label: "Region and culture", attribute: "region-and-culture", group: "preferences", type: "select", disabled,
        options: choices(regions.map(region => [region, regionNames[region] ?? region])),
      }
    }
    const screens = this.#capabilities?.screens ?? []
    if (adapter?.screenAttribute && screens.length > 1) {
      options.enabledScreens = {
        label: "Enabled screens", attribute: adapter.screenAttribute, group: "screens",
        type: "select", control: "tree", multiple: true, options: screens, disabled: loading,
        description: "Choose the screens learners can open. Clearing the selection enables all screens.",
      }
    }
    for (const [name, option] of Object.entries(adapter?.preferences ?? {})) {
      const optionsForLocale = option.runtimeLocales && languageChoices(this.#capabilities?.locales ?? [])
      options[name] = {
        ...option, ...(optionsForLocale ? {options: optionsForLocale} : {}), group: "preferences", disabled: loading,
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
    const adapter = this.#adapter
    if (!adapter) {
      this.#setStatus(`${catalog[type]} is not included in this build.`)
      return
    }

    const iframe = this.ownerDocument.createElement("iframe")
    iframe.title = catalog[type]
    iframe.sandbox.add("allow-scripts", "allow-popups", "allow-popups-to-escape-sandbox")
    this.#frame = iframe
    this.#status.after(iframe)

    this.#readyTimer = this.#window.setTimeout(() => {
      this.#setStatus(`${iframe.title} did not start. Reload the document to try again.`)
    }, 20000)
    adapter.load().then(({default: simulation}) => {
      if (iframe === this.#frame && type === this.type) {
        const html = typeof simulation === "function" ? simulation() : simulation
        iframe.srcdoc = frameSource(this.ownerDocument, html, this.#simulationLocale(frameLocales(html)))
      }
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
      const {snapshot, playing} = await this.getSimulationState()
      // Undo, redo, remote edits and newer input invalidate a pending read.
      if (revision !== this.#saveRevision || !this.#canSave() || authored !== this.#readSnapshot()) return
      const serialized = JSON.stringify(snapshot).replaceAll("<", "\\u003c")
      if (serialized !== (authored ?? this.#capabilities.initialSnapshot)) {
        this.#lastSnapshot = serialized
        this.#writeSnapshot(serialized)
      }
      // Large experiments (for example, accumulated detector hits) should not
      // fill undo history with several megabytes every ten seconds.
      const interval = Math.max(playbackSaveInterval, 1000 * serialized.length / playbackCheckpointBudget)
      this.#scheduleSave(playing ? interval : undefined)
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

  #preferenceOptionValue(name) {
    const option = this.#adapter?.preferences?.[name]
    if (!option) return undefined
    if (option.type === Boolean) return this.hasAttribute(option.attribute)
    const attribute = this.getAttribute(option.attribute)
    const fallback = this.#capabilities?.defaults[name]
    if (option.type === "number") {
      const value = attribute?.trim() ? Number(attribute) : NaN
      return Number.isFinite(value) && value >= option.min && value <= option.max ? value : fallback ?? null
    }
    if (option.runtimeLocales ? this.#capabilities?.locales.includes(attribute) :
      option.options.some(choice => choice.value === attribute)) return attribute
    return fallback == null ? null : String(fallback)
  }

  #readPreferences() {
    const defaults = this.#capabilities.defaults
    return JSON.stringify({
      ...defaults,
      enabledScreens: this.enabledScreens,
      locale: this.#simulationLocale(this.#capabilities.locales, defaults.locale),
      colorProfile: this.#capabilities.colorProfiles.includes(this.colorProfile) ?
        this.colorProfile : defaults.colorProfile,
      audio: this.audio,
      ...(this.#capabilities.regions?.length > 1 ? {regionAndCulture: this.regionAndCulture} : {}),
      ...Object.fromEntries(Object.keys(this.#adapter.preferences ?? {}).map(name => {
        const value = this.#preferenceOptionValue(name)
        return [name, typeof defaults[name] === "number" ? Number(value) :
          typeof defaults[name] === "boolean" ? value === true || value === "true" : value]
      })),
    })
  }

  #scheduleApply() {
    if (this.#scheduled || !this.isConnected) return
    this.#scheduled = true
    queueMicrotask(() => {
      this.#scheduled = false
      if (!this.isConnected) return
      if (this.#frameType !== this.type) this.#mountSimulation()
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
