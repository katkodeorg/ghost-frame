export type SaveResult = 'shared' | 'downloaded' | 'cancelled' | 'needs-gesture';

/**
 * Shares the file via the Web Share API when files are shareable (on iPhone
 * this offers "Save Image" to Photos), otherwise downloads it.
 *
 * Call this synchronously from a click handler where possible: browsers
 * require a recent user gesture for navigator.share().
 */
export async function saveFile(file: File): Promise<SaveResult> {
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === 'AbortError') return 'cancelled';
      if (name === 'NotAllowedError') return 'needs-gesture';
      // Anything else: fall through to a plain download.
    }
  }
  download(file);
  return 'downloaded';
}

export function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
