type NativePickerInput = HTMLInputElement & {
  showPicker?: () => void
}

const pendingPickers = new WeakMap<HTMLInputElement, { cancel: () => void }>()

export function openNativePicker(event: { currentTarget: HTMLInputElement }) {
  const input = event.currentTarget as NativePickerInput
  input.focus()

  pendingPickers.get(input)?.cancel()

  let timer = 0
  const cleanup = () => {
    pendingPickers.delete(input)
    input.removeEventListener('keydown', allowTyping)
    input.removeEventListener('input', allowTyping)
  }
  const allowTyping = () => {
    window.clearTimeout(timer)
    cleanup()
  }

  // A short delay distinguishes a click intended to open the calendar from
  // a click followed immediately by typing a date. Native date inputs remain
  // editable while the full field still acts as the calendar trigger.
  input.addEventListener('keydown', allowTyping, { once: true })
  input.addEventListener('input', allowTyping, { once: true })

  timer = window.setTimeout(() => {
    cleanup()

    try {
      input.showPicker?.()
    } catch {
      // Some browsers already open the native picker from the click itself.
    }
  }, 220)

  pendingPickers.set(input, { cancel: allowTyping })
}
