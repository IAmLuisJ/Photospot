/** Photos are served through the Worker so visibility follows moderation. */
export function photoUrl(
  baseUrl: string,
  storagePath: string | null,
): string | null {
  if (!storagePath) return null;
  const parts = storagePath.split("/");
  if (parts.some((part) => part === "." || part === "..")) return null;
  return `${baseUrl.replace(/\/+$/, "")}/media/${parts.map(encodeURIComponent).join("/")}`;
}
