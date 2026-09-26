/**
 * Runs in an Electron utility process: parses the filter lists into a
 * blocking engine and hands back its compact serialized form. Parsing a
 * few hundred thousand rules takes a moment, and this way it never blocks
 * the browser.
 */
import { FiltersEngine } from "@ghostery/adblocker";
import { ENGINE_CONFIG } from "./adblock-config";

interface Job {
  lists: string[];
  resources: string | null;
}

process.parentPort.once("message", (event: { data: Job }) => {
  try {
    const { lists, resources } = event.data;
    const engine = FiltersEngine.parse(lists.join("\n"), ENGINE_CONFIG);
    if (resources) engine.updateResources(resources, String(resources.length));
    process.parentPort.postMessage({ ok: true, data: engine.serialize() });
  } catch (err) {
    process.parentPort.postMessage({ ok: false, error: String(err) });
  }
});
