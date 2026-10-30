// Sends host messages to the webview without letting a failure escape. Pure:
// no `vscode` import, so it can be unit-tested with `node --test`.
import type { HostMessage } from "./protocol.ts";

/**
 * Posts one message to the webview, as `webview.postMessage` does: resolves
 * true if VS Code delivered it, false if not, and may reject or throw.
 */
export type PostMessage = (message: HostMessage) => PromiseLike<boolean>;

/**
 * Posts `message` and resolves true only if VS Code says it was delivered.
 * Never rejects: a rejection or a thrown error counts as not delivered. A
 * failure is neither logged nor reported anywhere (no telemetry); the caller
 * decides what to do from the result.
 */
export async function deliver(post: PostMessage, message: HostMessage): Promise<boolean> {
  try {
    return (await post(message)) === true;
  } catch {
    return false;
  }
}
