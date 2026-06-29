import { apiFetch } from "../utils/api";

export async function apiCall(path: string, options: RequestInit = {}) {
  const response = await apiFetch(path, options);
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}
