// tests/helpers.mjs
const BASE = process.env.API_URL || 'http://localhost:3000';

export function rand(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
}

export async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, json };
}

export async function signup(email, password, name) {
  const r = await api('POST', '/api/auth/signup', { email, password, name });
  if (!r.ok) throw new Error('signup failed: ' + JSON.stringify(r.json));
  return r.json.token;
}

export async function login(email, password) {
  const r = await api('POST', '/api/auth/login', { email, password });
  if (!r.ok) throw new Error('login failed: ' + JSON.stringify(r.json));
  return r.json.token;
}

export async function createCompany(token, name) {
  const r = await api('POST', '/api/companies', { name }, token);
  if (!r.ok) throw new Error('company create failed: ' + JSON.stringify(r.json));
  return r.json.company;
}

export const base = BASE;
