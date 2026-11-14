import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

/** Text label as a camera-facing sprite (canvas texture). No DOM roots, no external fonts. `height` in scene units. */
export function LabelSprite({ text, color = '#e6edf7', position, height }: { text: string; color?: string; position: [number, number, number]; height: number }) {
  const { texture, aspect } = useMemo(() => {
    const cv = document.createElement('canvas')
    const ctx = cv.getContext('2d')!
    const font = '600 28px ui-sans-serif, system-ui, sans-serif'
    ctx.font = font
    const w = Math.ceil(ctx.measureText(text).width) + 20
    cv.width = w; cv.height = 44
    ctx.font = font
    ctx.fillStyle = 'rgba(4,7,13,0.82)'; ctx.fillRect(0, 0, w, 44)
    ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, 10, 23)
    const t = new THREE.CanvasTexture(cv)
    t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter
    return { texture: t, aspect: w / 44 }
  }, [text, color])
  useEffect(() => () => texture.dispose(), [texture])
  return (
    <sprite position={position} scale={[height * aspect, height, 1]} renderOrder={10}>
      <spriteMaterial map={texture} depthTest={false} transparent />
    </sprite>
  )
}
