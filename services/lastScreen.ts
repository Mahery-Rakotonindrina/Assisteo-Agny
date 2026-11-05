import Router from "next/router";

// The screen the person was on before Settings, sent along with their feedback.

let current: string | null = null;
let previous: string | null = null;

/** Starts following the route; returns the stop function. */
export function trackScreens(): () => void {
  const onChange = (url: string) => {
    const path = url.split(/[?#]/)[0];
    if (path === current) return;
    previous = current;
    current = path;
  };
  onChange(Router.asPath);
  Router.events.on("routeChangeComplete", onChange);
  return () => Router.events.off("routeChangeComplete", onChange);
}

/** The screen before the current one, or null when Settings was the first. */
export const previousScreen = () => previous;
