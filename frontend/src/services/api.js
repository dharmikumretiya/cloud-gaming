export async function request(path, body) {
  const response = await fetch(`/api${path}`, {
    ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'The request failed. Please retry.');
  return data;
}
