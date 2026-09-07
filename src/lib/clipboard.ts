/** Copy with a fallback for mobile browsers without the asynchronous Clipboard API. */
export async function copyLink(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* Try the legacy user-gesture path. */ }
  }
  const active = document.activeElement as HTMLElement | null;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
  document.body.appendChild(field);
  try {
    field.select(); field.setSelectionRange(0, text.length);
    if (!document.execCommand('copy')) throw new Error('复制失败');
  } finally { field.remove(); active?.focus({ preventScroll: true }); }
}
