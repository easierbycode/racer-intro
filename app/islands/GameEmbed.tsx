import { useEffect, useRef } from 'preact/hooks'

// The game preview. An island only because of the `f` shortcut: the iframe
// itself is static markup, but fullscreen has to be requested from the client
// on a real user gesture.
export default function GameEmbed({ src }: { src: string }) {
  const ref = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== 'f' && ev.key !== 'F') return
      // Leave modified presses alone — ctrl/cmd-f is find, alt-f is a menu.
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return
      // Don't steal the key while the panel's own fields have focus.
      const el = ev.target as HTMLElement | null
      if (
        el?.isContentEditable ||
        el?.tagName === 'INPUT' ||
        el?.tagName === 'TEXTAREA' ||
        el?.tagName === 'SELECT'
      ) return

      const frame = ref.current
      if (!frame) return
      ev.preventDefault()

      if (document.fullscreenElement) document.exitFullscreen()
      else frame.requestFullscreen?.()
    }

    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [])

  return (
    <iframe
      ref={ref}
      class='game-embed'
      src={src}
      title='racer intro'
      allow='autoplay; fullscreen'
      allowFullScreen
    />
  )
}
