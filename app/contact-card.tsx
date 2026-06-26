'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'

type ContactForm = {
  name: string
  email: string
  whatsapp: string
  subject: string
  message: string
}

const emptyForm: ContactForm = {
  name: '',
  email: '',
  whatsapp: '',
  subject: '',
  message: '',
}

export function ContactCard() {
  const [form, setForm] = useState<ContactForm>(emptyForm)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSending(true)
    setError('')
    setSuccess('')

    const response = await fetch('/api/public/contact-message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(form),
    })

    setSending(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Nao foi possivel enviar sua mensagem.')
      return
    }

    setSuccess('Mensagem enviada. Vamos retornar pelo contato informado.')
    setForm(emptyForm)
  }

  return (
    <section id="falar-conosco" className="bg-[#eef8ff]">
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-12 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:px-10">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0d65bd]">
            Falar conosco
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-black text-[#07111f]">
            Ficou com alguma dúvida? Fale com a gente.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-6 text-[#44546a]">
            Tire dúvidas, peça ajuda com o cadastro ou conheça melhor o Assistente Jack. A gente retorna pelo contato que você informar.
          </p>
        </div>

        <form onSubmit={submit} className="rounded-md border border-[#d7e6f5] bg-white p-5 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-[#07111f]">
              Nome
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                className="mt-1 h-10 w-full rounded-md border border-[#c7d9ee] px-3 font-normal outline-none focus:border-[#0d65bd]"
                maxLength={120}
                required
              />
            </label>

            <label className="block text-sm font-semibold text-[#07111f]">
              E-mail
              <input
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                className="mt-1 h-10 w-full rounded-md border border-[#c7d9ee] px-3 font-normal outline-none focus:border-[#0d65bd]"
                type="email"
                required
              />
            </label>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-[#07111f]">
              WhatsApp
              <input
                value={form.whatsapp}
                onChange={(event) => setForm({ ...form, whatsapp: event.target.value })}
                className="mt-1 h-10 w-full rounded-md border border-[#c7d9ee] px-3 font-normal outline-none focus:border-[#0d65bd]"
                inputMode="tel"
                placeholder="DDD + numero"
              />
            </label>

            <label className="block text-sm font-semibold text-[#07111f]">
              Assunto
              <input
                value={form.subject}
                onChange={(event) => setForm({ ...form, subject: event.target.value })}
                className="mt-1 h-10 w-full rounded-md border border-[#c7d9ee] px-3 font-normal outline-none focus:border-[#0d65bd]"
                maxLength={120}
              />
            </label>
          </div>

          <label className="mt-3 block text-sm font-semibold text-[#07111f]">
            Mensagem
            <textarea
              value={form.message}
              onChange={(event) => setForm({ ...form, message: event.target.value })}
              className="mt-1 min-h-32 w-full rounded-md border border-[#c7d9ee] px-3 py-2 font-normal outline-none focus:border-[#0d65bd]"
              maxLength={2000}
              required
            />
          </label>

          {error && <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {success && <div className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div>}

          <button
            type="submit"
            disabled={sending}
            className="mt-4 w-full rounded-md bg-[#073a86] px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#052a61] disabled:opacity-50"
          >
            {sending ? 'Enviando...' : 'Enviar mensagem'}
          </button>
        </form>
      </div>
    </section>
  )
}
