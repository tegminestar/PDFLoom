import * as Comlink from "comlink";
import * as annotations from "../pdf/annotations";
import * as compress from "../pdf/compress";
import * as convert from "../pdf/convert";
import * as edit from "../pdf/edit";
import * as forms from "../pdf/forms";
import * as organize from "../pdf/organize";
import * as stamps from "../pdf/stamps";

// Runs inside a dedicated Worker (see pdf-worker-client.ts). pdf-lib's page
// mutation operations (merge/split/reorder/rotate/annotate/etc.) can take a
// noticeable amount of CPU on large documents — offloading them here keeps
// the main thread, and the viewer's own scroll/render loop, responsive.
const api = { ...organize, ...annotations, ...stamps, ...forms, ...edit, ...convert, ...compress };
export type PdfWorkerApi = typeof api;

Comlink.expose(api);
