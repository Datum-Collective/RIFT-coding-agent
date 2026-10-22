import { createUniqueId, type ComponentProps } from "solid-js"

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g opacity="0.6">
        <g mask={`url(#${mask})`}>
          <g opacity="0.16">
            <g transform="translate(212.3 0) scale(3.0769)">
              <path opacity="0.7" d="M0 6H6V36H0ZM6 6H24V12H6ZM18 12H24V24H18ZM6 18H18V24H6ZM12 24H18V30H12ZM18 30H24V36H18Z" fill="currentColor" />
              <path opacity="0.7" d="M30 6H36V36H30Z" fill="currentColor" />
              <path opacity="0.7" d="M42 6H66V12H48V18H60V24H48V36H42V6Z" fill="currentColor" />
              <path opacity="0.7" d="M72 6H96V12H87V36H81V12H72V6Z" fill="currentColor" />
            </g>
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="720" height="129">
          <rect width="720" height="129" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="360" y1="68" x2="360" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
