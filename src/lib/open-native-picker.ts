export function openNativePicker(event: { currentTarget: HTMLInputElement }) {
  // Keep the text segments editable. The browser's calendar/clock icon still
  // opens the native picker, while clicking the field only focuses it so the
  // user can type numbers directly.
  const input = event.currentTarget
  input.focus()
  input.addEventListener(
    'change',
    () => window.requestAnimationFrame(() => input.blur()),
    { once: true }
  )
}
