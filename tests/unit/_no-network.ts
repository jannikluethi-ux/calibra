/** Preload for child processes in tests: any network attempt throws (and is reported on stderr as NETWORK_ATTEMPT). */
import http from "node:http";
import https from "node:https";
import net from "node:net";

function deny(what: string): never {
  process.stderr.write(`NETWORK_ATTEMPT ${what}\n`);
  throw new Error(`network disabled (${what})`);
}
globalThis.fetch = (async (u: unknown) => deny(`fetch ${String(u)}`)) as typeof fetch;
(http as { request: unknown }).request = () => deny("http.request");
(http as { get: unknown }).get = () => deny("http.get");
(https as { request: unknown }).request = () => deny("https.request");
(https as { get: unknown }).get = () => deny("https.get");
(net as { connect: unknown }).connect = () => deny("net.connect");
(net as { createConnection: unknown }).createConnection = () => deny("net.createConnection");
