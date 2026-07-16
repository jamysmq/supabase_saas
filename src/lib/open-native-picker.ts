type NativePickerInput = HTMLInputElement & {
  showPicker?: () => void
}

export function openNativePicker(event: { currentTarget: HTMLInputElement }) {
  const input = event.currentTarget as NativePickerInput
  input.focus()

  try {
    input.showPicker?.()
  } catch {
    // Some browsers already open the native picker from the click itself.
  }
}
