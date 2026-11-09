import assert from "node:assert/strict"
import {spawn} from "node:child_process"
import {existsSync} from "node:fs"
import {mkdtemp, readFile, rm} from "node:fs/promises"
import {createServer} from "node:http"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {once} from "node:events"
import test from "node:test"

const browser = process.env.CHROME_BIN ?? [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].find(existsSync)
const html = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-widget-test' 'strict-dynamic' 'unsafe-eval'; style-src-elem * data: blob: 'unsafe-inline'; style-src-attr 'unsafe-inline'; img-src * data: blob:; font-src * data:; connect-src 'self'; media-src * data: blob:; frame-src https: blob: data:">
<body style="max-width: 680px"><script type="module" nonce="widget-test" src="/tests/widget.browser.js"></script></body></html>`

test("Kepler’s Laws restores checkpoints and applies authored preferences in a sandboxed browser frame", {timeout: 45000}, async () => {
  assert.ok(browser && existsSync(browser), "Set CHROME_BIN to a Chrome or Chromium executable.")
  const profile = await mkdtemp(join(tmpdir(), "webwriter-phet-test-"))
  const paths = new Set(["/tests/widget.browser.js", "/widgets/webwriter-phet-simulation.js", "/sims/keplers-laws.js"])
  let resolve, reject
  const result = new Promise((onResult, onError) => { resolve = onResult; reject = onError })
  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/test-result") {
      let body = ""
      for await (const part of request) body += part
      response.writeHead(204).end()
      resolve(JSON.parse(body))
    }
    else if (request.url === "/") {
      response.writeHead(200, {"Content-Type": "text/html"}).end(html)
    }
    else if (paths.has(request.url)) {
      try {
        const source = await readFile(new URL(".." + request.url, import.meta.url))
        response.writeHead(200, {"Content-Type": "text/javascript"}).end(source)
      }
      catch (error) {
        response.writeHead(404).end()
        reject(error)
      }
    }
    else response.writeHead(404).end()
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const chrome = spawn(browser, [
    "--headless", "--no-first-run", "--no-default-browser-check", "--enable-logging=stderr",
    `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}/`,
  ], {stdio: ["ignore", "ignore", "pipe"]})
  let diagnostics = ""
  chrome.stderr.on("data", data => { diagnostics = (diagnostics + data).slice(-3000) })
  chrome.once("error", reject)
  chrome.once("exit", code => reject(new Error(`Chrome exited early (${code}).\n${diagnostics}`)))
  const timer = setTimeout(() => reject(new Error(`Browser test did not report a result.\n${diagnostics}`)), 35000)
  try {
    const {error} = await result
    if (error) assert.fail(`${error}\n${diagnostics}`)
  }
  finally {
    clearTimeout(timer)
    if (chrome.pid && chrome.exitCode === null && chrome.signalCode === null) {
      const exited = once(chrome, "exit")
      chrome.kill()
      await exited
    }
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(profile, {recursive: true, force: true, maxRetries: 3})
  }
})
