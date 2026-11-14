import { Vector3 } from 'three'

const DEG = Math.PI / 180

/** Maps WGS84 lat/lon onto the Three.js SphereGeometry used by the globe. */
export function latLonToVector3(lat: number, lon: number, radius = 1): Vector3 {
  const theta = (90 - lat) * DEG
  const phi = (lon + 180) * DEG
  const ring = radius * Math.sin(theta)

  return new Vector3(
    -ring * Math.cos(phi),
    radius * Math.cos(theta),
    ring * Math.sin(phi),
  )
}

export function vector3ToLatLon(point: Vector3): { lat: number; lon: number } {
  const radius = Math.hypot(point.x, point.y, point.z) || 1
  const lat = Math.asin(Math.min(1, Math.max(-1, point.y / radius))) / DEG
  let lon = Math.atan2(point.z, -point.x) / DEG - 180

  if (lon < -180) lon += 360
  if (lon > 180) lon -= 360

  return { lat, lon }
}
