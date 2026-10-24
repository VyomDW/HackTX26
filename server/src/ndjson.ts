/** Splits a stream of text chunks into complete lines, holding back any partial line. */
export async function* lines(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}
