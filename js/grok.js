const LAYOUTS = ["full", "kaleido", "duo", "trim", "tri", "quad"];
const EFFECTS = ["flash", "zoom", "shake", "glitch", "stutter", "hue", "rgb", "echo", "tunnel", "invert", "whip", "zoomin", "speed", "voice", "vhs", "strobe", "text", "kenburns", "lines"];
const LOOKS = ["none", "warm", "pink", "cold", "vivid", "bw", "noir", "custom"];
const includes = (list, value) => list.includes(value);

function parseSettings(content) {
  const json = content.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
  let settings;
  try {
    settings = JSON.parse(json)?.settings;
  } catch {
    throw new Error("Grok returned an invalid response. Try again.");
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("Grok returned no usable style settings. Try again.");
  }
  const patch = {};
  if (includes(["auto", "1", "2", "4"], settings.cut)) patch.cut = settings.cut;
  if (includes(["slow", "normal", "fast"], settings.pace)) patch.pace = settings.pace;
  if (Array.isArray(settings.layouts)) {
    const selected = settings.layouts.filter((value) => LAYOUTS.includes(value));
    if (selected.length) patch.layouts = Object.fromEntries(LAYOUTS.map((value) => [value, selected.includes(value)]));
  }
  if (includes(["cols", "rows"], settings.split)) patch.split = settings.split;
  if (includes(LOOKS, settings.look)) patch.look = settings.look;
  if (includes(["contain", "cover"], settings.fit)) patch.fit = settings.fit;
  if (includes(["16:9", "9:16"], settings.format)) patch.format = settings.format;
  if (includes(["auto", "1", "2", "4", "8"], settings.picFlashRate)) patch.picFlashRate = settings.picFlashRate;
  if (includes(["single", "burst", "both"], settings.picFlashMode)) patch.picFlashMode = settings.picFlashMode;
  for (const key of ["lookAmt", "bright", "pulseAmt"]) {
    if (Number.isFinite(settings[key])) patch[key] = Math.max(0, Math.min(100, settings[key]));
  }
  if (Number.isFinite(settings.picOverlayAmt)) patch.picOverlayAmt = Math.max(10, Math.min(90, settings.picOverlayAmt));
  for (const key of ["picFlash", "picOverlay", "soft"]) {
    if (typeof settings[key] === "boolean") patch[key] = settings[key];
  }
  if (Array.isArray(settings.effects) && settings.effects.every((value) => EFFECTS.includes(value))) {
    patch.fx = Object.fromEntries(EFFECTS.map((value) => [value, settings.effects.includes(value)]));
  }
  if (!Object.keys(patch).length) throw new Error("Grok returned no valid style settings. Try again.");
  if (patch.layouts && !Object.values(patch.layouts).some(Boolean)) patch.layouts.full = true;
  return patch;
}

function workerEndpoint(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Enter your deployed Cloudflare Worker URL.");
  }
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev$/i.test(url.hostname) ||
    url.username || url.password || url.port || (url.pathname !== "/" && url.pathname !== "/api/grok") ||
    url.search || url.hash
  ) {
    throw new Error("Use your HTTPS Cloudflare Workers URL, ending in .workers.dev.");
  }
  url.pathname = "/api/grok";
  return url.href;
}

export async function requestGrokStyle(workerUrl, apiKey, prompt, current) {
  const endpoint = workerEndpoint(workerUrl);
  const key = String(apiKey || "").trim();
  const request = String(prompt || "").trim();
  if (!key) throw new Error("Enter your xAI API key first.");
  if (!request) throw new Error("Describe the style you want first.");
  if (request.length > 500) throw new Error("Keep the style description to 500 characters or fewer.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ apiKey: key, prompt: request, current }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Grok proxy request failed (HTTP ${response.status}).`);
    if (typeof data.content !== "string") throw new Error("Grok proxy returned no usable response.");
    return parseSettings(data.content);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Grok request timed out. Try again.");
    if (error instanceof TypeError) throw new Error("Could not reach the Grok proxy. Check the Worker URL and deployment.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
