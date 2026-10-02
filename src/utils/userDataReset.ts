const listeners = new Set<() => void>();

export function onUserDataReset(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

export function markUserDataReset() {
    listeners.forEach(cb => cb());
}
