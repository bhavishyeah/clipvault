// Shared toast state — separated from component file for React Fast Refresh compatibility

let toastId = 0
let addToastExternal = null

export function toast(message, type = 'success') {
  if (addToastExternal) addToastExternal({ id: ++toastId, message, type })
}

export function setToastHandler(handler) {
  addToastExternal = handler
}

export function clearToastHandler() {
  addToastExternal = null
}
