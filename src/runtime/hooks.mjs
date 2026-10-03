// Approval is a control callback, never an observation listener.
export function composeHooks(primary = {}, ...observers) {
  const hooks = { ...primary };
  for (const key of new Set(observers.flatMap((o) => Object.keys(o)))) {
    if (key === "approve") continue;
    hooks[key] = async (...args) => {
      await primary[key]?.(...args);
      for (const observer of observers) {
        try {
          observer[key]?.(...args)?.catch?.(() => {});
        } catch {}
      }
    };
  }
  return hooks;
}
