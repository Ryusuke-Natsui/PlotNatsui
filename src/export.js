import { exportProject } from "./state.js";

export function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function saveProjectJson() {
  downloadText("spectrum-project.json", exportProject(), "application/json;charset=utf-8");
}
