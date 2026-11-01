import { Chip } from '../atoms/Chip'
import { Fold } from '../atoms/Fold'
import { Spacer } from '../atoms/Spacer'
import { Tile } from '../atoms/Tile'
import { cut, fit } from '../layout'
import { CHANNELS, COLOR_TOKENS, G, GLYPH_TOKENS, LOADING, S, SERIES, SPACE, SPACE_TOKENS, T, TYPE_TOKENS } from '../palette'
import { beatOf } from '../sweep'
import type { UI } from '../ui'

// The width of the column that names a token.
const NAME_W = 20

/** The page behind the version: every intent token the pane draws with, each beside what it means. A colour shows its
 * swatch and its hex, a type style a sample set in it, a glyph itself. The atoms come last, the least the tokens make:
 * each drawn with a sample that plays through its states, made as the page draws, so a change of theme reaches it. */
export function TokenScreen({ ui, width, rowWidth, version, tabs, frame, spin, onBack }: { ui: UI; width: number; rowWidth: number; version?: string; tabs: JSX.Element; frame: number; spin: string; onBack: () => unknown }) {
  const { Box, Text, Button } = ui
  const room = rowWidth - NAME_W - 4
  const head = (title: string, means: string) => (
    <Box flexDirection="column" marginTop={SPACE.section}>
      <Text {...S.name}>{title}</Text>
      {means ? <Text color={T.text.muted}>{cut(means, rowWidth)}</Text> : null}
    </Box>
  )
  const atom = (name: string, says: string, ...specimen: JSX.Element[]) => (
    <Box key={`atom-${name}`} flexDirection="column" marginTop={SPACE.section}>
      <Text {...S.name}>{name}</Text>
      <Text color={T.text.muted} wrap="wrap">{says}</Text>
      {specimen}
    </Box>
  )
  const idle = () => undefined
  const beat = beatOf(frame)
  const tile = { label: 'Requests', labels: ['Reqs'], value: String(18 + beat % 8) }
  const swatches = (colors: readonly string[]) => colors.map(c => <Text color={c}>{'██ '}</Text>)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={T.line.frame} paddingX={SPACE.inset} width={width}>
      <Button plain key="node-tokens-back" label={`${G.back} Back`} onPress={onBack} />
      <Text {...S.name}>{`Session lens${version ? ` v${version}` : ''} · design tokens`}</Text>
      {tabs}
      <Text color={T.text.muted}>{cut('Every view draws with an intent token, never a raw colour.', rowWidth)}</Text>
      {head('How colour reads', 'Colour answers three questions, each on a channel of its own, so one never hides another. What still runs is always a hue, never a grey.')}
      {CHANNELS.map(c => (
        <Box flexDirection="column" key={`channel-${c.channel}`}>
          <Text>
            {swatches(c.colors)}
            <Text {...S.name}>{c.channel}</Text>
          </Text>
          <Text color={T.text.muted} wrap="wrap">{`  ${c.says}`}</Text>
        </Box>
      ))}
      {Object.entries(COLOR_TOKENS).map(([group, tokens]) => (
        <Box flexDirection="column" key={`tokens-${group}`}>
          {head(`Colour · ${group}`, '')}
          {Object.entries(tokens).map(([name, t]) => (
            <Text key={`token-${group}-${name}`}>
              <Text color={t.color}>{'██ '}</Text>
              {fit(`${group}.${name}`, NAME_W)}
              <Text color={T.text.muted}>{cut(`${t.color}  ${t.means}`, room)}</Text>
            </Text>
          ))}
        </Box>
      ))}
      {head('Colour · series', 'The parts of one whole told apart, in this order; a part with a meaning of its own takes its token instead.')}
      <Text>{swatches(SERIES)}</Text>
      {head('Colour · loading', 'While the pane reads: a light sweeps a dim track, its trail running through every hue.')}
      <Text>
        <Text color={LOADING.light}>{'██ '}</Text>
        <Text color={LOADING.head}>{'██ '}</Text>
        {swatches(LOADING.trail)}
        <Text color={LOADING.track}>{'██'}</Text>
      </Text>
      {head('Type', 'The terminal has one size, so weight and slant carry how sure or how live a figure is.')}
      {Object.entries(TYPE_TOKENS).map(([name, t]) => (
        <Text key={`token-type-${name}`}>
          <Text {...t.style}>{fit('Sample 12.3k', 15)}</Text>
          {fit(name, NAME_W - 12)}
          <Text color={T.text.muted}>{cut(t.means, room)}</Text>
        </Text>
      ))}
      {head('Glyph', 'One glyph, one meaning, everywhere on the pane.')}
      {Object.entries(GLYPH_TOKENS).map(([name, t]) => (
        <Text key={`token-glyph-${name}`}>
          {fit(` ${t.glyph}`, 3)}
          {fit(name, NAME_W)}
          <Text color={T.text.muted}>{cut(t.means, room)}</Text>
        </Text>
      ))}
      {head('Space', 'The terminal counts in cells; the same distance always means the same thing.')}
      {Object.entries(SPACE_TOKENS).map(([name, t]) => (
        <Text key={`token-space-${name}`}>
          {fit(` ${t.cells}`, 3)}
          {fit(name, NAME_W)}
          <Text color={T.text.muted}>{cut(t.means, room)}</Text>
        </Text>
      ))}
      <Box flexDirection="column" marginTop={SPACE.section}>
        <Text bold color={T.actor.main}>Atoms</Text>
        <Text color={T.text.muted} wrap="wrap">One element: split it and no part means anything. It composes no other component.</Text>
      </Box>
      {atom('Chip', 'One choice of a filter.', (
        <Box flexDirection="row" columnGap={SPACE.tight}>
          <Chip ui={ui} key="atom-chip-a" label="first" isOn={beat % 2 === 0} color={T.actor.main} onPress={idle} />
          <Chip ui={ui} key="atom-chip-b" label="second" isOn={beat % 2 === 1} color={T.actor.main} onPress={idle} />
        </Box>
      ))}
      {atom('Fold', 'The head of a part that folds, and what it holds.', <Fold ui={ui} key="node-atom-fold" indent={0} isOpen={beat % 2 === 0} title="Sample fold" summary="12 lines" room={rowWidth} onToggle={idle} />)}
      {atom('Spacer', 'The blank row between two sections of one box.', <Text color={T.text.muted}>above</Text>, <Spacer ui={ui} />, <Text color={T.text.muted}>below</Text>)}
      {atom('Tile', 'A label over a figure; a spinner after a figure still counting.', (
        <Box flexDirection="row">
          <Tile ui={ui} key="atom-tile" tile={tile} width={14} pad={SPACE.inset} borderColor={T.line.frame} spin={spin} />
          <Tile ui={ui} key="atom-tile-live" tile={{ ...tile, live: true }} width={14} pad={SPACE.inset} borderColor={T.line.frame} spin={spin} spinColor={T.state.live} />
        </Box>
      ))}
    </Box>
  )
}
