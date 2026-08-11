export const readBoundedBodyBytes = async (
  response: Response | Request,
  maximumBytes: number,
): Promise<Uint8Array> => {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("body-too-large");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
};

export const readBoundedBody = async (
  response: Response | Request,
  maximumBytes: number,
): Promise<string> =>
  new TextDecoder("utf-8", { fatal: true }).decode(
    await readBoundedBodyBytes(response, maximumBytes),
  );
