export const FILE_TREE_DEFAULT_WIDTH = 272;
export const FILE_TREE_MIN_WIDTH = 224;
export const FILE_TREE_MAX_WIDTH = 576;

export function clampFileTreeWidth(width: number): number {
  return Math.min(FILE_TREE_MAX_WIDTH, Math.max(FILE_TREE_MIN_WIDTH, Math.round(width)));
}
