export const WORKSPACE_DRAWER_DEFAULT_WIDTH = 320;
export const WORKSPACE_DRAWER_MIN_WIDTH = 288;
export const WORKSPACE_DRAWER_MAX_WIDTH = 576;

export function clampWorkspaceDrawerWidth(width: number): number {
  return Math.min(
    WORKSPACE_DRAWER_MAX_WIDTH,
    Math.max(WORKSPACE_DRAWER_MIN_WIDTH, Math.round(width)),
  );
}
