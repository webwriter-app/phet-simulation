import simulation from "../sims/keplers-laws.js"

const bridge = "webwriter-keplers-laws/v1"

const screens = [
  {value: "first-law", label: "First Law"},
  {value: "second-law", label: "Second Law"},
  {value: "third-law", label: "Third Law"},
  {value: "all-laws", label: "All Laws"},
]
const screenIds = screens.map(screen => screen.value)
const preferenceAttributes = ["enabled-screens", "locale", "color-profile", "audio", "more-orbital-data"]
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
  static observedAttributes = ["snapshot", "contenteditable", ...preferenceAttributes]

  static optionGroups = {
    state: {label: "Simulation state"},
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
    const iframe = this.ownerDocument.createElement("iframe")
    iframe.title = "Kepler’s Laws · Adapted from PhET"
    iframe.sandbox.add("allow-scripts", "allow-popups", "allow-popups-to-escape-sandbox")
    iframe.srcdoc = frameSource(this.ownerDocument)
    this.#frame = iframe
    this.#setStatus("Loading Kepler’s Laws…")
    this.#status.after(iframe)
    this.#readyTimer = this.#window.setTimeout(() => {
      this.#setStatus("Kepler’s Laws did not start. Reload the document to try again.")
    }, 20000)
  }

  disconnectedCallback() {
    this.#window.removeEventListener("message", this.#onFrameReady)
    this.#window.clearTimeout(this.#readyTimer)
    this.#closePort()
    this.#frame.remove()
    this.#frame = undefined
    this.#window = undefined
  }

  attributeChangedCallback(name, oldValue, value) {
    if (oldValue === value || !this.isConnected) return
    if (name === "snapshot" || name === "contenteditable") this.#refreshOptions()
    if (name !== "contenteditable") this.#scheduleApply()
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

  get locale() {
    const value = this.getAttribute("locale")
    return this.#capabilities?.locales.includes(value) ? value : this.#capabilities?.defaults.locale ?? "en"
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
    const locales = this.#capabilities?.locales ?? ["en"]
    const names = new Intl.DisplayNames(["en"], {type: "language"})
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
      locale: {
        label: "Language", group: "preferences", type: "select", disabled,
        options: choices(locales.map(value => [value, names.of(value.replaceAll("_", "-")) ?? value])),
      },
    }
  }

  get actions() {
    const disabled = !this.isContentEditable || !this.#capabilities
    return {
      captureSnapshot: {
        label: "Capture snapshot", group: "state", disabled,
        description: "Save the current experiment on all four screens to the document.",
      },
      restoreSnapshot: {
        label: "Restore snapshot", group: "state", disabled: disabled || !this.hasAttribute("snapshot"),
        description: "Return the experiment to the saved checkpoint.",
      },
    }
  }

  /** Reads the live model and preferences without editing the document. */
  async getSimulationState() {
    // Let a pending authored attribute update reach the port first.
    await Promise.resolve()
    return this.#request("read")
  }

  async captureSnapshot() {
    if (!this.isContentEditable) return
    const port = this.#port
    const previousSnapshot = this.getAttribute("snapshot")
    const previousPreferences = this.#readPreferences()
    const {snapshot} = await this.getSimulationState()
    if (port !== this.#port || !this.isContentEditable ||
        previousSnapshot !== this.getAttribute("snapshot") || previousPreferences !== this.#readPreferences()) {
      throw new Error("The simulation changed while the snapshot was being captured.")
    }
    const serialized = JSON.stringify(snapshot)
    this.#lastSnapshot = serialized
    this.setAttribute("snapshot", serialized)
  }

  async restoreSnapshot() {
    if (!this.isContentEditable || !this.hasAttribute("snapshot")) return
    await this.#request("apply", {snapshot: readJSON(this.getAttribute("snapshot"))})
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

  #readPreferences() {
    return JSON.stringify({
      enabledScreens: this.enabledScreens,
      locale: this.locale,
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
      const snapshot = this.getAttribute("snapshot")
      const preferences = this.#readPreferences()
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
      if (!changes.length) return
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
