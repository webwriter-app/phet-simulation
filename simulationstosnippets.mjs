import {readFileSync, writeFileSync} from "node:fs"

const simulations = JSON.parse(readFileSync("simulations.json", "utf8"))
const pkg = JSON.parse(readFileSync("package.json", "utf8"))

for (const [name, simulation] of Object.entries(simulations)) {
  const checkpoint = name === "keplers-laws" ? '<script type="application/json" slot="data">null</script>' : ""
  const template = `<webwriter-phet-simulation type="${name}">${checkpoint}</webwriter-phet-simulation>`
  const key = `./snippets/${name}`
  writeFileSync(`${key}.html`, template, "utf8")
  pkg.exports[`${key}.html`] = `${key}.html`
  pkg.editingConfig[key] ??= {label: {_: simulation.title}}
}

writeFileSync("package.json", JSON.stringify(pkg, null, 4) + "\n", "utf8")
