
declare global {
  interface Window {
    animated: boolean;
    background: number; // hex value
    transparent: boolean;
  }    
}

export const setTHREEOptions = async (options: Window) => {
  if (options.animated) window.animated = options.animated;
  if (options.background) window.background = options.background;
  if (options.transparent) window.transparent = options.transparent;

  await new Promise((resolve) => setTimeout(resolve, 1000));
}