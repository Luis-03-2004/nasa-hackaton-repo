export type Ring = number[][]
export type Polygon = Ring[]

export type CountryShape = {
  id?: string
  name: string
  namePt?: string
  iso2?: string
  iso3?: string
  aliases?: string[]
  polygons: Polygon[]
}

type CountryFile = {
  features: Array<{
    id?: string
    properties: Record<string, string | number | null>
    geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Polygon | Polygon[] }
  }>
}

let loading: Promise<CountryShape[]> | null = null
export const countryNameKey = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replaceAll('_', ' ').toLowerCase().replace(/[^a-z0-9]/g, '')

const SOURCE_ALIASES: Record<string, string[]> = {
  'United States of America': ['United States', 'United_States'],
  Russia: ['Russian Federation', 'Russian_Federation'],
  'Democratic Republic of the Congo': ['Democratic_Republic_of_the_Congo', 'Congo Democratic Republic', 'Congo, Dem. Rep.'],
  'Republic of the Congo': ['Congo', 'Congo Republic'],
  'Ivory Coast': ["Cote d Ivoire", "Côte d'Ivoire", 'Cote_d_Ivoire'],
  'United Republic of Tanzania': ['Tanzania', 'United_Republic_of_Tanzania'],
  'Republic of Serbia': ['Serbia'],
  'South Korea': ['Republic of Korea', 'Korea Republic of', 'Korea'],
  'North Korea': ['Democratic Peoples Republic of Korea', 'Korea Democratic Peoples Republic of'],
  Czechia: ['Czech Republic'],
  'eSwatini': ['Swaziland', 'Eswatini'],
  'East Timor': ['Timor-Leste', 'Timor Leste'],
  'The Bahamas': ['Bahamas'],
  'The Gambia': ['Gambia'],
  'North Macedonia': ['Macedonia', 'The former Yugoslav Republic of Macedonia'],
  'Cape Verde': ['Cabo Verde'],
  'Vatican': ['Holy See', 'Vatican City'],
  'Syria': ['Syrian Arab Republic'],
  'Laos': ['Lao Peoples Democratic Republic', 'Lao'],
  'Vietnam': ['Viet Nam'],
  'Iran': ['Iran Islamic Republic of'],
  'Brunei': ['Brunei Darussalam'],
  'Venezuela': ['Venezuela Bolivarian Republic of'],
  'Bolivia': ['Bolivia Plurinational State of'],
  'Moldova': ['Republic of Moldova'],
  'Palestine': ['State of Palestine', 'Palestinian Territory'],
}

export function loadCountries(): Promise<CountryShape[]> {
  if (!loading) {
    loading = fetch('/geo/countries-mapunits-ne50m.geojson')
      .then((response) => {
        if (!response.ok) throw new Error('Country boundaries did not load.')
        return response.json() as Promise<CountryFile>
      })
      .then((file) => file.features.map((feature) => {
        const p = feature.properties
        const name = String(p.GEOUNIT ?? p.ADMIN ?? p.NAME_EN ?? p.name ?? p.NAME)
        const aliases = [...new Set([name, ...['NAME', 'NAME_EN', 'NAME_LONG', 'FORMAL_EN', 'NAME_ALT'].flatMap((key) => typeof p[key] === 'string' ? [String(p[key])] : []), ...(SOURCE_ALIASES[name] ?? [])])]
        const iso2 = String(p.ISO_A2_EH ?? p.ISO_A2 ?? '')
        return {
          id: String(p.GU_A3 ?? p.ADM0_A3 ?? feature.id ?? countryNameKey(name)),
          name,
          namePt: String(p.NAME_PT ?? name),
          iso2: /^[A-Z]{2}$/.test(iso2) ? iso2 : undefined,
          iso3: String(p.GU_A3 ?? p.ISO_A3 ?? p.ADM0_A3 ?? ''),
          aliases,
          polygons: feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates as Polygon] : feature.geometry.coordinates as Polygon[],
        }
      }))
      .catch((error: unknown) => { loading = null; throw error })
  }
  return loading
}

export function resolveCountryShape(sourceName: string, countries: CountryShape[]) {
  const key = countryNameKey(sourceName)
  return countries.find((country) => [country.name, country.namePt ?? '', country.iso2 ?? '', country.iso3 ?? '', ...(country.aliases ?? [])].some((name) => countryNameKey(name) === key)) ?? null
}

export function countryDisplayName(country: CountryShape, locale: 'pt-BR' | 'en' = 'pt-BR') {
  return locale === 'pt-BR' ? country.namePt ?? country.name : country.name
}

/** Unwrap one ring continuously. Every adjacent edge follows the short longitude path. */
export function unwrapRing(ring: Ring): Ring {
  if (!ring.length) return []
  const out: Ring = [[ring[0][0], ring[0][1]]]
  for (let index = 1; index < ring.length; index += 1) {
    let lon = ring[index][0]
    const previous = out[index - 1][0]
    while (lon - previous > 180) lon -= 360
    while (lon - previous < -180) lon += 360
    out.push([lon, ring[index][1]])
  }
  return out
}

type PreparedPolygon = { rings: Ring[]; west: number; east: number; south: number; north: number }
const prepared = new WeakMap<CountryShape, PreparedPolygon[]>()
export function preparedCountry(country: CountryShape): PreparedPolygon[] {
  const cached = prepared.get(country)
  if (cached) return cached
  const polygons = country.polygons.map((polygon) => {
    const rings = polygon.map(unwrapRing)
    const outer = rings[0] ?? []
    return { rings, west: Math.min(...outer.map((p) => p[0])), east: Math.max(...outer.map((p) => p[0])), south: Math.min(...outer.map((p) => p[1])), north: Math.max(...outer.map((p) => p[1])) }
  })
  prepared.set(country, polygons)
  return polygons
}

function ringContains(lon: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [x, y] = ring[index]
    const [oldX, oldY] = ring[previous]
    if ((y > lat) !== (oldY > lat) && lon < (oldX - x) * (lat - y) / (oldY - y) + x) inside = !inside
  }
  return inside
}

export function findCountryAt(countries: CountryShape[], lat: number, lon: number): CountryShape | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90) return null
  for (const country of countries) {
    for (const polygon of preparedCountry(country)) {
      if (lat < polygon.south || lat > polygon.north) continue
      for (const longitude of [lon, lon - 360, lon + 360]) {
        if (longitude < polygon.west || longitude > polygon.east) continue
        if (!ringContains(longitude, lat, polygon.rings[0] ?? [])) continue
        if (!polygon.rings.slice(1).some((ring) => ringContains(longitude, lat, ring))) return country
      }
    }
  }
  return null
}

export function countryAt(countries: CountryShape[], lat: number, lon: number) {
  return findCountryAt(countries, lat, lon)?.name ?? null
}
