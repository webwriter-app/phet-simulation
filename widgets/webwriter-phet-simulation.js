import simulation from "../sims/keplers-laws.js"

const bridge = "webwriter-keplers-laws/v1"
const interactionSaveDelay = 650
const playbackSaveInterval = 10000

const screens = [
  {value: "first-law", label: "First Law"},
  {value: "second-law", label: "Second Law"},
  {value: "third-law", label: "Third Law"},
  {value: "all-laws", label: "All Laws"},
]
const screenIds = screens.map(screen => screen.value)
const snapshotSelector = ':scope > script[type="application/json"][slot="data"]:not([src])'
const preferenceAttributes = ["enabled-screens", "lang", "color-profile", "audio", "more-orbital-data"]
const choices = (values) => values.map(([value, label]) => ({value, label}))

function readJSON(value) {
  return value === null ? null : JSON.parse(value)
}

function frameSource(document) {
  const nonce = document.querySelector("script[nonce]")?.nonce
  if (!nonce) return simulation

  // The sandboxed document inherits WebWriter's CSP. Its bundled scripts use
  // the same nonce as the widget modules authorized by the document.
  const parsed = new DOMParser().parseFromString(simulation, "text/html")
  for (const script of parsed.scripts) script.setAttribute("nonce", nonce)
  return "<!doctype html>" + parsed.documentElement.outerHTML
}

export class WebWriterPhetSimulation extends HTMLElement {
  static observedAttributes = ["snapshot", "locale", "contenteditable", ...preferenceAttributes]

  static optionGroups = {
    screens: {label: "Screens"},
    preferences: {label: "Preferences"},
  }

  #frame
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
        :host { display: block; min-inline-size: 0; }
        iframe { display: block; border: 0; width: 100%; height: auto; aspect-ratio: 8 / 5; }
        output { display: block; padding: .4em .65em; font: inherit; }
        output[hidden] { display: none; }
        small { display: block; margin-block-start: .35em; line-height: 1.4; }
        a { color: inherit; }
      </style>
      <output role="status">Loading Kepler’s Laws…</output>
      <small>Adapted from PhET Interactive Simulations, University of Colorado Boulder.
        <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener">CC BY-NC 4.0</a>
      </small>
    `
    this.#status = shadow.querySelector("output")
  }

  connectedCallback() {
    this.#window = this.ownerDocument.defaultView
    this.#window.addEventListener("message", this.#onFrameReady)
    this.#authoredObserver.observe(this, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["slot", "type", "src"],
    })
    for (let ancestor = this.parentElement; ancestor; ancestor = ancestor.parentElement) {
      this.#authoredObserver.observe(ancestor, {attributes: true, attributeFilter: ["lang"]})
    }
    const iframe = this.ownerDocument.createElement("iframe")
    iframe.title = "Kepler’s Laws · Adapted from PhET"
    iframe.sandbox.add("allow-scripts", "allow-popups", "allow-popups-to-escape-sandbox")
    iframe.srcdoc = frameSource(this.ownerDocument)
    this.#frame = iframe
    this.#setStatus("Loading Kepler’s Laws…")
    this.#status.after(iframe)
    this.#visibilityObserver = new IntersectionObserver(([entry]) => {
      if (!this.isConnected || this.#visible === entry.isIntersecting) return
      this.#visible = entry.isIntersecting
      this.#onVisibilityChange()
    })
    this.#visibilityObserver.observe(this)
    this.ownerDocument.addEventListener("visibilitychange", this.#onVisibilityChange)
    this.#readyTimer = this.#window.setTimeout(() => {
      this.#setStatus("Kepler’s Laws did not start. Reload the document to try again.")
    }, 20000)
  }

  disconnectedCallback() {
    this.#scheduleSave()
    this.#authoredObserver.disconnect()
    this.#visibilityObserver.disconnect()
    this.#visible = false
    this.ownerDocument.removeEventListener("visibilitychange", this.#onVisibilityChange)
    this.#window.removeEventListener("message", this.#onFrameReady)
    this.#window.clearTimeout(this.#readyTimer)
    this.#closePort()
    this.#frame.remove()
    this.#frame = undefined
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

  get enabledScreens() {
    let values
    try {
      values = readJSON(this.getAttribute("enabled-screens"))
    }
    catch {
      // Treat an unreadable screen list as the default.
    }
    const valid = Array.isArray(values) ? [...new Set(values.filter(value => screenIds.includes(value)))] : []
    return valid.length ? valid : [...screenIds]
  }

  #simulationLocale() {
    const language = this.getAttribute("lang") ?? this.getAttribute("locale") ??
      this.parentElement?.closest("[lang]")?.getAttribute("lang") ?? ""
    const parts = language.toLowerCase().replaceAll("_", "-").split("-")
    const locales = this.#capabilities.locales
    while (parts.length) {
      const tag = parts.join("-")
      const locale = locales.find(candidate => candidate.toLowerCase().replaceAll("_", "-") === tag)
      if (locale) return locale
      parts.pop()
    }
    return this.#capabilities.defaults.locale
  }

  get colorProfile() {
    return this.getAttribute("color-profile") === "projector" ? "projector" : "default"
  }

  get audio() {
    return this.getAttribute("audio") === "muted" ? "muted" : "enabled"
  }

  get moreOrbitalData() {
    return this.hasAttribute("more-orbital-data")
  }

  get options() {
    const disabled = !this.isContentEditable || !this.#capabilities
    return {
      enabledScreens: {
        label: "Enabled screens", attribute: "enabled-screens", group: "screens",
        type: "select", control: "tree", multiple: true, options: screens, disabled,
        description: "Choose the screens learners can open. Clearing the selection enables all screens.",
      },
      moreOrbitalData: {
        label: "More orbital data", attribute: "more-orbital-data", group: "preferences", type: Boolean, disabled,
      },
      colorProfile: {
        label: "Color profile", attribute: "color-profile", group: "preferences", type: "select", disabled,
        options: choices([["default", "Default"], ["projector", "Projector"]]),
      },
      audio: {
        label: "Audio", attribute: "audio", group: "preferences", type: "select", disabled,
        options: choices([["enabled", "Enabled"], ["muted", "Muted"]]),
      },
    }
  }

  /** Reads the live model and preferences without editing the document. */
  async getSimulationState() {
    // Queue authored changes even if their mutation observer has not run yet.
    this.#scheduleApply()
    await Promise.resolve()
    return this.#request("read")
  }

  #onFrameReady = event => {
    if (this.#port || event.source !== this.#frame?.contentWindow || event.origin !== "null" ||
        event.data?.bridge !== bridge || event.data.type !== "ready") return

    const channel = new MessageChannel()
    this.#port = channel.port1
    channel.port1.onmessage = ({data}) => {
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
      const playing = snapshot.screens[snapshot.activeScreen]?.timing.playing
      this.#scheduleSave(playing ? playbackSaveInterval : undefined)
    }
    catch {
      if (revision === this.#saveRevision) this.#scheduleSave()
    }
  }

  #readSnapshot() {
    const block = this.querySelector(snapshotSelector)
    const value = (block ? block.textContent : this.getAttribute("snapshot"))?.trim()
    return !value || value === "null" ? null : value
  }

  #writeSnapshot(snapshot) {
    const existing = this.querySelector(snapshotSelector)
    const block = existing ?? this.ownerDocument.createElement("script")
    if (block.childNodes.length === 1 && block.firstChild.nodeType === Node.TEXT_NODE) {
      block.firstChild.data = snapshot
    }
    else block.textContent = snapshot
    if (!existing) {
      block.type = "application/json"
      block.slot = "data"
      this.append(block)
    }
    this.removeAttribute("snapshot")
  }

  #readPreferences() {
    return JSON.stringify({
      enabledScreens: this.enabledScreens,
      locale: this.#simulationLocale(),
      colorProfile: this.colorProfile,
      audio: this.audio,
      moreOrbitalData: this.moreOrbitalData,
    })
  }

  #scheduleApply() {
    if (this.#scheduled || !this.#capabilities) return
    this.#scheduled = true
    queueMicrotask(() => {
      this.#scheduled = false
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
