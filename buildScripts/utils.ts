/**
 * Escape any special regex characters.
 */
export function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

export function setProperty(object: any, key: string, value: unknown) {
  let target = object;
  let changed = false;

  // Convert the key to an object reference if it contains dot notation
  if (key.indexOf(".") !== -1) {
    let parts = key.split(".");
    if (parts.length === 0) {
      return false;
    }
    key = parts.pop()!;
    target = parts.reduce((o: any, i: string) => {
      if (!o.hasOwnProperty(i)) o[i] = {};
      return o[i];
    }, object);
  }

  // Update the target
  if (target[key] !== value) {
    changed = true;
    target[key] = value;
  }

  // Return changed status
  return changed;
}

export function tryCatch<T>(valueFn: () => T, catchFn?: (e: unknown) => T | undefined): T | undefined {
  try {
    return valueFn();
  } catch (e: unknown) {
    if (catchFn)
      return catchFn(e);
  }
  return undefined
}

export function tryOrThrow<T>(valueFn: () => T, catchFn: (e: unknown) => never): T {
  try {
    return valueFn();
  } catch (e: unknown) {
    catchFn(e);
  }
}
