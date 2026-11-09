// Public builds accept startup parameters for audio and locale. Projector
// mode is available only in simulations that ship that color profile.
const projectorTypes = new Set([
  "area-model-algebra", "area-model-decimals", "area-model-introduction", "area-model-multiplication",
  "blackbody-spectrum", "build-a-fraction", "build-a-nucleus", "buoyancy", "charges-and-fields",
  "circuit-construction-kit-ac-virtual-lab", "coulombs-law", "density", "diffusion", "fourier-making-waves",
  "fractions-equality", "fractions-intro", "fractions-mixed-numbers", "gas-properties", "gases-intro",
  "geometric-optics", "gravity-and-orbits", "masses-and-springs", "masses-and-springs-basics",
  "models-of-the-hydrogen-atom", "molecule-shapes", "molecule-shapes-basics", "proportion-playground",
  "rutherford-scattering", "states-of-matter",
])

export function supportsProjector(type) {
  return projectorTypes.has(type)
}

export function hostedSource(type, {locale, audio, colorProfile}) {
  const url = new URL(`https://phet.colorado.edu/sims/html/${type}/latest/${type}_all.html`)
  if (locale !== "en") url.searchParams.set("locale", locale)
  if (audio !== "enabled") url.searchParams.set("audio", audio)
  if (colorProfile === "projector" && supportsProjector(type)) url.searchParams.set("colorProfile", colorProfile)
  return url.href
}
