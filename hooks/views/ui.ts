import type { BoxProps, ButtonProps, ElementConstructor, TextProps } from 'claude-code'

// The elements every component draws with, handed down from the page, which resolves them for its surface. A component
// takes them, the figures it shows and the intents it raises, and reads nothing itself: the page is the only container.
export type UI = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}
