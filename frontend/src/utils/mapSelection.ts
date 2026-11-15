/** Coordinates and selection stay independent of rendered sample size. */
export interface FlatViewState { x: number; y: number; k: number }
export interface GlobeViewState { position: [number, number, number]; quaternion: [number, number, number, number] }
export type SelectionOperation = 'replace' | 'add' | 'toggle'
export interface ScreenRectangle { left: number; top: number; right: number; bottom: number }

export function screenRectangle(x1: number, y1: number, x2: number, y2: number): ScreenRectangle {
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) }
}
export function insideRectangle(x: number, y: number, rect: ScreenRectangle) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}
export function flatScale(width: number, height: number) { return Math.min(width, height * 2) }
export function flatProject(lat: number, lon: number, width: number, height: number, view: FlatViewState, wrap = 0) {
  const size = flatScale(width, height)
  return { x: width / 2 + ((lon + wrap * 360) / 360 - view.x) * size * view.k, y: height / 2 + (-lat / 180 - view.y) * size / 2 * view.k }
}
export function flatUnproject(x: number, y: number, width: number, height: number, view: FlatViewState) {
  const size = flatScale(width, height)
  const longitude = ((x - width / 2) / (size * view.k) + view.x) * 360
  return { lat: Math.max(-90, Math.min(90, -((y - height / 2) / (size / 2 * view.k) + view.y) * 180)), lon: ((longitude + 540) % 360) - 180 }
}
export function flatIdsInRectangle<T extends { id: string; lat: number; lon: number }>(points: T[], rect: ScreenRectangle, width: number, height: number, view: FlatViewState) {
  return [...new Set(points.filter((point) => [-1, 0, 1].some((wrap) => { const p = flatProject(point.lat, point.lon, width, height, view, wrap); return insideRectangle(p.x, p.y, rect) })).map((point) => point.id))]
}
export function applySelection(previous: string[], incoming: string[], operation: SelectionOperation) {
  if (operation === 'replace') return [...new Set(incoming)]
  const ids = new Set(previous)
  for (const id of new Set(incoming)) {
    if (operation === 'toggle' && ids.has(id)) ids.delete(id)
    else ids.add(id)
  }
  return [...ids]
}
