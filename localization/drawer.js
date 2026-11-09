import metadata from "../editing-config.json" with {type: "json"}
import messages from "./drawer.json" with {type: "json"}

// PhET uses a few locale IDs that are different from the corresponding HTML tags.
const aliases = {ef: "efi", "fa-da": "fa-AF", prs: "fa-AF", pr: "tsz", sp: "nso", ua: "nah"}

export function canonicalLocale(value) {
  const tag = value?.trim().replaceAll("_", "-")
  if (!tag) return "en"
  try { return new Intl.Locale(aliases[tag.toLowerCase()] ?? tag).baseName }
  catch { return "en" }
}

function* localeCandidates(locale) {
  const parts = locale.split("-")
  while (parts.length) {
    const tag = parts.join("-")
    yield tag
    // PhET uses regional Chinese codes. WebWriter also accepts script tags.
    if (/^zh(?:-|$)/.test(tag)) {
      const chinese = new Intl.Locale(tag).maximize()
      yield `zh-${chinese.region}`
      yield `zh-${chinese.script}`
      yield chinese.script === "Hant" ? "zh-TW" : "zh-CN"
    }
    parts.pop()
  }
}

export function matchSimulationLocale(language, available) {
  const direct = available.find(tag => tag.replaceAll("_", "-").toLowerCase() === language?.toLowerCase().replaceAll("_", "-"))
  if (direct) return direct
  for (const candidate of localeCandidates(canonicalLocale(language))) {
    const match = available.find(tag => canonicalLocale(tag) === candidate)
    if (match) return match
  }
  return "en"
}

function localized(translations, locale) {
  if (translations) {
    for (const tag of localeCandidates(locale)) {
      if (Object.hasOwn(translations, tag)) return translations[tag]
    }
  }
}

export function drawerText(text, locale, type) {
  return localized(messages.simulations[type]?.[text], locale) ??
    localized(messages.common[text], locale) ?? text
}

export function simulationTitle(type, locale, fallback) {
  return localized(metadata[`./snippets/${type}`]?.label, locale) ?? fallback
}
