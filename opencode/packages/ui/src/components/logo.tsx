import { type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 6 24 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M6 12H18V18H6Z" fill="var(--icon-weak-base)" />
      <path d="M0 6H6V36H0ZM6 6H24V12H6ZM18 12H24V24H18ZM6 18H18V24H6ZM12 24H18V30H12ZM18 30H24V36H18Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 6 24 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M6 12H18V18H6Z" fill="var(--icon-weak-base)" />
      <path d="M0 6H6V36H0ZM6 6H24V12H6ZM18 12H24V24H18ZM6 18H18V24H6ZM12 24H18V30H12ZM18 30H24V36H18Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 96 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        <path d="M0 6H6V36H0ZM6 6H24V12H6ZM18 12H24V24H18ZM6 18H18V24H6ZM12 24H18V30H12ZM18 30H24V36H18Z" fill="var(--icon-strong-base)" />
        <path d="M30 6H36V36H30Z" fill="var(--icon-strong-base)" />
        <path d="M42 6H66V12H48V18H60V24H48V36H42V6Z" fill="var(--icon-strong-base)" />
        <path d="M72 6H96V12H87V36H81V12H72V6Z" fill="var(--icon-strong-base)" />
      </g>
    </svg>
  )
}
