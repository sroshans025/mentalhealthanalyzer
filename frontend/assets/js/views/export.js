import { api } from "../api.js";
import { h, toast } from "../ui.js";

/** Download the profile's journal as CSV or JSON. */
export async function downloadExport(format) {
  try {
    const res = await api.export(format);
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || `journal.${format}`;
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast("Export ready", { type: "success", message: `${name} has been downloaded.` });
  } catch (err) {
    toast("Export failed", { type: "error", message: err.message });
  }
}
