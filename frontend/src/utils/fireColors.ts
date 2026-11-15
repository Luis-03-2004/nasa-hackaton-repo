/** Shared intensity ramp for geographic heatmaps, the calendar and legends. */
const FIRE_COLORS = [
  [255, 255, 255],
  [254, 240, 138],
  [253, 186, 116],
  [251, 146, 60],
  [239, 68, 68],
  [153, 27, 27],
] as const

export function fireIntensityColor(value: number, maximum: number): string {
  const amount = Math.sqrt(Math.max(0, Math.min(1, value / Math.max(maximum, 1))))
  const position = amount * (FIRE_COLORS.length - 1)
  const index = Math.min(FIRE_COLORS.length - 2, Math.floor(position))
  const blend = position - index
  const channels = FIRE_COLORS[index].map((channel, i) =>
    Math.round(channel + (FIRE_COLORS[index + 1][i] - channel) * blend),
  )
  return `rgb(${channels.join(',')})`
}

// Match the square-root normalization used by the cells, including the legend.
export const FIRE_COLOR_GRADIENT = `linear-gradient(90deg, ${Array.from(
  { length: 21 }, (_, i) => `${fireIntensityColor(i, 20)} ${i * 5}%`,
).join(', ')})`
