#!/usr/bin/env node
import http from "node:http";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const clientId = process.env.SPOTIFY_CLIENT_ID || "";
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || "";
const port = Number(process.env.SPOTIFY_HELPER_PORT || "8787");
const redirectUri = `http://127.0.0.1:${port}/callback`;
const mode = (process.env.SPOTIFY_HELPER_MODE || "server").toLowerCase();
const scope = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-read-recently-played",
].join(" ");

if (!clientId) fail("missing SPOTIFY_CLIENT_ID");
if (!clientSecret) fail("missing SPOTIFY_CLIENT_SECRET");

const state = randomBytes(16).toString("hex");
const authUrl = new URL("https://accounts.spotify.com/authorize");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("scope", scope);
authUrl.searchParams.set("state", state);
authUrl.searchParams.set("show_dialog", "true");

console.log("");
console.log("Spotify refresh-token helper");
console.log("----------------------------------------");
console.log("1) Open this URL in your browser and authorize:");
console.log(authUrl.toString());
console.log("");
console.log(`2) Keep this process running. Waiting on ${redirectUri}`);
console.log("");

async function exchangeCode(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const tokenJson = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(`token exchange failed: ${JSON.stringify(tokenJson)}`);
  }

  console.log("");
  console.log("Spotify token exchange success");
  console.log("----------------------------------------");
  console.log(`access_token: ${tokenJson.access_token ? "[received]" : "[missing]"}`);
  console.log(`refresh_token: ${tokenJson.refresh_token || "[missing]"}`);
  console.log(`expires_in: ${tokenJson.expires_in}`);
  console.log("");
  console.log("Run this next:");
  console.log(`echo "${tokenJson.refresh_token || ""}" | npx wrangler secret put SPOTIFY_REFRESH_TOKEN`);
  console.log("");
}

if (mode === "manual") {
  console.log("Manual mode enabled (no local callback server).");
  console.log("After approval, copy the full redirected URL and paste it below.");
  console.log("");
  const rl = readline.createInterface({ input, output });
  const redirected = await rl.question("Paste redirect URL (or just ?code=...): ");
  await rl.close();
  const callbackUrl = redirected.startsWith("http")
    ? new URL(redirected)
    : new URL(`http://127.0.0.1:${port}/callback${redirected.startsWith("?") ? redirected : `?${redirected}`}`);
  const returnedState = callbackUrl.searchParams.get("state") || "";
  const code = callbackUrl.searchParams.get("code") || "";
  const err = callbackUrl.searchParams.get("error") || "";
  if (err) fail(`spotify auth error: ${err}`);
  if (!code) fail("missing code in pasted URL");
  if (returnedState !== state) fail("state mismatch in pasted URL");
  await exchangeCode(code);
  process.exit(0);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    if (url.pathname !== "/callback") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const returnedState = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    const err = url.searchParams.get("error") || "";

    if (err) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end(`Spotify error: ${err}`);
      console.error(`spotify auth error: ${err}`);
      server.close();
      return;
    }

    if (!code) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Missing code.");
      console.error("missing code in callback");
      server.close();
      return;
    }

    if (returnedState !== state) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("State mismatch.");
      console.error("state mismatch");
      server.close();
      return;
    }

    try {
      await exchangeCode(code);
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Token exchange failed. Check terminal output.");
      console.error(error);
      server.close();
      return;
    }

    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("Success. You can close this tab.");

    server.close();
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Unexpected error.");
    console.error(error);
    server.close();
  }
});

server.listen(port, "127.0.0.1", () => {});
