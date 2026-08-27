export function getLoopedScrollPosition(scrollLeft, loopWidth) {
  if (!Number.isFinite(loopWidth) || loopWidth <= 0) {
    return scrollLeft;
  }

  let position = scrollLeft;
  const lowerBoundary = loopWidth * 0.5;
  const upperBoundary = loopWidth * 1.5;

  while (position < lowerBoundary) {
    position += loopWidth;
  }

  while (position >= upperBoundary) {
    position -= loopWidth;
  }

  return position;
}
