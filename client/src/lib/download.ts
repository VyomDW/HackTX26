/** Saves text as a file through a temporary link; runs only from a user's click. */
export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeName = (title: string) => title.replace(/[\\/:*?"<>|]+/g, "").trim() || "untitled";
