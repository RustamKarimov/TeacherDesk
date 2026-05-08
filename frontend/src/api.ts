export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export async function readJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text.startsWith("<") ? `Request failed with HTTP ${response.status}. Backend returned an HTML error page.` : text);
  }
  if (!contentType.includes("application/json")) {
    throw new Error(text.startsWith("<") ? "Backend returned HTML instead of JSON. Refresh the page or restart the dev servers." : "Backend returned a non-JSON response.");
  }
  return JSON.parse(text) as T;
}
