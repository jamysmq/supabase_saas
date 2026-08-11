"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../src/lib/supabase";
import {
  getPublicSessionArea,
  markPublicSessionActive,
  type PublicSessionArea,
} from "../src/lib/public-session";

type PublicHeaderProps = {
  theme?: "dark" | "light";
};

const appBaseUrl = "https://app.meuassistentevirtual.com.br";

export function PublicHeader({ theme = "dark" }: PublicHeaderProps) {
  const [sessionArea, setSessionArea] = useState<PublicSessionArea | null>(null);
  const isDark = theme === "dark";

  useEffect(() => {
    let mounted = true;

    async function identifySession() {
      const marker = getPublicSessionArea();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      if (session) {
        const activeArea = marker ?? "tenant";
        markPublicSessionActive(activeArea);
        setSessionArea(activeArea);
        return;
      }

      setSessionArea(marker);
    }

    void identifySession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        const activeArea = getPublicSessionArea() ?? "tenant";
        markPublicSessionActive(activeArea);
        setSessionArea(activeArea);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const textClass = isDark
    ? "text-white/82 hover:text-white"
    : "text-sky-800 hover:text-sky-950";
  const outlineClass = isDark
    ? "border-white/30 text-white hover:border-white hover:bg-white/10"
    : "border-sky-200 bg-white text-sky-800 hover:bg-sky-50";
  const panelHref = sessionArea === "platform"
    ? `${appBaseUrl}/platform/tenants`
    : `${appBaseUrl}/dashboard`;

  return (
    <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
      <Link
        className={`text-sm font-bold uppercase tracking-[0.14em] ${
          isDark ? "text-white" : "text-sky-900"
        }`}
        href="/"
      >
        Assistente João
      </Link>

      <nav className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:w-auto sm:justify-end sm:gap-x-5">
        <Link className={textClass} href="/planos">Planos</Link>
        <Link className={textClass} href="/privacidade">Privacidade</Link>
        <Link className={textClass} href="/termos">Termos</Link>

        {sessionArea ? (
          <a
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 font-bold ${outlineClass}`}
            href={panelHref}
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.18)]"
            />
            Sessão ativa · Acessar painel
          </a>
        ) : (
          <a className={textClass} href={`${appBaseUrl}/login`}>Entrar</a>
        )}

        <Link
          className="rounded-md bg-[#68e5ff] px-3 py-2 text-center font-bold text-[#03142f] shadow-sm hover:bg-white sm:px-4"
          href="/cadastro"
        >
          Cadastre-se
        </Link>
      </nav>
    </header>
  );
}
