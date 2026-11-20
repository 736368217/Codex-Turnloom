import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { fetchImageDataUrl } from '../lib/authImage';

/**
 * An image fetched with the access token in a header and rendered from a
 * `data:` URL. Direct `<img src="http://…">` cannot work inside the Android
 * WebView (all remote subresources are intercepted), and the token must never
 * travel in a URL. While loading, a neutral box holds the layout; on failure
 * nothing is rendered so the caller's text fallback stays honest.
 */
export default function AuthedImage({
  src, alt, mimeType = '', className, style, placeholder,
}: {
  src: string;
  alt: string;
  /** The server's own type, when it sent one; never invented here. */
  mimeType?: string;
  className?: string;
  style?: CSSProperties;
  /** Rendered while the bytes are in flight (never a fake picture). */
  placeholder?: ReactNode;
}) {
  const [dataUrl, setDataUrl] = useState(() => (/^data:image\//i.test(src) ? src : ''));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (!src) { setDataUrl(''); setFailed(true); return () => { cancelled = true; }; }
    if (/^data:image\//i.test(src)) { setDataUrl(src); return () => { cancelled = true; }; }
    setDataUrl('');
    void fetchImageDataUrl(src, mimeType, alt).then((value) => {
      if (cancelled) return;
      if (value) setDataUrl(value);
      else setFailed(true);
    });
    return () => { cancelled = true; };
  }, [src, mimeType, alt]);

  if (failed) return null;
  if (!dataUrl) {
    return <span className="tl-authed-image placeholder" aria-hidden="true">{placeholder}</span>;
  }
  return <img className={className} style={style} src={dataUrl} alt={alt} />;
}
