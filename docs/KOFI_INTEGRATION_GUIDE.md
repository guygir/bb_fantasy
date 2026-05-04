# Ko-fi Integration Guide

Quick guide for integrating Ko-fi donation button into web projects.

## Prerequisites

1. Create a Ko-fi account at [ko-fi.com](https://ko-fi.com)
2. Note your Ko-fi username (e.g., `guygir` from `ko-fi.com/guygir`)

---

## Option 1: Simple Link Button

The easiest approach - just link to your Ko-fi page:

```tsx
<a
  href="https://ko-fi.com/YOUR_USERNAME"
  target="_blank"
  rel="noopener noreferrer"
  className="inline-flex items-center gap-2 rounded-lg bg-[#FF5E5B] px-4 py-2 text-white font-medium hover:bg-[#e54e4b] transition-colors"
>
  <span>☕</span>
  Support me on Ko-fi
</a>
```

---

## Option 2: Ko-fi Official Button (Image)

Use Ko-fi's official button images:

```tsx
<a href="https://ko-fi.com/YOUR_USERNAME" target="_blank" rel="noopener noreferrer">
  <img
    src="https://cdn.ko-fi.com/cdn/kofi2.png?v=3"
    alt="Buy Me a Coffee at ko-fi.com"
    height="36"
    style={{ border: 0, height: 36 }}
  />
</a>
```

Alternative button styles from Ko-fi:
- `https://cdn.ko-fi.com/cdn/kofi1.png?v=3` (blue)
- `https://cdn.ko-fi.com/cdn/kofi2.png?v=3` (default)
- `https://cdn.ko-fi.com/cdn/kofi3.png?v=3` (minimal)
- `https://cdn.ko-fi.com/cdn/kofi5.png?v=3` (white)

---

## Option 3: Ko-fi Widget (Embedded)

Embed the full Ko-fi widget (shows recent supporters):

```html
<script src="https://storage.ko-fi.com/cdn/scripts/overlay-widget.js"></script>
<script>
  kofiWidgetOverlay.draw('YOUR_USERNAME', {
    'type': 'floating-chat',
    'floating-chat.donateButton.text': 'Support me',
    'floating-chat.donateButton.background-color': '#FF5E5B',
    'floating-chat.donateButton.text-color': '#fff'
  });
</script>
```

### For Next.js/React (Client Component)

```tsx
"use client";

import { useEffect } from "react";

export function KofiWidget({ username }: { username: string }) {
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://storage.ko-fi.com/cdn/scripts/overlay-widget.js";
    script.async = true;
    script.onload = () => {
      if (typeof window !== "undefined" && (window as any).kofiWidgetOverlay) {
        (window as any).kofiWidgetOverlay.draw(username, {
          type: "floating-chat",
          "floating-chat.donateButton.text": "Support me",
          "floating-chat.donateButton.background-color": "#FF5E5B",
          "floating-chat.donateButton.text-color": "#fff",
        });
      }
    };
    document.body.appendChild(script);

    return () => {
      // Cleanup on unmount
      const widget = document.getElementById("kofi-widget-overlay");
      if (widget) widget.remove();
    };
  }, [username]);

  return null;
}
```

Usage in layout or page:
```tsx
<KofiWidget username="YOUR_USERNAME" />
```

---

## Option 4: Floating Button (Custom)

A custom floating button that opens Ko-fi in a new tab:

```tsx
"use client";

export function KofiFloatingButton({ username }: { username: string }) {
  return (
    <a
      href={`https://ko-fi.com/${username}`}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#FF5E5B] text-white shadow-lg hover:bg-[#e54e4b] transition-all hover:scale-110"
      title="Support me on Ko-fi"
    >
      <span className="text-2xl">☕</span>
    </a>
  );
}
```

---

## Option 5: Footer Integration

Add to your site footer:

```tsx
<footer className="border-t border-gray-200 py-6 text-center text-sm text-gray-500">
  <p>
    Made with ❤️ · 
    <a
      href="https://ko-fi.com/YOUR_USERNAME"
      target="_blank"
      rel="noopener noreferrer"
      className="ml-1 text-[#FF5E5B] hover:underline"
    >
      ☕ Buy me a coffee
    </a>
  </p>
</footer>
```

---

## Ko-fi Brand Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Ko-fi Red | `#FF5E5B` | Primary button |
| Ko-fi Red (hover) | `#e54e4b` | Button hover |
| Ko-fi Blue | `#29ABE0` | Alternative |
| White | `#FFFFFF` | Text on buttons |

---

## Environment Variable (Optional)

Store username in `.env.local` for reusability:

```env
NEXT_PUBLIC_KOFI_USERNAME=your_username
```

Usage:
```tsx
const kofiUrl = `https://ko-fi.com/${process.env.NEXT_PUBLIC_KOFI_USERNAME}`;
```

---

## Notes

- Replace `YOUR_USERNAME` with your actual Ko-fi username
- Ko-fi widget requires client-side JavaScript (use `"use client"` in Next.js)
- Test the link works before deploying
- Consider adding analytics tracking for donation clicks
