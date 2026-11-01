const renders = new WeakMap();

export function invalidateHotelRender(container) {
  renders.get(container)?.invalidate();
  renders.delete(container);
}

export function hasCurrentHotelRender(container) {
  return renders.get(container)?.current() === true;
}

export function beginHotelRender(container, routeIsCurrent) {
  invalidateHotelRender(container);
  let active = true;
  let anchor = null;
  const render = {
    attach(node) { anchor = node; },
    invalidate() { active = false; },
    current() {
      return active && renders.get(container) === render && routeIsCurrent()
        && (!anchor || container.contains(anchor));
    },
  };
  renders.set(container, render);
  return render;
}
