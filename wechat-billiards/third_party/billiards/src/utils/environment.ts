export function shouldCreateRenderObjects(): boolean {
  return (
    typeof document !== "undefined" &&
    (globalThis as { __BILLIARDS_HEADLESS__?: boolean })
      .__BILLIARDS_HEADLESS__ !== true
  );
}
