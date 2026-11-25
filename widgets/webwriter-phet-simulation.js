import {adapters, defaultType} from "../sims/adapters.js"
import catalog from "../sims/catalog.js"
import {canonicalLocale, drawerText, matchSimulationLocale, simulationTitle} from "../localization/drawer.js"
const interactionSaveDelay = 650
const playbackSaveInterval = 10000
const playbackCheckpointBudget = 64 * 1024 // characters per second

const snapshotSelector = ':scope > script[type="application/json"][slot="data"]:not([src])'
const simulationType = element => element.getAttribute("type") ?? defaultType
const preferenceAttributes = ["lang", "color-profile", "audio", "region-and-culture", ...[...adapters.values()].flatMap(adapter => [
  adapter.screenAttribute, ...Object.values(adapter.preferences ?? {}).map(option => option.attribute),
].filter(Boolean))]
const choices = (values) => values.map(([value, label]) => ({value, label}))
const regionNames = {
  usa: "United States", africa: "Africa", africaModest: "Africa (modest dress)", asia: "Asia",
  latinAmerica: "Latin America", oceania: "Oceania", random: "Random",
}

function readJSON(value) {
  return value === null ? null : JSON.parse(value)
}

function languageChoices(locales, language) {
  const labels = new Intl.DisplayNames([language], {type: "language"})
  return locales.map(value => {
    let label = value
    try { label = labels.of(canonicalLocale(value)) ?? value }
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

/**
 * Embed an interactive PhET simulation and save experiment checkpoints in the document.
 * See the [usage guide](USAGE.md) for authoring, preferences, and checkpoints.
 *
 * @attr {string} type - Simulation ID from the catalog. Defaults to keplers-laws.
 * @attr {string} lang - Simulation language. Inherits the document language when omitted.
 * @attr {string} audio - Set to muted to turn off simulation audio.
 * @attr {string} color-profile - Set to projector for the projection color profile, where available.
 * @attr {string} region-and-culture - Region and culture setting, where available.
 */
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
  #switchingPort
  #drawerLocale
  #simulationChoices

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

  static offlineImports(element) {
    const type = simulationType(element)
    return [{
      importer: "../sims/bundled.js",
      keep: adapters.has(type) ? [`./${type}.js`] : [],
    }]
  }

  get type() {
    return simulationType(this)
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

  get #language() {
    return this.getAttribute("lang") ?? this.getAttribute("locale") ??
      this.parentElement?.closest("[lang]")?.getAttribute("lang") ?? "en"
  }

  get optionGroups() {
    return Object.fromEntries(Object.entries(WebWriterPhetSimulation.optionGroups).map(([key, {label}]) =>
      [key, {label: drawerText(label, this.#language)}]))
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
    const language = this.#language
    const locale = canonicalLocale(language)
    const translate = text => drawerText(text, language, this.type)
    if (this.#simulationChoices?.locale !== language) {
      const titles = Object.entries(catalog).map(([type, title]) => [type, simulationTitle(type, language, title)])
      const collator = new Intl.Collator(locale)
      this.#simulationChoices = {locale: language, options: choices(titles.sort((a, b) => collator.compare(a[1], b[1])))}
    }
    const disabled = !this.isContentEditable
    const adapter = this.#adapter
    const projector = this.#capabilities?.colorProfiles.includes("projector")
    const options = {
      type: {
        label: translate("Simulation"), attribute: "type", group: "simulation",
        type: "select", options: this.#simulationChoices.options, disabled,
      },
      colorProfile: {
        label: translate("Color profile"), attribute: "color-profile", group: "preferences",
        type: "select", disabled: disabled || !projector,
        options: choices([["default", translate("Default")], ["projector", translate("Projector")]]),
      },
      audio: {
        label: translate("Audio"), attribute: "audio", group: "preferences", type: "select", disabled,
        options: choices([["enabled", translate("Enabled")], ["muted", translate("Muted")]]),
      },
    }
    const loading = disabled || !this.#capabilities
    const regions = this.#capabilities?.regions ?? []
    if (regions.length > 1) {
      options.regionAndCulture = {
        label: translate("Region and culture"), attribute: "region-and-culture", group: "preferences", type: "select", disabled,
        options: choices(regions.map(region => [region, translate(regionNames[region] ?? region)])),
      }
    }
    const screens = this.#capabilities?.screens ?? []
    if (adapter?.screenAttribute && screens.length > 1) {
      options.enabledScreens = {
        label: translate("Enabled screens"), attribute: adapter.screenAttribute, group: "screens",
        type: "select", control: "tree", multiple: true, options: screens, disabled: loading,
        description: translate("Choose the screens learners can open. Clearing the selection enables all screens."),
      }
    }
    for (const [name, option] of Object.entries(adapter?.preferences ?? {})) {
      const optionChoices = option.runtimeLocales ? languageChoices(this.#capabilities?.locales ?? [], locale) :
        option.options?.map(choice => ({...choice, label: translate(choice.label)}))
      options[name] = {
        ...option, label: translate(option.label), ...(optionChoices ? {options: optionChoices} : {}),
        group: "preferences", disabled: loading,
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
    if (this.#frameType !== this.type) throw new Error("The simulation is still loading.")
    return this.#request("read")
  }

  #mountSimulation() {
    this.#unmountSimulation()
    const type = this.#frameType = this.type
    this.#setStatus("")
    this.#refreshOptions()
    if (!Object.hasOwn(catalog, type)) {
      this.#setStatus(this.#statusText("Choose a PhET simulation from the Simulation setting."))
      return
    }
    const adapter = this.#adapter
    if (!adapter) {
      this.#setStatus(this.#statusText("{0} is not included in this build.", simulationTitle(type, this.#language, catalog[type])))
      return
    }

    const iframe = this.ownerDocument.createElement("iframe")
    iframe.title = simulationTitle(type, this.#drawerLocale, catalog[type])
    iframe.allowFullscreen = true
    iframe.sandbox.add("allow-scripts", "allow-popups", "allow-popups-to-escape-sandbox")
    this.#frame = iframe
    this.#status.after(iframe)

    this.#readyTimer = this.#window.setTimeout(() => {
      this.#setStatus(this.#statusText("{0} did not start. Reload the document to try again.", iframe.title))
    }, 20000)
    adapter.load().then(({default: simulation}) => {
      if (iframe === this.#frame && type === this.type) {
        const html = typeof simulation === "function" ? simulation() : simulation
        iframe.srcdoc = frameSource(this.ownerDocument, html, matchSimulationLocale(this.#language, frameLocales(html)))
      }
    }).catch(error => {
      if (iframe !== this.#frame) return
      this.#window.clearTimeout(this.#readyTimer)
      this.#setStatus(error?.name === "OfflineImportError"
        ? this.#statusText("{0} is not included in this offline document.", iframe.title)
        : this.#statusText("{0} could not be loaded.", iframe.title))
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
      if (this.#port !== channel.port1) return
      if (this.#switchingPort && !this.#requests.has(data?.id)) return
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
      else if (data?.type === "screens") {
        this.#capabilities.screens = data.screens
        this.#refreshOptions()
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
    this.#switchingPort = undefined
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

  #onVisibilityChange = () => {
    if (!this.#switchingPort) this.#scheduleSave(this.#saveDelay)
  }

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

  async #saveSnapshot(revision, switching = false) {
    const type = this.#frameType
    const canSave = () => revision === this.#saveRevision && this.#frameType === type &&
      (switching ? this.isConnected && this.isContentEditable && this.#capabilities : this.#canSave())
    if (!canSave()) return
    const authored = this.#readSnapshot(type)
    if (switching && authored !== this.#lastSnapshot) return
    try {
      const {snapshot, playing} = await (switching ? this.#request("read") : this.getSimulationState())
      // Undo, redo, remote edits and newer input invalidate a pending read.
      if (!canSave() || authored !== this.#readSnapshot(type)) return
      const serialized = JSON.stringify(snapshot).replaceAll("<", "\\u003c")
      if (serialized !== (authored ?? this.#capabilities.initialSnapshot)) {
        this.#lastSnapshot = serialized
        this.#writeSnapshot(serialized, type)
      }
      // Large experiments (for example, accumulated detector hits) should not
      // fill undo history with several megabytes every ten seconds.
      const interval = Math.max(playbackSaveInterval, 1000 * serialized.length / playbackCheckpointBudget)
      if (type === this.type) this.#scheduleSave(playing ? interval : undefined)
    }
    catch {
      if (revision === this.#saveRevision && type === this.type) this.#scheduleSave()
    }
  }

  #flushBeforeSwitch() {
    if (this.#saveDelay !== interactionSaveDelay || !this.isContentEditable || !this.#capabilities) return false
    const port = this.#switchingPort = this.#port
    this.#scheduleSave()
    void this.#saveSnapshot(this.#saveRevision, true).finally(() => {
      if (this.#switchingPort !== port) return
      this.#switchingPort = undefined
      this.#scheduleApply()
    })
    return true
  }

  #readSnapshot(type) {
    const value = this.#snapshotBlock(type)?.textContent.trim()
    return !value || value === "null" ? null : value
  }

  #snapshotBlock(type = this.type) {
    return [...this.querySelectorAll(snapshotSelector)]
      .find(block => (block.getAttribute("data-simulation") ?? defaultType) === type)
  }

  #writeSnapshot(snapshot, type) {
    const existing = this.#snapshotBlock(type)
    const block = existing ?? this.ownerDocument.createElement("script")
    if (block.childNodes.length === 1 && block.firstChild.nodeType === Node.TEXT_NODE) {
      block.firstChild.data = snapshot
    }
    else block.textContent = snapshot
    if (!existing) {
      block.type = "application/json"
      block.slot = "data"
      if (type !== defaultType) block.setAttribute("data-simulation", type)
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
      locale: matchSimulationLocale(this.#language, this.#capabilities.locales),
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
      if (!this.isConnected || this.#switchingPort) return
      const language = this.#language
      if (language !== this.#drawerLocale) {
        this.#drawerLocale = language
        if (this.#frame && this.#frameType === this.type) {
          this.#frame.title = simulationTitle(this.type, language, catalog[this.type])
        }
        this.#refreshOptions()
      }
      if (this.#frameType !== this.type) {
        if (this.#flushBeforeSwitch()) return
        this.#mountSimulation()
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
          changes.push(Promise.reject(new Error(this.#statusText("The saved simulation snapshot is invalid."))))
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

  #statusText(message, title) {
    const text = drawerText(message, this.#language)
    return title === undefined ? text : text.replace("{0}", () => title)
  }

  #refreshOptions() {
    this.dispatchEvent(new Event("optionschange", {bubbles: true}))
  }
}

customElements.define("webwriter-phet-simulation", WebWriterPhetSimulation)
