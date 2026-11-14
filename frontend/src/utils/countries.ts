type Ring = number[][]
type Polygon = Ring[]

export type CountryShape = {
  name: string
  polygons: Polygon[]
}

type CountryFile = {
  features: Array<{
    properties: { name: string }
    geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Polygon | Polygon[] }
  }>
}

let loading: Promise<CountryShape[]> | null = null

export function loadCountries() {
  if (!loading) {
    loading = fetch('/geo/countries.geojson')
      .then((response) => {
        if (!response.ok) throw new Error('Country boundaries did not load.')
        return response.json() as Promise<CountryFile>
      })
      .then((file) =>
        file.features.map((feature) => ({
          name: feature.properties.name,
          polygons:
            feature.geometry.type === 'Polygon'
              ? [feature.geometry.coordinates as Polygon]
              : (feature.geometry.coordinates as Polygon[]),
        })),
      )
  }
  return loading
}

function ringContains(lon: number, lat: number, ring: Ring) {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [currentLon, currentLat] = ring[index]
    const [previousLon, previousLat] = ring[previous]
    const crosses = currentLat > lat !== previousLat > lat
    if (!crosses) continue
    const edgeLon =
      ((previousLon - currentLon) * (lat - currentLat)) / (previousLat - currentLat) + currentLon
    if (lon < edgeLon) inside = !inside
  }
  return inside
}

export function countryAt(countries: CountryShape[], lat: number, lon: number) {
  for (const country of countries) {
    for (const polygon of country.polygons) {
      const [outer, ...holes] = polygon
      if (!outer || !ringContains(lon, lat, outer)) continue
      if (holes.some((hole) => ringContains(lon, lat, hole))) continue
      return country.name
    }
  }
  return null
}
