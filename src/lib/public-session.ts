export type PublicSessionArea = "tenant" | "platform";

const COOKIE_NAME = "jack_session_area";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function cookieDomain() {
  if (typeof window === "undefined") return "";

  return window.location.hostname.endsWith("meuassistentevirtual.com.br")
    ? "; Domain=.meuassistentevirtual.com.br"
    : "";
}

export function markPublicSessionActive(area: PublicSessionArea) {
  document.cookie = `${COOKIE_NAME}=${area}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax; Secure${cookieDomain()}`;
}

export function clearPublicSessionMarker() {
  document.cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax; Secure${cookieDomain()}`;
}

export function getPublicSessionArea(): PublicSessionArea | null {
  if (typeof document === "undefined") return null;

  const value = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${COOKIE_NAME}=`))
    ?.split("=")[1];

  return value === "tenant" || value === "platform" ? value : null;
}
