export const EmptyBorder = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}

export const SplitBorder = {
  border: ["left" as const, "right" as const],
  customBorderChars: {
    ...EmptyBorder,
    vertical: "┃",
  },
}

/**
 * Rounded box used for the prompt and other framed surfaces. A full frame reads as an input
 * field the way a terminal user expects, rather than a bar clinging to the left edge.
 */
export const RoundedBorder = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
  bottomT: "┴",
  topT: "┬",
  cross: "┼",
  leftT: "├",
  rightT: "┤",
}
