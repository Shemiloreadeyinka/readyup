/** Promise wrapper around chrome.runtime messaging with real error surfacing. */
export async function sendMessage(type, payload = {}) {
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type, ...payload });
  } catch (error) {
    throw new Error(
      error?.message?.includes('Receiving end')
        ? 'The extension background worker is not responding. Reload the extension and try again.'
        : (error?.message ?? 'Could not reach the extension background worker.'),
    );
  }

  if (!response) throw new Error('The background worker returned no response.');
  if (!response.ok) throw new Error(response.error?.message ?? 'The request failed.');
  return response.data;
}

/** Subscribes to background state pushes. Returns an unsubscribe function. */
export function onBackgroundMessage(type, handler) {
  const listener = (message) => {
    if (message?.type === type) handler(message);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
