/** Original filenames are discarded so names and locations are not published. */
export function uploadPathFor(userId: string, originalName: string): string {
  const extension = (
    /\.([a-z0-9]+)$/i.exec(originalName)?.[1] ?? "jpg"
  ).toLowerCase();
  return `${encodeURIComponent(userId)}/${crypto.randomUUID()}.${extension}`;
}
