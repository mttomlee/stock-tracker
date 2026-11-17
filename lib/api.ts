export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  const body = await response.text();
  if (!response.ok) {
    let message = body || response.statusText;
    try {
      message = JSON.parse(body).detail ?? message;
    } catch {
      // Keep the response text when the server did not return JSON.
    }
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error("The API returned an invalid response.");
  }
}
